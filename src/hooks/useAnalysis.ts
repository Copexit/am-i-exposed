"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { NETWORK_CONFIG } from "@/lib/bitcoin/networks";
import { detectInputType } from "@/lib/analysis/detect-input";
import {
  analyzeTransaction,
  analyzeAddress,
  analyzeDestination,
  analyzeTransactionsForAddress,
  getTxHeuristicSteps,
  getAddressHeuristicSteps,
} from "@/lib/analysis/orchestrator";
import { checkOfac } from "@/lib/analysis/cex-risk/ofac-check";
import { needsEnrichment, enrichPrevouts, countNullPrevouts } from "@/lib/api/enrich-prevouts";
import { parsePSBT } from "@/lib/bitcoin/psbt";
import { getAnalysisSettings } from "@/hooks/useAnalysisSettings";
import { getCachedResult, putCachedResult } from "@/lib/api/analysis-cache";
import { loadEntityFilter } from "@/lib/analysis/entity-filter";
import { computeBoltzmann, isAutoComputable, extractTxValues } from "@/lib/analysis/boltzmann-compute";
import { enhanceEntropyFinding } from "@/lib/analysis/boltzmann-enhance";
import type { Finding } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ApiClient } from "@/lib/api/client";
import type { HeuristicTranslator } from "@/lib/analysis/heuristics/types";

import {
  type AnalysisState,
  INITIAL_STATE,
  makeIncompletePrevoutFinding,
  makeOfacPreSendResult,
  markAllDone,
} from "@/hooks/useAnalysisState";
import { runChainTrace, runChainAnalysis } from "@/hooks/useChainTrace";

// Re-export types that components import from this module
export type { FetchProgress } from "@/hooks/useAnalysisState";
export type { PreSendResult } from "@/lib/analysis/orchestrator";

/**
 * Enrich a BIP47 notification finding with the notification address tx count.
 * The notification address is reused by every party opening a BIP47 channel
 * to that PayNym, so the tx count reveals how many channels have been opened.
 * Mutates the finding in-place. Silently no-ops on error.
 */
