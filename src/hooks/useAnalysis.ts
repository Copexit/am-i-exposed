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
  getTxHeuristicSteps,
  getAddressHeuristicSteps,
} from "@/lib/analysis/orchestrator";
import { checkOfac } from "@/lib/analysis/cex-risk/ofac-check";
import { parsePSBT } from "@/lib/bitcoin/psbt";
import { getAnalysisSettings } from "@/hooks/useAnalysisSettings";
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

          setState((prev) => {
            const completeState = {
              ...prev,
              phase: "complete" as const,
              steps: markAllDone(prev.steps),
              result: txResult.result,
              boltzmannResult: txResult.boltzmannResult,
              boltzmannStatus: txResult.boltzmannStatus as AnalysisState["boltzmannStatus"],
              durationMs: Date.now() - startTime,
            };
            // Fire-and-forget cache write
            putCachedResult(network, input, analysisSettingsForCache, completeState).catch((e) => console.warn("cache write failed:", e));
            return completeState;
          });
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
            setState((prev) => ({
              ...prev,
              phase: "complete",
              steps: markAllDone(prev.steps),
              preSendResult: addrResult.preSendResult,
              durationMs: Date.now() - startTime,
            }));
            return;
          }

          setState((prev) => {
            const completeState = {
              ...prev,
              phase: "complete" as const,
              steps: markAllDone(prev.steps),
              result: addrResult.result,
              preSendResult: addrResult.preSendResult,
              addressTxs: addrResult.addressTxs,
              addressUtxos: addrResult.addressUtxos,
              txBreakdown: addrResult.txBreakdown,
              durationMs: Date.now() - startTime,
            };
            // Fire-and-forget cache write
            putCachedResult(network, input, analysisSettingsForCache, completeState).catch((e) => console.warn("cache write failed:", e));
            return completeState;
          });
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
