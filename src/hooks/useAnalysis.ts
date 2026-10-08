"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient, isLocalApi } from "@/lib/api/client";
import { backendClass } from "@/lib/api/backend-class";
import { createMempoolClient } from "@/lib/api/mempool";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { detectAddressNetwork, detectTxidNetwork, isMainnetAddress } from "@/lib/api/detect-network";
import { mapApiErrorMessage } from "@/lib/api/error-message";
import { NETWORK_CONFIG, type BitcoinNetwork } from "@/lib/bitcoin/networks";
import { cleanInput, detectInputType } from "@/lib/analysis/detect-input";
import { getTxHeuristicSteps, getAddressHeuristicSteps } from "@/lib/analysis/heuristic-steps";
import { loadEngine } from "@/lib/analysis/load-engine";
import { parseLocalTx, localTxLabel, type LocalTx } from "@/lib/input/local-tx";
import { getAnalysisSettings, type AnalysisSettings } from "@/hooks/useAnalysisSettings";
import { getCachedResult, putCachedResult } from "@/lib/api/analysis-cache";
import { cacheKeyPrefix } from "@/lib/api/cache-policy";
import { isBackendChainPending } from "@/lib/api/backend-network";
import type { HeuristicTranslator } from "@/lib/analysis/heuristics/types";

import {
  type AnalysisState,
  INITIAL_STATE,
  makeOfacPreSendResult,
  markAllDone,
} from "@/lib/analysis/analysis-state";

// Re-export types that components import from this module
export type { FetchProgress } from "@/lib/analysis/analysis-state";
export type { PreSendResult } from "@/lib/analysis/orchestrator";