async function enrichBip47Finding(
  findings: Finding[],
  api: ApiClient,
  signal: AbortSignal,
): Promise<void> {
  const bip47 = findings.find((f) => f.id === "bip47-notification");
  if (!bip47) return;

  const addr = bip47.params?.notificationAddress;
  if (typeof addr !== "string" || addr === "") return;

  try {
    const addrInfo = await api.getAddress(addr);
    if (signal.aborted) return;

    const txCount =
      addrInfo.chain_stats.tx_count + addrInfo.mempool_stats.tx_count;

    bip47.params = {
      ...bip47.params,
      notificationTxCount: txCount,
      channelInfo: txCount > 1
        ? ` The notification address has received ${txCount} transactions, indicating ${txCount} BIP47 payment channels have been opened to this PayNym. While this address is reused and publicly visible, the actual payment addresses derived through each channel are unique and cannot be linked without knowledge of the payment codes.`
        : " This appears to be the first notification to this address. The notification address is reused and publicly visible, but the actual payment addresses derived through the channel are unique and cannot be linked without knowledge of the payment codes.",
    };
  } catch {
    // Non-critical enrichment - do not fail the analysis
  }
}

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const { network, config, isUmbrel } = useNetwork();
  const { t } = useTranslation();
  const abortRef = useRef<AbortController | null>(null);

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
          const psbtResult = parsePSBT(input);
          const result = await analyzeTransaction(psbtResult.tx, undefined, onStep);
          if (controller.signal.aborted) return;
          // No trace data for PSBTs - mark all chain steps as done
          for (const cid of ["chain-backward", "chain-forward", "chain-cluster", "chain-spending", "chain-entity", "chain-taint"]) {
            onStep(cid); onStep(cid, 0);
          }

          setState((prev) => ({
            ...prev,
            phase: "complete",
            steps: markAllDone(prev.steps),
            result,
            txData: psbtResult.tx,
            psbtData: psbtResult,
            durationMs: Date.now() - startTime,
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
      if (cached && !controller.signal.aborted) {
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

      setState({
        ...INITIAL_STATE,
        phase: "fetching",
        query: input,
        inputType,
        steps,
      });

      try {
        if (inputType === "txid") {
          const [tx, rawHex] = await Promise.all([
            api.getTransaction(input),
            api.getTxHex(input).catch(() => undefined),
          ]);

          // Enrich missing prevout data for self-hosted mempool backends
          if (needsEnrichment([tx])) {
            await enrichPrevouts([tx], {
              getTransaction: (txid) => api.getTransaction(txid),
              signal: controller.signal,
            });
          }

          // Start Boltzmann computation early (in parallel with price/trace fetches)
          const txValues = extractTxValues(tx);
          const shouldAutoBoltzmann = isAutoComputable(txValues.inputValues, txValues.outputValues);
          const boltzmannPromise = shouldAutoBoltzmann
            ? computeBoltzmann(tx, {
                timeoutMs: (analysisSettingsForCache.boltzmannTimeout ?? 300) * 1000,
                signal: controller.signal,
              }).catch(() => null)
            : Promise.resolve(null);

          // Fetch historical fiat prices + outspend data for confirmed txs
          // Also pre-fetch parent tx for peel chain detection (only for 1-input txs)
          let usdPrice: number | null = null;
          let eurPrice: number | null = null;
          let outspends: import("@/lib/api/types").MempoolOutspend[] | null = null;
          let parentTx: MempoolTransaction | null = null;
          const isPeelCandidate = tx.vin.length === 1 && !tx.vin[0].is_coinbase;
          const parentTxPromise = isPeelCandidate
            ? api.getTransaction(tx.vin[0].txid).catch(() => null)
            : Promise.resolve(null);

          if (network === "mainnet" && tx.status?.block_time) {
            [usdPrice, eurPrice, outspends, parentTx] = await Promise.all([
              api.getHistoricalPrice(tx.status.block_time).catch(() => null),
              api.getHistoricalEurPrice(tx.status.block_time).catch(() => null),
              api.getTxOutspends(input).catch(() => null),
              parentTxPromise,
            ]);
          } else if (tx.status?.confirmed) {
            [outspends, parentTx] = await Promise.all([
              api.getTxOutspends(input).catch(() => null),
              parentTxPromise,
            ]);
          } else {
            parentTx = await parentTxPromise;
          }

          // Fetch child tx for peel chain detection: if one of our outputs was
          // spent, fetch the spending tx to check if it continues the peel pattern
          let childTx: MempoolTransaction | null = null;
          if (outspends && isPeelCandidate) {
            const spentEntry = outspends.find((o) => o.spent && o.txid);
            if (spentEntry?.txid) {
              childTx = await api.getTransaction(spentEntry.txid).catch(() => null);
            }
          }

          // Pre-fetch output address tx counts for fresh address change detection (H2 sub-heuristic 8)
          // Only for 2-output txs (the change detection heuristic only applies to these)
          let outputTxCounts: Map<string, number> | undefined;
          const spendableOuts = tx.vout.filter(
            (v) => v.scriptpubkey_type !== "op_return" && v.scriptpubkey_address && v.value > 0,
          );
          if (spendableOuts.length === 2) {
            const addrs = spendableOuts.map((v) => v.scriptpubkey_address!);
            const counts = await Promise.all(
              addrs.map((addr) =>
                api.getAddress(addr)
                  .then((a) => a.chain_stats.tx_count + a.mempool_stats.tx_count)
                  .catch(() => -1),
              ),
            );
            if (counts.every((c) => c >= 0)) {
              outputTxCounts = new Map(addrs.map((a, i) => [a, counts[i]]));
            }
          }

          // --- Recursive tracing (chain analysis) ---
          const analysisSettings = getAnalysisSettings();
          const { backwardLayers, forwardLayers, backwardFailed, forwardFailed } = await runChainTrace({
            tx,
            settings: analysisSettings,
            api,
            controller,
            setState,
            onStep,
            parentTx,
            childTx,
            outspends,
          });

          if (controller.signal.aborted) return;

          setState((prev) => ({
            ...prev,
            phase: "analyzing",
            txData: tx,
            usdPrice,
            outspends,
            fetchProgress: { status: "done", timeoutSec: 0, currentDepth: 0, maxDepth: 0, txsFetched: 0 },
            backwardLayers: backwardLayers.length > 0 ? backwardLayers : null,
            forwardLayers: forwardLayers.length > 0 ? forwardLayers : null,
          }));

          const ctx: import("@/lib/analysis/heuristics/types").TxContext = {
            ...(usdPrice ? { usdPrice } : {}),
            ...(eurPrice ? { eurPrice } : {}),
            isCustomApi,
            ...(parentTx ? { parentTx } : {}),
            ...(childTx ? { childTx } : {}),
            ...(outputTxCounts ? { outputTxCounts } : {}),
          };
          const result = await analyzeTransaction(tx, rawHex, onStep, ctx);
          if (controller.signal.aborted) return;

          // --- BIP47 notification address enrichment ---
          // If a BIP47 notification finding exists with a notification address,
          // fetch the address stats to show how many channels have been opened
          await enrichBip47Finding(result.findings, api, controller.signal);

          // --- Chain analysis from trace layers ---
          await runChainAnalysis({
            tx,
            result,
            backwardLayers,
            forwardLayers,
            parentTx,
            childTx,
            outspends,
            onStep,
          });

          // Warn if chain tracing failed or timed out
          if (backwardFailed || forwardFailed) {
            const direction = backwardFailed && forwardFailed ? "backward and forward"
              : backwardFailed ? "backward" : "forward";
            result.findings.push({
              id: "chain-trace-partial",
              severity: "low",
              confidence: "high",
              title: `Chain tracing incomplete (${direction})`,
              description:
                `${direction.charAt(0).toUpperCase() + direction.slice(1)} tracing failed or timed out. ` +
                "Chain analysis results may be incomplete. This typically happens with rate-limited APIs or deep trace depths.",
              recommendation:
                "Try again with a shorter chain depth or longer timeout in Analysis settings.",
              scoreImpact: 0,
            });
          }

          // If prevout data is still missing after enrichment, warn the user
          const remainingNulls = countNullPrevouts([tx]);
          if (remainingNulls > 0) {
            result.findings.push(makeIncompletePrevoutFinding(remainingNulls));
          }

          // Await Boltzmann result (started earlier in parallel)
          const boltzmannResult = await boltzmannPromise;

          // Enhance entropy finding with real WASM Boltzmann data
          if (boltzmannResult && !boltzmannResult.timedOut) {
            enhanceEntropyFinding(result.findings, boltzmannResult);
          }

          setState((prev) => {
            const completeState = {
              ...prev,
              phase: "complete" as const,
              steps: markAllDone(prev.steps),
              result,
              boltzmannResult: boltzmannResult ?? null,
              boltzmannStatus: boltzmannResult ? "complete" as const : shouldAutoBoltzmann ? "error" as const : "idle" as const,
              durationMs: Date.now() - startTime,
            };
            // Fire-and-forget cache write
            putCachedResult(network, input, analysisSettingsForCache, completeState).catch(() => {});
            return completeState;
          });
        } else {
          // OFAC pre-flight check (no network needed)
          const ofacResult = checkOfac([input]);
          if (ofacResult.sanctioned) {
            setState({
              ...INITIAL_STATE,
              phase: "complete",
              query: input,
              inputType: "address",
              steps: steps.map((s) => ({ ...s, status: "done" as const })),
              preSendResult: makeOfacPreSendResult(t),
              durationMs: Date.now() - startTime,
            });
            return;
          }

          // Fetch address data - UTXOs may fail for addresses with >500 UTXOs
          const [address, utxos, txs] = await Promise.all([
            api.getAddress(input),
            api.getAddressUtxos(input).catch(() => [] as import("@/lib/api/types").MempoolUtxo[]),
            api.getAddressTxs(input).catch(() => [] as import("@/lib/api/types").MempoolTransaction[]),
          ]);

          // Enrich missing prevout data for self-hosted mempool backends
          if (txs.length > 0 && needsEnrichment(txs)) {
            await enrichPrevouts(txs, {
              getTransaction: (txid) => api.getTransaction(txid),
              signal: controller.signal,
              maxParentTxids: 50,
            });
          }

          setState((prev) => ({ ...prev, phase: "analyzing", addressData: address }));

          const totalTxCount = address.chain_stats.tx_count + address.mempool_stats.tx_count;
          const isFreshAddress = totalTxCount === 0;

          // Fresh address: no transactions, nothing to score - only run destination check
          if (isFreshAddress) {
            const preSendResult = await analyzeDestination(address, utxos, txs, onStep);

            setState((prev) => ({
              ...prev,
              phase: "complete",
              steps: markAllDone(prev.steps),
              preSendResult,
              durationMs: Date.now() - startTime,
            }));
          } else {
            // Run both address analysis AND destination check on the same data
            const [result, preSendResult] = await Promise.all([
              analyzeAddress(address, utxos, txs, onStep),
              analyzeDestination(address, utxos, txs),
            ]);
            if (controller.signal.aborted) return;

            // Run per-tx heuristic breakdown for address analysis
            const txBreakdown = txs.length > 0
              ? await analyzeTransactionsForAddress(input, txs)
              : null;
            if (controller.signal.aborted) return;

            // If prevout data is still missing after enrichment, warn the user
            if (txs.length > 0) {
              const remainingNulls = countNullPrevouts(txs);
              if (remainingNulls > 0) {
                result.findings.push(makeIncompletePrevoutFinding(remainingNulls, true));
              }
            }

            setState((prev) => {
              const completeState = {
                ...prev,
                phase: "complete" as const,
                steps: markAllDone(prev.steps),
                result,
                preSendResult,
                addressTxs: txs.length > 0 ? txs : null,
                addressUtxos: utxos.length > 0 ? utxos : null,
                txBreakdown,
                durationMs: Date.now() - startTime,
              };
              // Fire-and-forget cache write
              putCachedResult(network, input, analysisSettingsForCache, completeState).catch(() => {});
              return completeState;
            });
          }
        }
      } catch (err) {
        // Ignore aborted requests (user started a new analysis)
        if (controller.signal.aborted) return;

        // For address queries, even when API fails, check OFAC locally
        if (inputType === "address") {
          const fallbackOfac = checkOfac([input]);
          if (fallbackOfac.sanctioned) {
            setState((prev) => ({
              ...prev,
              phase: "complete",
              steps: markAllDone(prev.steps),
              preSendResult: makeOfacPreSendResult(t),
              durationMs: Date.now() - startTime,
            }));
            return;
          }
        }

        let message = t("errors.unexpected", { defaultValue: "An unexpected error occurred." });
        let errorCode: "retryable" | "not-retryable" = "retryable";
        if (err instanceof ApiError) {
          switch (err.code) {
            case "NOT_FOUND":
              message = t("errors.not_found", { defaultValue: "Not found. Check that the address or transaction ID is correct and exists on the selected network." });
              errorCode = "not-retryable";
              break;
            case "INVALID_INPUT":
              errorCode = "not-retryable";
              break;
            case "RATE_LIMITED":
              message = t("errors.rate_limited", { defaultValue: "Rate limited by mempool.space. Please wait a moment and try again." });
              break;
            case "NETWORK_ERROR":
              message = isUmbrel
                ? t("errors.network_umbrel", { defaultValue: "Connection to local mempool failed. Try restarting mempool from your Umbrel dashboard." })
                : isCustomApi
                  ? t("errors.network_custom", { defaultValue: "Connection to your custom endpoint failed. Open API settings to troubleshoot." })
                  : t("errors.network", { defaultValue: "Network error. Check your internet connection or try again later." });
              break;
            case "API_UNAVAILABLE":
              message = isUmbrel
                ? t("errors.api_umbrel", { defaultValue: "Local mempool returned an error. This address may have too many transactions for the Electrum backend to handle. Try restarting mempool or analyzing a different address." })
                : isCustomApi
                  ? t("errors.api_custom", { defaultValue: "Your custom API endpoint returned an error. Check that it is running." })
                  : t("errors.api_unavailable", { defaultValue: "The API is temporarily unavailable. Please try again later." });
              break;
          }
        } else if (err instanceof Error) {
          console.error("Analysis error:", err.name);
          message = t("errors.unexpected", { defaultValue: "An unexpected error occurred." });
        }
        setState((prev) => ({
          ...prev,
          phase: "error",
          error: message,
          errorCode,
        }));
      }
    },
    [network, config, isCustomApi, isUmbrel, t, ht, onStep],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  // Abort in-flight requests on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  return { ...state, analyze, reset };
}
