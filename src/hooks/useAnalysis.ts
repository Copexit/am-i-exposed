"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { detectTxidNetwork } from "@/lib/api/detect-network";
import { mapApiErrorMessage } from "@/lib/api/error-message";
import { NETWORK_CONFIG, type BitcoinNetwork } from "@/lib/bitcoin/networks";
import { detectInputType } from "@/lib/analysis/detect-input";
import {
  analyzeTransaction,
  getTxHeuristicSteps,
  getAddressHeuristicSteps,
} from "@/lib/analysis/orchestrator";
import { checkOfac } from "@/lib/analysis/cex-risk/ofac-check";
import { parsePSBT } from "@/lib/bitcoin/psbt";
import { getAnalysisSettings, type AnalysisSettings } from "@/hooks/useAnalysisSettings";
import { getCachedResult, putCachedResult } from "@/lib/api/analysis-cache";
import { loadEntityFilter } from "@/lib/analysis/entity-filter";
import { runTxidAnalysis } from "@/lib/analysis/run-txid-analysis";
import { runAddressAnalysis } from "@/lib/analysis/run-address-analysis";
import type { HeuristicTranslator } from "@/lib/analysis/heuristics/types";

import {
  type AnalysisState,
  INITIAL_STATE,
  makeOfacPreSendResult,
  markAllDone,
} from "@/hooks/useAnalysisState";

// Re-export types that components import from this module
export type { FetchProgress } from "@/hooks/useAnalysisState";
export type { PreSendResult } from "@/lib/analysis/orchestrator";

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const { network, setNetwork, config, configFor, customApiUrl, isUmbrel } = useNetwork();
  const { t } = useTranslation();
  const abortRef = useRef<AbortController | null>(null);
  /** Cache write owed by the analysis that just completed; flushed after the commit. */
  const pendingCacheRef = useRef<{ network: BitcoinNetwork; input: string; settings: AnalysisSettings } | null>(null);

  // Auto-load core entity filter on mount
  useEffect(() => { loadEntityFilter(); }, []);

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

  const isCustomApi =
    config.mempoolBaseUrl !== NETWORK_CONFIG[network].mempoolBaseUrl;

  const analyze = useCallback(
    async (input: string) => {
      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      pendingCacheRef.current = null;
      const inputType = detectInputType(input, network);

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

      // PSBT: parse locally and run tx heuristics without API calls
      if (inputType === "psbt") {
        const steps = getTxHeuristicSteps(ht);
        const startTime = Date.now();
        setState({
          ...INITIAL_STATE,
          phase: "analyzing",
          query: input.slice(0, 32) + "...",
          inputType: "psbt",
          steps,
        });

        try {
          const psbtResult = parsePSBT(input, network);
          const result = await analyzeTransaction(psbtResult.tx, undefined, onStep);
          if (controller.signal.aborted) return;
          // No trace data for PSBTs - mark all chain steps as done
          for (const cid of ["chain-backward", "chain-forward", "chain-cluster", "chain-spending", "chain-entity", "chain-taint"]) {
            onStep(cid); onStep(cid, 0);
          }

          const durationMs = Date.now() - startTime;
          setState((prev) => ({
            ...prev,
            phase: "complete",
            steps: markAllDone(prev.steps),
            result,
            txData: psbtResult.tx,
            psbtData: psbtResult,
            durationMs,
          }));
        } catch (err) {
          if (controller.signal.aborted) return;
          setState((prev) => ({
            ...prev,
            phase: "error",
            error: err instanceof Error
              ? t("errors.psbt_parse", { defaultValue: `Failed to parse PSBT: ${err.message}` })
              : t("errors.unexpected", { defaultValue: "An unexpected error occurred." }),
            errorCode: "not-retryable",
          }));
        }
        return;
      }

      // Check analysis result cache before making API calls
      const analysisSettingsForCache = getAnalysisSettings();
      const cached = await getCachedResult(network, input, analysisSettingsForCache);
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
        });
        return;
      }

      const api = createApiClient(config, controller.signal);

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
        // TODO(types stream): drop the cast once ScoringResult declares `partial?: boolean`
        if (cacheNetwork && !(fields.result as { partial?: boolean } | null | undefined)?.partial) {
          pendingCacheRef.current = { network: cacheNetwork, input, settings: analysisSettingsForCache };
        }
        const durationMs = Date.now() - startTime;
        setState((prev) => ({
          ...prev,
          phase: "complete",
          steps: markAllDone(prev.steps),
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
      });

      try {
        if (inputType === "txid") {
          const txResult = await runTxidAnalysis(input, {
            api,
            controller,
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
            complete({ preSendResult: addrResult.preSendResult });
            return;
          }

          complete({
            result: addrResult.result,
            preSendResult: addrResult.preSendResult,
            addressTxs: addrResult.addressTxs,
            addressUtxos: addrResult.addressUtxos,
            txBreakdown: addrResult.txBreakdown,
          }, network);
        }
      } catch (err) {
        // Ignore aborted requests (user started a new analysis)
        if (controller.signal.aborted) return;

        // For address queries, even when API fails, check OFAC locally
        if (inputType === "address") {
          const fallbackOfac = checkOfac([input]);
          if (fallbackOfac.sanctioned) {
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
          !customApiUrl
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
    [network, setNetwork, config, configFor, customApiUrl, isCustomApi, isUmbrel, t, ht, onStep],
  );

  // Flush the cache write owed by a just-completed analysis from committed state
  // (never from inside a setState updater, which React may run more than once).
  useEffect(() => {
    const pending = pendingCacheRef.current;
    if (!pending || state.phase !== "complete") return;
    pendingCacheRef.current = null;
    putCachedResult(pending.network, pending.input, pending.settings, state)
      .catch((e) => console.warn("cache write failed:", e));
  }, [state]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    pendingCacheRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  // Abort in-flight requests on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  return { ...state, analyze, reset };
}
