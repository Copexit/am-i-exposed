"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { MempoolTransaction } from "@/lib/api/types";
import { computeBoltzmann, isAutoComputable, extractTxValues } from "@/lib/analysis/boltzmann-compute";
import {
  MAX_SUPPORTED_TOTAL,
  terminatePool,
} from "@/lib/analysis/boltzmann-pool";

export interface BoltzmannWorkerResult {
  type: "result";
  id: string;
  matLnkCombinations: number[][];
  matLnkProbabilities: number[][];
  nbCmbn: number;
  entropy: number;
  efficiency: number;
  nbCmbnPrfctCj: number;
  deterministicLinks: [number, number][];
  timedOut: boolean;
  elapsedMs: number;
  nInputs: number;
  nOutputs: number;
  fees: number;
  intraFeesMaker: number;
  intraFeesTaker: number;
}

export interface BoltzmannProgress {
  fraction: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
}

export interface BoltzmannState {
  status: "idle" | "loading" | "computing" | "complete" | "error" | "unsupported";
  result: BoltzmannWorkerResult | null;
  error: string | null;
  progress: BoltzmannProgress | null;
}

const INITIAL_STATE: BoltzmannState = {
  status: "idle",
  result: null,
  error: null,
  progress: null,
};

export function useBoltzmann(
  tx: MempoolTransaction | null,
  precomputed?: BoltzmannWorkerResult | null,
) {
  const [state, setState] = useState<BoltzmannState>(INITIAL_STATE);
  const requestIdRef = useRef<string | null>(null);
  const computedTxidRef = useRef<string | null>(null);

  const cancel = useCallback(() => {
    requestIdRef.current = null;
    terminatePool();
    setState(INITIAL_STATE);
  }, []);

  const compute = useCallback(async () => {
    if (!tx) return;

    if (typeof Worker === "undefined") {
      setState({ status: "unsupported", result: null, error: null, progress: null });
      return;
    }

    const isCoinbase = tx.vin.some(v => v.is_coinbase);
    if (isCoinbase) {
      setState({ status: "idle", result: null, error: null, progress: null });
      return;
    }

    const { inputValues, outputValues } = extractTxValues(tx);
    const nIn = inputValues.length;
    const nOut = outputValues.length;

    if (nIn === 0 || nOut === 0) {
      setState({ status: "idle", result: null, error: null, progress: null });
      return;
    }

    if (nIn + nOut > MAX_SUPPORTED_TOTAL) {
      setState({ status: "idle", result: null, error: null, progress: null });
      return;
    }

    const id = `${tx.txid}-${Date.now()}`;
    requestIdRef.current = id;
    computedTxidRef.current = tx.txid;

    setState({ status: "computing", result: null, error: null, progress: null });

    try {
      const result = await computeBoltzmann(tx, {
        onProgress: (p) => {
          if (requestIdRef.current !== id) return;
          setState(prev => ({
            ...prev,
            status: "computing",
            progress: p,
          }));
        },
      });

      if (requestIdRef.current !== id) return;

      if (result) {
        setState({ status: "complete", result, error: null, progress: null });
      } else {
        setState({ status: "error", result: null, error: "Computation failed", progress: null });
      }
    } catch (err) {
      if (requestIdRef.current !== id) return;
      setState({
        status: "error",
        result: null,
        error: err instanceof Error ? err.message : String(err),
        progress: null,
      });
    }
  }, [tx]);

  // If precomputed result is available, use it directly. Otherwise auto-compute for small txs.
  useEffect(() => {
    if (!tx) {
      computedTxidRef.current = null;
      return;
    }

    // Use precomputed result from the analysis pipeline
    if (precomputed) {
      computedTxidRef.current = tx.txid;
      const timer = setTimeout(() => {
        setState({ status: "complete", result: precomputed, error: null, progress: null });
      }, 0);
      return () => clearTimeout(timer);
    }

    // Don't re-compute if already done for this txid
    if (computedTxidRef.current === tx.txid) {
      return;
    }

    const isCoinbase = tx.vin.some(v => v.is_coinbase);
    if (isCoinbase) return;

    const { inputValues, outputValues } = extractTxValues(tx);
    const nIn = inputValues.length;
    const nOut = outputValues.length;

    if (nIn === 0 || nOut === 0) return;
    if (nIn + nOut > MAX_SUPPORTED_TOTAL) return;

    if (isAutoComputable(inputValues, outputValues)) {
      const timer = setTimeout(compute, 0);
      return () => {
        clearTimeout(timer);
        requestIdRef.current = null;
      };
    }

    return () => {
      requestIdRef.current = null;
    };
  }, [tx?.txid, precomputed]); // eslint-disable-line react-hooks/exhaustive-deps

  const autoComputed = tx
    ? (() => {
        const { inputValues, outputValues } = extractTxValues(tx);
        return isAutoComputable(inputValues, outputValues);
      })()
    : false;

  const isSupported = tx
    ? (() => {
        const isCoinbase = tx.vin.some(v => v.is_coinbase);
        if (isCoinbase) return false;
        const nIn = tx.vin.filter(v => !v.is_coinbase && v.prevout).length;
        const nOut = tx.vout.filter(o => o.scriptpubkey_type !== "op_return" && o.value > 0).length;
        return nIn >= 1 && nOut >= 1 && nIn + nOut <= MAX_SUPPORTED_TOTAL;
      })()
    : false;

  return { state, compute, cancel, autoComputed, isSupported };
}
