"use client";

import { useState, useCallback, useRef } from "react";
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
  type HeuristicStep,
  type PreSendResult,
} from "@/lib/analysis/orchestrator";
import { checkOfac } from "@/lib/analysis/cex-risk/ofac-check";
import type { ScoringResult, InputType, TxAnalysisResult } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";
import type { HeuristicTranslator } from "@/lib/analysis/heuristics/types";

export type AnalysisPhase =
  | "idle"
  | "fetching"
  | "analyzing"
  | "complete"
  | "error";

export interface AnalysisState {
  phase: AnalysisPhase;
  query: string | null;
  inputType: InputType | null;
  steps: HeuristicStep[];
  result: ScoringResult | null;
  txData: MempoolTransaction | null;
  addressData: import("@/lib/api/types").MempoolAddress | null;
  addressTxs: MempoolTransaction[] | null;
  txBreakdown: TxAnalysisResult[] | null;
  preSendResult: PreSendResult | null;
  error: string | null;
  /** Error classification for UI logic (e.g. hide retry on non-retryable errors) */
  errorCode: "retryable" | "not-retryable" | null;
  durationMs: number | null;
}

const INITIAL_STATE: AnalysisState = {
  phase: "idle",
  query: null,
  inputType: null,
  steps: [],
  result: null,
  txData: null,
  addressData: null,
  addressTxs: null,
  txBreakdown: null,
  preSendResult: null,
  error: null,
  errorCode: null,
  durationMs: null,
};

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const { network, config } = useNetwork();
  const { t } = useTranslation();
  const abortRef = useRef<AbortController | null>(null);

  // Wrap t as HeuristicTranslator for passing into analysis layer
  const ht: HeuristicTranslator = useCallback(
    (key: string, options?: Record<string, unknown>) => t(key, options as Record<string, string>),
    [t],
  );

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

          setState((prev) => ({
            ...prev,
            phase: "analyzing",
            txData: tx,
          }));

          const result = await analyzeTransaction(tx, rawHex, (stepId, impact) => {
            setState((prev) => ({
              ...prev,
              steps: prev.steps.map((s) => {
                if (s.id === stepId) {
                  // If impact is provided, mark as done with impact
                  if (impact !== undefined) {
                    return { ...s, status: "done" as const, impact };
                  }
                  // Otherwise mark as running
                  return { ...s, status: "running" as const };
                }
                // Previous running step becomes done (if no impact was set yet)
                if (s.status === "running") {
                  return { ...s, status: "done" as const };
                }
                return s;
              }),
            }));
          });

          setState((prev) => ({
            ...prev,
            phase: "complete",
            steps: prev.steps.map((s) => ({ ...s, status: "done" as const })),
            result,
            durationMs: Date.now() - startTime,
          }));
        } else {
          // Fetch address data - UTXOs may fail for addresses with >500 UTXOs
          const [address, utxos, txs] = await Promise.all([
            api.getAddress(input),
            api.getAddressUtxos(input).catch(() => [] as import("@/lib/api/types").MempoolUtxo[]),
            api.getAddressTxs(input).catch(() => [] as import("@/lib/api/types").MempoolTransaction[]),
          ]);

          setState((prev) => ({ ...prev, phase: "analyzing", addressData: address }));

          const result = await analyzeAddress(
            address,
            utxos,
            txs,
            (stepId, impact) => {
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
            },
          );

          // Run per-tx heuristic breakdown for address analysis
          const txBreakdown = txs.length > 0
            ? await analyzeTransactionsForAddress(input, txs)
            : null;

          setState((prev) => ({
            ...prev,
            phase: "complete",
            steps: prev.steps.map((s) => ({ ...s, status: "done" as const })),
            result,
            addressTxs: txs.length > 0 ? txs : null,
            txBreakdown,
            durationMs: Date.now() - startTime,
          }));
        }
      } catch (err) {
        // Ignore aborted requests (user started a new analysis)
        if (controller.signal.aborted) return;

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
              message = isCustomApi
                ? t("errors.network_custom", { defaultValue: "Connection to your custom endpoint failed. Open API settings to troubleshoot." })
                : t("errors.network", { defaultValue: "Network error. Check your internet connection or try again later." });
              break;
            case "API_UNAVAILABLE":
              message = isCustomApi
                ? t("errors.api_custom", { defaultValue: "Your custom API endpoint returned an error. Check that it is running." })
                : t("errors.api_unavailable", { defaultValue: "The API is temporarily unavailable. Please try again later." });
              break;
          }
        } else if (err instanceof Error) {
          console.error("Analysis error:", err.name);
          message = t("errors.unexpected", { defaultValue: "An unexpected error occurred. Please try again." });
        }
        setState((prev) => ({
          ...prev,
          phase: "error",
          error: message,
          errorCode,
        }));
      }
    },
    [network, config, isCustomApi, t, ht],
  );

  const checkDestination = useCallback(
    async (input: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const inputType = detectInputType(input, network);

      if (inputType !== "address") {
        setState({
          ...INITIAL_STATE,
          phase: "error",
          query: input,
          inputType: inputType === "txid" ? "txid" : "invalid",
          error: inputType === "txid"
            ? t("errors.presend_txid", { defaultValue: "Pre-send check only works with addresses, not transaction IDs." })
            : t("errors.invalid_address", { defaultValue: "Invalid Bitcoin address." }),
          errorCode: "not-retryable",
        });
        return;
      }

      const api = createApiClient(config, controller.signal);
      const steps = getAddressHeuristicSteps(ht);
      const startTime = Date.now();

      // Run local OFAC check first - no network needed
      const ofacResult = checkOfac([input]);
      if (ofacResult.sanctioned) {
        const preSendResult: PreSendResult = {
          riskLevel: "CRITICAL",
          summary: t("presend.adviceCritical", { defaultValue: "Do NOT send to this address. It poses severe privacy or legal risks." }),
          findings: [
            {
              id: "h13-presend-check",
              severity: "critical",
              title: t("finding.h13-presend-check.title", { riskLevel: "CRITICAL", defaultValue: "Destination risk: CRITICAL" }),
              description: t("presend.adviceCritical", { defaultValue: "Do NOT send to this address. It poses severe privacy or legal risks." }),
              recommendation: t("finding.h13-ofac-match.recommendation", { defaultValue: "Do NOT send funds to this address. Consult legal counsel if you have already transacted with this address." }),
              scoreImpact: 0,
            },
            {
              id: "h13-ofac-match",
              severity: "critical",
              title: t("finding.h13-ofac-match.title", { defaultValue: "OFAC sanctioned address" }),
              description: t("finding.h13-ofac-match.description", { defaultValue: "This address matches an entry on the U.S. Treasury OFAC Specially Designated Nationals (SDN) list. Transacting with sanctioned addresses may have serious legal consequences." }),
              recommendation: t("finding.h13-ofac-match.recommendation", { defaultValue: "Do NOT send funds to this address. Consult legal counsel if you have already transacted with this address." }),
              scoreImpact: -100,
            },
          ],
          txCount: 0,
          timesReceived: 0,
          totalReceived: 0,
        };
        setState({
          ...INITIAL_STATE,
          phase: "complete",
          query: input,
          inputType: "address",
          steps: steps.map((s) => ({ ...s, status: "done" as const })),
          preSendResult,
          durationMs: Date.now() - startTime,
        });
        return;
      }

      setState({
        ...INITIAL_STATE,
        phase: "fetching",
        query: input,
        inputType: "address",
        steps,
      });

      try {
        const [address, utxos, txs] = await Promise.all([
          api.getAddress(input),
          api.getAddressUtxos(input).catch(() => [] as import("@/lib/api/types").MempoolUtxo[]),
          api.getAddressTxs(input).catch(() => [] as import("@/lib/api/types").MempoolTransaction[]),
        ]);

        setState((prev) => ({ ...prev, phase: "analyzing", addressData: address }));

        const preSendResult = await analyzeDestination(
          address,
          utxos,
          txs,
          (stepId, impact) => {
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
          },
        );

        setState((prev) => ({
          ...prev,
          phase: "complete",
          steps: prev.steps.map((s) => ({ ...s, status: "done" as const })),
          preSendResult,
          durationMs: Date.now() - startTime,
        }));
      } catch (err) {
        if (controller.signal.aborted) return;

        // Even when the API fails, run the local OFAC check - it needs no API data
        const ofacResult = checkOfac([input]);
        if (ofacResult.sanctioned) {
          const preSendResult: PreSendResult = {
            riskLevel: "CRITICAL",
            summary:
              "This address appears on the OFAC sanctions list. " +
              "Sending funds to this address may violate sanctions law.",
            findings: [
              {
                id: "h13-presend-check",
                severity: "critical",
                title: "Destination risk: CRITICAL",
                description:
                  "This address appears on the OFAC sanctions list. " +
                  "Sending funds to this address may violate sanctions law.",
                recommendation:
                  "Do NOT send funds to this address. Consult legal counsel if you have already transacted with this address.",
                scoreImpact: 0,
              },
              {
                id: "h13-ofac-match",
                severity: "critical",
                title: "OFAC sanctioned address",
                description:
                  "This address matches an entry on the U.S. Treasury OFAC Specially Designated Nationals (SDN) list. " +
                  "Transacting with sanctioned addresses may have serious legal consequences.",
                recommendation:
                  "Do NOT send funds to this address. Consult legal counsel if you have already transacted with this address.",
                scoreImpact: -100,
              },
            ],
            txCount: 0,
            timesReceived: 0,
            totalReceived: 0,
          };
          setState((prev) => ({
            ...prev,
            phase: "complete",
            steps: prev.steps.map((s) => ({ ...s, status: "done" as const })),
            preSendResult,
            durationMs: Date.now() - startTime,
          }));
          return;
        }

        let message = t("errors.unexpected", { defaultValue: "An unexpected error occurred." });
        let errorCode: "retryable" | "not-retryable" = "retryable";
        if (err instanceof ApiError) {
          switch (err.code) {
            case "NOT_FOUND":
              message = t("errors.address_not_found", { defaultValue: "Address not found. Check that it's correct and exists on the selected network." });
              errorCode = "not-retryable";
              break;
            case "INVALID_INPUT":
              errorCode = "not-retryable";
              break;
            case "RATE_LIMITED":
              message = t("errors.rate_limited_short", { defaultValue: "Rate limited. Please wait a moment and try again." });
              break;
            case "NETWORK_ERROR":
              message = isCustomApi
                ? t("errors.network_custom", { defaultValue: "Connection to your custom endpoint failed. Open API settings to troubleshoot." })
                : t("errors.network_short", { defaultValue: "Network error. Check your internet connection." });
              break;
            case "API_UNAVAILABLE":
              message = isCustomApi
                ? t("errors.api_custom", { defaultValue: "Your custom API endpoint returned an error. Check that it is running." })
                : t("errors.api_unavailable_short", { defaultValue: "API temporarily unavailable. Try again later." });
              break;
          }
        } else if (err instanceof Error) {
          console.error("Check error:", err.name);
          message = t("errors.unexpected", { defaultValue: "An unexpected error occurred. Please try again." });
        }
        setState((prev) => ({ ...prev, phase: "error", error: message, errorCode }));
      }
    },
    [network, config, isCustomApi, t, ht],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { ...state, analyze, checkDestination, reset };
}