/** Uncached, IP-linked lookups for a local tx: never createApiClient (IndexedDB cache). */
function makeLookupClient(baseUrl: string, signal: AbortSignal) {
  return createMempoolClient(baseUrl, { signal, timeoutMs: isLocalApi(baseUrl) ? 60_000 : 15_000 });
}

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const { network, setNetwork, config, configFor, customApiUrl, isUmbrel, isCustomApi, networkUnverified } = useNetwork();
  const { t } = useTranslation();
  const abortRef = useRef<AbortController | null>(null);
  /** Cache write owed by the analysis that just completed; flushed after the commit. */
  const pendingCacheRef = useRef<{ cacheKey: string; input: string; settings: AnalysisSettings } | null>(null);
  /** Last local (PSBT/raw tx) input, kept in memory only for retryLocal. */
  const localInputRef = useRef<string | null>(null);

  // Load the engine and the core entity filter on mount (off the critical path)
  useEffect(() => {
    loadEngine().then((e) => e.loadEntityFilter()).catch(() => { /* retried on first scan */ });
  }, []);

  // Wrap t as HeuristicTranslator for passing into analysis layer
  const ht: HeuristicTranslator = useCallback(
    (key: string, options?: Record<string, unknown>) => t(key, options),
    [t],
  );

  /** Shared step-update callback for diagnostic loader progress. */
  const onStep = useCallback((stepId: string, impact?: number) => {
    setState((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => {
        if (s.id === stepId) {
          if (impact !== undefined) {
            return { ...s, status: "done" as const, impact };
          }
          return { ...s, status: "running" as const };
        }
        if (s.status === "running") {
          return { ...s, status: "done" as const };
        }
        return s;
      }),
    }));
  }, []);

  const analyze = useCallback(
    async (input: string, opts?: { awaitIndexing?: boolean }) => {
      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      pendingCacheRef.current = null;
      const inputType = detectInputType(input, network);
      // The signed hex of a previous local scan must not linger once another scan starts
      if (inputType !== "psbt" && inputType !== "rawtx") localInputRef.current = null;

      if (inputType === "invalid") {
        setState({
          ...INITIAL_STATE,
          phase: "error",
          query: input,
          inputType: "invalid",
          error: t("errors.invalid_input", { defaultValue: "Invalid Bitcoin address or transaction ID." }),
          errorCode: "not-retryable",
        });
        return;
      }

      // xpub/descriptor inputs are handled by useWalletAnalysis, not here
      if (inputType === "xpub") {
        setState({
          ...INITIAL_STATE,
          phase: "error",
          query: input,
          inputType: "xpub",
          error: "xpub",
          errorCode: "not-retryable",
        });
        return;
      }

      // Start loading the engine now; it downloads while the network/cache checks run
      const enginePromise = loadEngine();
      enginePromise.catch(() => { /* surfaced where it is awaited */ });

      // An address whose format rules out the selected network (tb1 on mainnet,
      // bc1 on testnet) is scanned on the network it belongs to, with the same
      // switch notice as a txid found elsewhere. Public mempool.space only.
      let net = network;
      let cfg = config;
      let switchedTo: BitcoinNetwork | undefined;
      // A self-hosted backend serves one network: an address of another one is refused
      if (inputType === "address" && (isUmbrel || !!customApiUrl) && isMainnetAddress(cleanInput(input)) !== (network === "mainnet")) {
        const vars = {
          addressNetwork: network === "mainnet" ? "Testnet/Signet" : "Mainnet",
          network: NETWORK_CONFIG[network].label,
        };
        setState({
          ...INITIAL_STATE,
          phase: "error",
          query: input,
          inputType,
          error: networkUnverified
            ? t("errors.addressWrongNetworkUnverified", {
              ...vars,
              defaultValue: "This address belongs to {{addressNetwork}}, but the connected backend's network could not be verified and is assumed to be {{network}}. It cannot be looked up there.",
            })
            : t("errors.addressWrongNetwork", {
              ...vars,
              defaultValue: "This address belongs to {{addressNetwork}}, but the connected backend serves {{network}}. It cannot be looked up there.",
            }),
          errorCode: "not-retryable",
        });
        return;
      }
      if (inputType === "address" && !isUmbrel && !customApiUrl) {
        const detected = await detectAddressNetwork(input, network, controller.signal, (n) => configFor(n).mempoolBaseUrl);
        if (controller.signal.aborted) return;
        if (detected) {
          net = detected;
          cfg = configFor(detected);
          switchedTo = detected;
          setNetwork(detected);
        }
      }

      // PSBT or raw tx: parsed and analyzed in memory. Never cached, never put in the
      // hash or history; network access only via an explicit lookup.
      if (inputType === "psbt" || inputType === "rawtx") {
        localInputRef.current = input;
        const steps = getTxHeuristicSteps(ht);
        const startTime = Date.now();
        let local: LocalTx;
        try {
          local = parseLocalTx(input, network);
        } catch (err) {
          // btc-signer messages describe structure, never the input: never interpolate `input`
          setState({
            ...INITIAL_STATE,
            phase: "error",
            query: inputType === "psbt"
              ? t("local.kindPsbt", { defaultValue: "PSBT" })
              : t("local.kindRaw", { defaultValue: "Raw transaction" }),
            inputType,
            error: t("errors.local_parse", {
              message: err instanceof Error ? err.message : "",
              defaultValue: "Could not read this transaction: {{message}}",
            }),
            errorCode: "not-retryable",
          });
          return;
        }
        const label = localTxLabel(local);
        setState({
          ...INITIAL_STATE,
          phase: "analyzing",
          query: t(label.key, {
            inputs: label.inputs,
            outputs: label.outputs,
            defaultValue: label.key === "local.queryPsbt"
              ? "PSBT · {{inputs}} in · {{outputs}} out"
              : "Raw transaction · {{inputs}} in · {{outputs}} out",
          }),
          inputType,
          steps,
          localTx: local,
          txData: local.tx,
        });
        try {
          const { runLocalAnalysis, countLookups, LookupFailedError } = await enginePromise;
          const lookups = countLookups(local);
          const wantsLookup = lookups.inputs + lookups.addresses > 0;
          const selfHosted = backendClass({ isUmbrel, customApiUrl }) === "self-hosted";
          const lookup = selfHosted && wantsLookup ? makeLookupClient(cfg.mempoolBaseUrl, controller.signal) : null;
          const run = (lk: typeof lookup) => runLocalAnalysis(local, {
            lookup: lk,
            signal: controller.signal,
            onStep,
            boltzmannTimeoutMs: (getAnalysisSettings().boltzmannTimeout ?? 300) * 1000,
            isCustomApi,
          });
          // Own node unreachable: show the lookup-free result and let the user retry
          let lookupFailed = false;
          const r = await run(lookup).catch((e: unknown) => {
            if (lookup && e instanceof LookupFailedError) { lookupFailed = true; return run(null); }
            throw e;
          });
          if (controller.signal.aborted) return;
          // No trace data before broadcast - mark all chain steps as done
          for (const cid of ["chain-backward", "chain-forward", "chain-cluster", "chain-spending", "chain-entity", "chain-taint"]) {
            onStep(cid); onStep(cid, 0);
          }
          setState((prev) => ({
            ...prev,
            phase: "complete",
            steps: markAllDone(prev.steps),
            result: r.result,
            txData: r.tx,
            boltzmannResult: r.boltzmannResult,
            boltzmannStatus: r.boltzmannStatus,
            localOutputTxCounts: r.outputTxCounts,
            localLookup: !wantsLookup ? null : { status: lookupFailed ? "failed" : lookup ? "done" : "available", ...lookups },
            durationMs: Date.now() - startTime,
          }));
        } catch (err) {
          if (controller.signal.aborted) return;
          setState((prev) => ({
            ...prev,
            phase: "error",
            error: err instanceof Error
              ? t("errors.local_parse", { message: err.message, defaultValue: "Could not read this transaction: {{message}}" })
              : t("errors.unexpected", { defaultValue: "An unexpected error occurred." }),
            errorCode: "not-retryable",
          }));
        }
        return;
      }

      // Check analysis result cache before making API calls
      const analysisSettingsForCache = getAnalysisSettings();
      // The backend's chain is being re-asked: its cache key prefix may be wrong, so no cache
      const unverifiedBackend = isBackendChainPending(cfg.mempoolBaseUrl);
      // Keyed per backend: custom/Umbrel/onion results never share an entry with mempool.space
      const cached = opts?.awaitIndexing || unverifiedBackend ? null : await getCachedResult(cacheKeyPrefix(cfg.mempoolBaseUrl, net), input, analysisSettingsForCache);
      // reset() or a newer analyze() ran during the lookup: leave their state alone
      if (controller.signal.aborted) return;
      if (cached) {
        const cachedSteps = (inputType === "txid"
          ? getTxHeuristicSteps(ht)
          : getAddressHeuristicSteps(ht)
        ).map((s) => ({ ...s, status: "done" as const }));

        setState({
          ...INITIAL_STATE,
          phase: "complete",
          query: input,
          inputType,
          steps: cachedSteps,
          result: cached.result,
          txData: cached.txData,
          addressData: cached.addressData,
          addressTxs: cached.addressTxs,
          addressUtxos: cached.addressUtxos,
          txBreakdown: cached.txBreakdown,
          preSendResult: cached.preSendResult,
          durationMs: 0,
          usdPrice: cached.usdPrice,
          outspends: cached.outspends,
          backwardLayers: cached.backwardLayers,
          forwardLayers: cached.forwardLayers,
          boltzmannResult: cached.boltzmannResult ?? null,
          boltzmannStatus: cached.boltzmannResult ? "complete" : null,
          fromCache: true,
          autoSwitchedNetwork: switchedTo,
        });
        return;
      }

      const api = createApiClient(cfg, controller.signal);

      const steps =
        inputType === "txid"
          ? getTxHeuristicSteps(ht)
          : getAddressHeuristicSteps(ht);

      const startTime = Date.now();

      /**
       * Merge the final fields into the live state as "complete". With `cacheNetwork`,
       * the committed state is cached (by the effect below) unless the result is partial.
       */
      const complete = (fields: Partial<AnalysisState>, cacheNetwork?: BitcoinNetwork) => {
        if (cacheNetwork && !fields.result?.partial && !unverifiedBackend) {
          const cacheKey = cacheKeyPrefix(configFor(cacheNetwork).mempoolBaseUrl, cacheNetwork);
          pendingCacheRef.current = { cacheKey, input, settings: analysisSettingsForCache };
        }
        const durationMs = Date.now() - startTime;
        setState((prev) => ({
          ...prev,
          phase: "complete",
          steps: markAllDone(prev.steps),
          awaitingIndex: false,
          ...fields,
          durationMs,
        }));
      };

      setState({
        ...INITIAL_STATE,
        phase: "fetching",
        query: input,
        inputType,
        steps,
        awaitingIndex: !!opts?.awaitIndexing,
      });

      try {
        const { runTxidAnalysis, runAddressAnalysis } = await enginePromise;
        if (controller.signal.aborted) return;
        if (inputType === "txid") {
          const txResult = await runTxidAnalysis(input, {
            api,
            controller,
            awaitIndexing: opts?.awaitIndexing,
            network,
            isCustomApi,
            analysisSettingsForCache,
            onStep,
            setState,
          });
          if (controller.signal.aborted) return;
          complete({
            result: txResult.result,
            boltzmannResult: txResult.boltzmannResult,
            boltzmannStatus: txResult.boltzmannStatus as AnalysisState["boltzmannStatus"],
          }, network);
        } else {
          const addrResult = await runAddressAnalysis(input, {
            api,
            controller,
            onStep,
            setState,
            t,
          });
          if (controller.signal.aborted) return;

          // OFAC-sanctioned: short-circuit to complete with only preSendResult
          if (addrResult.isOfacSanctioned) {
            setState({
              ...INITIAL_STATE,
              phase: "complete",
              query: input,
              inputType: "address",
              steps: steps.map((s) => ({ ...s, status: "done" as const })),
              preSendResult: addrResult.preSendResult,
              durationMs: Date.now() - startTime,
            });
            return;
          }

          // Fresh address: only preSendResult, no scoring result
          if (!addrResult.result) {
            complete({ preSendResult: addrResult.preSendResult, autoSwitchedNetwork: switchedTo });
            return;
          }

          complete({
            result: addrResult.result,
            preSendResult: addrResult.preSendResult,
            addressTxs: addrResult.addressTxs,
            addressUtxos: addrResult.addressUtxos,
            txBreakdown: addrResult.txBreakdown,
            autoSwitchedNetwork: switchedTo,
          }, net);
        }
      } catch (err) {
        // Ignore aborted requests (user started a new analysis)
        if (controller.signal.aborted) return;

        // For address queries, even when API fails, check OFAC locally
        if (inputType === "address") {
          const engine = await enginePromise.catch(() => null);
          if (controller.signal.aborted) return;
          if (engine?.checkOfac([input]).sanctioned) {
            complete({ preSendResult: makeOfacPreSendResult(t) });
            return;
          }
        }

        // Auto-detect network: a NOT_FOUND on a txid against the public
        // mempool.space API often means the user is on the wrong network.
        // Probe the other networks on the same backend family (onion on Tor);
        // if the tx lives on one of them, switch and retry transparently.
        if (
          err instanceof ApiError &&
          err.code === "NOT_FOUND" &&
          inputType === "txid" &&
          !isUmbrel &&
          !customApiUrl &&
          !opts?.awaitIndexing
        ) {
          const detected = await detectTxidNetwork(
            input, network, controller.signal, (n) => configFor(n).mempoolBaseUrl,
          );
          if (detected && detected !== network && !controller.signal.aborted) {
            setNetwork(detected);
            const detectedApi = createApiClient(configFor(detected), controller.signal);

            setState({
              ...INITIAL_STATE,
              phase: "fetching",
              query: input,
              inputType,
              steps,
            });

            try {
              const { runTxidAnalysis } = await enginePromise;
              const txResult = await runTxidAnalysis(input, {
                api: detectedApi,
                controller,
                network: detected,
                isCustomApi: false,
                analysisSettingsForCache,
                onStep,
                setState,
              });
              if (controller.signal.aborted) return;
              // autoSwitchedNetwork is not part of the cached payload: the notice
              // only applies to the switch that just happened
              complete({
                result: txResult.result,
                boltzmannResult: txResult.boltzmannResult,
                boltzmannStatus: txResult.boltzmannStatus as AnalysisState["boltzmannStatus"],
                autoSwitchedNetwork: detected,
              }, detected);
              return;
            } catch {
              // Retry failed; fall through to the original error handling
            }
          }
        }

        const { message, retryable } = mapApiErrorMessage(err, ht, { isUmbrel, isCustomApi });
        setState((prev) => ({
          ...prev,
          phase: "error",
          error: message,
          errorCode: retryable ? "retryable" : "not-retryable",
        }));
      }
    },
    [network, setNetwork, config, configFor, customApiUrl, isCustomApi, isUmbrel, networkUnverified, t, ht, onStep],
  );

  // Flush the cache write owed by a just-completed analysis from committed state
  // (never from inside a setState updater, which React may run more than once).
  useEffect(() => {
    const pending = pendingCacheRef.current;
    if (!pending || state.phase !== "complete") return;
    pendingCacheRef.current = null;
    putCachedResult(pending.cacheKey, pending.input, pending.settings, state)
      .catch((e) => console.warn("cache write failed:", e));
  }, [state]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    pendingCacheRef.current = null;
    localInputRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const retryLocal = useCallback(() => {
    if (localInputRef.current) void analyze(localInputRef.current);
  }, [analyze]);

  /** Consent click on a public backend: re-run the local analysis with an uncached lookup client. */
  const completeLocalLookup = useCallback(async () => {
    const local = state.localTx;
    if (!local || state.localLookup?.status === "running") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({ ...prev, localLookup: prev.localLookup && { ...prev.localLookup, status: "running" } }));
    try {
      const { runLocalAnalysis } = await loadEngine();
      const r = await runLocalAnalysis(local, {
        lookup: makeLookupClient(config.mempoolBaseUrl, controller.signal),
        signal: controller.signal,
        boltzmannTimeoutMs: (getAnalysisSettings().boltzmannTimeout ?? 300) * 1000,
        isCustomApi,
      });
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        result: r.result,
        txData: r.tx,
        boltzmannResult: r.boltzmannResult,
        boltzmannStatus: r.boltzmannStatus,
        localOutputTxCounts: r.outputTxCounts,
        localLookup: prev.localLookup && { ...prev.localLookup, status: "done" },
      }));
    } catch {
      if (controller.signal.aborted) return;
      setState((prev) => ({ ...prev, localLookup: prev.localLookup && { ...prev.localLookup, status: "failed" } }));
    }
  }, [state.localTx, state.localLookup?.status, config, isCustomApi]);

  // Abort in-flight requests on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  return { ...state, analyze, reset, retryLocal, completeLocalLookup };
}
