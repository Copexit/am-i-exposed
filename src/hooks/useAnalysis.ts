"use client";

import { useState, useCallback, useRef } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/fetch-with-retry";
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
import type { ScoringResult, InputType, TxAnalysisResult } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";

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
  durationMs: null,
};

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const { network, config } = useNetwork();
  const abortRef = useRef<AbortController | null>(null);

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
          error: "Invalid Bitcoin address or transaction ID.",
        });
        return;
      }

      const api = createApiClient(config);

      const steps =
        inputType === "txid"
          ? getTxHeuristicSteps()
          : getAddressHeuristicSteps();

      const startTime = Date.now();

      setState({
        phase: "fetching",
        query: input,
        inputType,
        steps,
        result: null,
        txData: null,
        addressData: null,
        addressTxs: null,
        txBreakdown: null,
        preSendResult: null,
        error: null,
        durationMs: null,
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
            ? analyzeTransactionsForAddress(input, txs)
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

        let message = "An unexpected error occurred.";
        if (err instanceof ApiError) {
          switch (err.code) {
            case "NOT_FOUND":
              message = "Not found. Check that the address or transaction ID is correct and exists on the selected network.";
              break;
            case "RATE_LIMITED":
              message = "Rate limited by mempool.space. Please wait a moment and try again.";
              break;
            case "NETWORK_ERROR":
              message = "Network error. Check your internet connection or try again later.";
              break;
            case "API_UNAVAILABLE":
              message = "The API is temporarily unavailable. Please try again later.";
              break;
          }
        } else if (err instanceof Error) {
          message = err.message;
        }
        setState((prev) => ({
          ...prev,
          phase: "error",
          error: message,
        }));
      }
    },
    [network, config],
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
            ? "Pre-send check only works with addresses, not transaction IDs."
            : "Invalid Bitcoin address.",
        });
        return;
      }

      const api = createApiClient(config);
      const steps = getAddressHeuristicSteps();
      const startTime = Date.now();

      setState({
        phase: "fetching",
        query: input,
        inputType: "address",
        steps,
        result: null,
        txData: null,
        addressData: null,
        addressTxs: null,
        txBreakdown: null,
        preSendResult: null,
        error: null,
        durationMs: null,
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

        let message = "An unexpected error occurred.";
        if (err instanceof ApiError) {
          switch (err.code) {
            case "NOT_FOUND":
              message = "Address not found. Check that it's correct and exists on the selected network.";
              break;
            case "RATE_LIMITED":
              message = "Rate limited. Please wait a moment and try again.";
              break;
            case "NETWORK_ERROR":
              message = "Network error. Check your internet connection.";
              break;
            case "API_UNAVAILABLE":
              message = "API temporarily unavailable. Try again later.";
              break;
          }
        } else if (err instanceof Error) {
          message = err.message;
        }
        setState((prev) => ({ ...prev, phase: "error", error: message }));
      }
    },
    [network, config],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { ...state, analyze, checkDestination, reset };
}
