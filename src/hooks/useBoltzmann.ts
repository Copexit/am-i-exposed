"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { getAnalysisSettings } from "@/hooks/useAnalysisSettings";
import type { MempoolTransaction } from "@/lib/api/types";

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

interface WorkerError {
  type: "error";
  id: string;
  message: string;
}

interface WorkerProgress {
  type: "progress";
  id: string;
  fraction: number;
  elapsedMs: number;
  runFraction: number;
  runElapsedMs: number;
  runIndex: number;
  hasDualRun: boolean;
}

export interface BoltzmannProgress {
  fraction: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
}

type WorkerResponse = BoltzmannWorkerResult | WorkerError | WorkerProgress;

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

/** Auto-compute when total UTXOs (inputs + outputs) is under this threshold. */
const AUTO_COMPUTE_MAX_TOTAL = 20;

/** Maximum supported total UTXOs (inputs + outputs). */
const MAX_SUPPORTED_TOTAL = 50;

// Module-level singleton worker (lazy created)
let workerInstance: Worker | null = null;

function getOrCreateWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (!workerInstance) {
    try {
      workerInstance = new Worker("/workers/boltzmann.worker.js", { type: "module" });
    } catch {
      return null;
    }
  }
  return workerInstance;
}

function terminateWorker() {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}

export function useBoltzmann(tx: MempoolTransaction | null) {
  const [state, setState] = useState<BoltzmannState>(INITIAL_STATE);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const computedTxidRef = useRef<string | null>(null);

  const cancel = useCallback(() => {
    requestIdRef.current = null;
    if (workerRef.current) {
      // Terminate the worker to abort in-progress computation
      terminateWorker();
      workerRef.current = null;
    }
    setState(INITIAL_STATE);
  }, []);

  const compute = useCallback(() => {
    if (!tx) return;

    // Check Web Worker support
    if (typeof Worker === "undefined") {
      setState({ status: "unsupported", result: null, error: null, progress: null });
      return;
    }

    const isCoinbase = tx.vin.some(v => v.is_coinbase);
    if (isCoinbase) {
      setState({ status: "idle", result: null, error: null, progress: null });
      return;
    }

    const inputValues = tx.vin
      .filter(v => !v.is_coinbase && v.prevout)
      .map(v => v.prevout!.value);

    const outputValues = tx.vout
      .filter(o => o.scriptpubkey_type !== "op_return" && o.value > 0)
      .map(o => o.value);

    const nIn = inputValues.length;
    const nOut = outputValues.length;

    if (nIn <= 1 || nOut === 0) {
      setState({ status: "idle", result: null, error: null, progress: null });
      return;
    }

    if (nIn + nOut > MAX_SUPPORTED_TOTAL) {
      setState({ status: "idle", result: null, error: null, progress: null });
      return;
    }

    setState({ status: "loading", result: null, error: null, progress: null });

    const worker = getOrCreateWorker();
    if (!worker) {
      setState({ status: "unsupported", result: null, error: null, progress: null });
      return;
    }

    workerRef.current = worker;
    const id = `${tx.txid}-${Date.now()}`;
    requestIdRef.current = id;
    computedTxidRef.current = tx.txid;

    const { boltzmannTimeout = 300 } = getAnalysisSettings() as { boltzmannTimeout?: number };
    const timeoutMs = boltzmannTimeout * 1000;

    // Detect CoinJoin pattern for intrafees
    const valueCounts = new Map<number, number>();
    for (const v of outputValues) {
      valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1);
    }
    let maxCount = 0;
    for (const c of valueCounts.values()) {
      if (c > maxCount) maxCount = c;
    }
    const hasCjPattern = maxCount >= 2 && outputValues.length <= 2 * maxCount;
    const maxCjIntrafeesRatio = hasCjPattern ? 0.005 : 0.0;

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.id !== id) return;

      if (msg.type === "result") {
        setState({ status: "complete", result: msg, error: null, progress: null });
      } else if (msg.type === "error") {
        setState({ status: "error", result: null, error: msg.message, progress: null });
      } else if (msg.type === "progress") {
        // Estimate remaining time using per-run progress (more accurate for dual-run CoinJoins)
        let estimatedRemainingMs: number | null = null;
        if (msg.runFraction > 0.05) {
          // Estimate remaining time for the current run
          const runRemainingMs = (msg.runElapsedMs / msg.runFraction) * (1 - msg.runFraction);
          if (msg.hasDualRun && msg.runIndex === 0) {
            // Run 0 done soon - but run 1 could be much slower. Don't estimate yet.
            estimatedRemainingMs = null;
          } else {
            estimatedRemainingMs = Math.max(0, Math.round(runRemainingMs));
          }
        }
        setState(prev => ({
          ...prev,
          status: "computing",
          progress: {
            fraction: msg.fraction,
            elapsedMs: msg.elapsedMs,
            estimatedRemainingMs,
          },
        }));
      }
    };

    worker.onerror = (err) => {
      if (requestIdRef.current !== id) return;
      setState({ status: "error", result: null, error: err.message || "Worker error", progress: null });
      terminateWorker();
      workerRef.current = null;
    };

    setState({ status: "computing", result: null, error: null, progress: null });

    worker.postMessage({
      type: "compute",
      id,
      inputValues,
      outputValues,
      fee: tx.fee,
      maxCjIntrafeesRatio,
      timeoutMs,
    });
  }, [tx]);

  // Auto-compute for small transactions, reset on tx change
  useEffect(() => {
    if (!tx) {
      computedTxidRef.current = null;
      return;
    }

    // Don't re-compute if already done for this txid
    if (computedTxidRef.current === tx.txid) {
      return;
    }

    const isCoinbase = tx.vin.some(v => v.is_coinbase);
    if (isCoinbase) return;

    const nIn = tx.vin.filter(v => !v.is_coinbase && v.prevout).length;
    const nOut = tx.vout.filter(o => o.scriptpubkey_type !== "op_return" && o.value > 0).length;

    if (nIn <= 1 || nOut === 0) return;
    if (nIn + nOut > MAX_SUPPORTED_TOTAL) return;

    // Auto-compute for small txs (deferred to avoid setState-in-effect lint error)
    if (nIn + nOut < AUTO_COMPUTE_MAX_TOTAL) {
      const timer = setTimeout(compute, 0);
      return () => {
        clearTimeout(timer);
        requestIdRef.current = null;
      };
    }

    return () => {
      requestIdRef.current = null;
    };
  }, [tx?.txid]); // eslint-disable-line react-hooks/exhaustive-deps

  const autoComputed = tx
    ? (() => {
        const nIn = tx.vin.filter(v => !v.is_coinbase && v.prevout).length;
        const nOut = tx.vout.filter(o => o.scriptpubkey_type !== "op_return" && o.value > 0).length;
        return nIn + nOut < AUTO_COMPUTE_MAX_TOTAL;
      })()
    : false;

  const isSupported = tx
    ? (() => {
        const isCoinbase = tx.vin.some(v => v.is_coinbase);
        if (isCoinbase) return false;
        const nIn = tx.vin.filter(v => !v.is_coinbase && v.prevout).length;
        const nOut = tx.vout.filter(o => o.scriptpubkey_type !== "op_return" && o.value > 0).length;
        return nIn >= 2 && nOut >= 1 && nIn + nOut <= MAX_SUPPORTED_TOTAL;
      })()
    : false;

  return { state, compute, cancel, autoComputed, isSupported };
}
