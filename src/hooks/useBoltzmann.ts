"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { MempoolTransaction } from "@/lib/api/types";
import { computeBoltzmann, isAutoComputable } from "@/lib/analysis/boltzmann-compute";
import {
  terminatePool,
  onPoolTerminate,
  type BoltzmannWorkerResult,
  type BoltzmannProgress,
} from "@/lib/analysis/boltzmann-pool";
import { getBoltzmannEligibility, extractTxValues } from "@/lib/analysis/boltzmann-eligibility";

export type { BoltzmannWorkerResult, BoltzmannProgress };

export interface BoltzmannState {
  /** "cancelled": another compute took the shared worker pool before this one finished. */
  status: "idle" | "loading" | "computing" | "complete" | "error" | "cancelled" | "unsupported";
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

    const eligibility = getBoltzmannEligibility(tx);
    if (!eligibility.canCompute) {
      setState({ status: "idle", result: null, error: null, progress: null });
      return;
    }

    const id = `${tx.txid}-${Date.now()}`;
    requestIdRef.current = id;
    computedTxidRef.current = tx.txid;

    setState({ status: "computing", result: null, error: null, progress: null });

    // computeBoltzmann terminates the pool synchronously when it starts, so a
    // terminate seen after this call means another compute preempted ours.
    let preempted = false;
    let unregister = () => {};
    try {
      const pending = computeBoltzmann(tx, {
        onProgress: (p) => {
          if (requestIdRef.current !== id) return;
          setState(prev => ({
            ...prev,
            status: "computing",
            progress: p,
          }));
        },
      });
      unregister = onPoolTerminate(() => { preempted = true; });
      const result = await pending;

      if (requestIdRef.current !== id) return;

      if (result) {
        setState({ status: "complete", result, error: null, progress: null });
      } else if (preempted) {
        setState({ status: "cancelled", result: null, error: null, progress: null });
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
    } finally {
      unregister();
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

    const eligibility = getBoltzmannEligibility(tx);
    if (!eligibility.canCompute) return;

    if (isAutoComputable(eligibility.inputValues, eligibility.outputValues)) {
      const timer = setTimeout(() => void compute(), 0);
      return () => {
        clearTimeout(timer);
        requestIdRef.current = null;
      };
    }

    return () => {
      requestIdRef.current = null;
    };
  }, [tx, precomputed, compute]);

  const autoComputed = useMemo(() => {
    if (!tx) return false;
    const { inputValues, outputValues } = extractTxValues(tx);
    return isAutoComputable(inputValues, outputValues);
  }, [tx]);

  const isSupported = useMemo(() => {
    if (!tx) return false;
    return getBoltzmannEligibility(tx).canCompute;
  }, [tx]);

  return { state, compute, cancel, autoComputed, isSupported };
}
