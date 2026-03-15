/**
 * Imperative (non-React) Boltzmann computation function.
 * Used by the analysis pipeline to start computation early during TX fetch.
 */

import { getAnalysisSettings } from "@/hooks/useAnalysisSettings";
import type { MempoolTransaction } from "@/lib/api/types";
import type { BoltzmannWorkerResult, BoltzmannProgress, WorkerResponse } from "./boltzmann-pool";
import {
  MAX_SUPPORTED_TOTAL,
  MAX_WORKERS,
  getWorkerPool,
  terminatePool,
  detectIntrafees,
  detectJoinMarketForTurbo,
  runParallelPass,
  isAutoComputable,
  extractTxValues,
} from "./boltzmann-pool";

export { isAutoComputable, extractTxValues };

/**
 * Compute the Boltzmann Link Probability Matrix for a transaction.
 *
 * Returns null for unsupported transactions (coinbase, 1 input, >80 I/O, SSR).
 * Runs in Web Workers - can be awaited from any context (not React-specific).
 */
export async function computeBoltzmann(
  tx: MempoolTransaction,
  opts?: {
    timeoutMs?: number;
    onProgress?: (p: BoltzmannProgress) => void;
    signal?: AbortSignal;
  },
): Promise<BoltzmannWorkerResult | null> {
  if (typeof Worker === "undefined") return null;

  const isCoinbase = tx.vin.some(v => v.is_coinbase);
  if (isCoinbase) return null;

  const { inputValues, outputValues } = extractTxValues(tx);
  const nIn = inputValues.length;
  const nOut = outputValues.length;

  if (nIn === 0 || nOut === 0) return null;
  if (nIn + nOut > MAX_SUPPORTED_TOTAL) return null;

  // Check for abort before starting workers
  if (opts?.signal?.aborted) return null;

  // Terminate any existing workers to avoid stale WASM state conflicts
  terminatePool();

  const { boltzmannTimeout = 300 } = getAnalysisSettings() as { boltzmannTimeout?: number };
  const timeoutMs = opts?.timeoutMs ?? boltzmannTimeout * 1000;
  const id = `${tx.txid}-${Date.now()}`;

  // Detect CoinJoin intrafees
  const { feesMaker, feesTaker, hasCjPattern } = detectIntrafees(outputValues, 0.005);
  const maxCjIntrafeesRatio = hasCjPattern ? 0.005 : 0.0;

  // Set up abort listener
  const abortHandler = () => {
    terminatePool();
  };
  opts?.signal?.addEventListener("abort", abortHandler);

  try {
    // Check for JoinMarket turbo mode (approximate, for large JM CoinJoins only).
    // Only use for txs with 10+ I/O where standard DFS would be slow.
    // Small txs (like Stonewall with 2 equal outputs) must use exact DFS path.
    const jmDetection = detectJoinMarketForTurbo(inputValues, outputValues);
    if (jmDetection.isJoinMarket && nIn + nOut >= 10) {
      return await runJoinMarketCompute(
        id, inputValues, outputValues, tx.fee,
        jmDetection.denomination, maxCjIntrafeesRatio, timeoutMs,
        opts?.signal,
      );
    }

    // Determine worker count
    const hwCores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency || 1) : 1;
    const numWorkers = Math.min(hwCores, MAX_WORKERS);
    const useParallel = numWorkers > 1 && nIn + nOut >= 10;

    if (!useParallel) {
      return await runSingleWorkerCompute(
        id, inputValues, outputValues, tx.fee,
        maxCjIntrafeesRatio, timeoutMs,
        opts?.onProgress, opts?.signal,
      );
    }

    // Multi-worker parallel path
    return await runMultiWorkerCompute(
      id, inputValues, outputValues, tx.fee,
      feesMaker, feesTaker, hasCjPattern, numWorkers, timeoutMs,
      opts?.onProgress, opts?.signal,
    );
  } finally {
    opts?.signal?.removeEventListener("abort", abortHandler);
  }
}

/** JoinMarket turbo mode - single worker, always fast. */
function runJoinMarketCompute(
  id: string,
  inputValues: number[],
  outputValues: number[],
  fee: number,
  denomination: number,
  maxCjIntrafeesRatio: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BoltzmannWorkerResult | null> {
  const pool = getWorkerPool(1);
  if (pool.length === 0) return Promise.resolve(null);
  const worker = pool[0];

  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(null); return; }

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === "result") {
        resolve(msg as BoltzmannWorkerResult);
      } else if (msg.type === "error") {
        resolve(null);
      }
    };

    worker.onerror = () => {
      terminatePool();
      resolve(null);
    };

    worker.postMessage({
      type: "compute-jm",
      id,
      inputValues,
      outputValues,
      fee,
      denomination,
      maxCjIntrafeesRatio,
      timeoutMs,
    });
  });
}

/** Single-worker compute path (handles dual-run internally). */
function runSingleWorkerCompute(
  id: string,
  inputValues: number[],
  outputValues: number[],
  fee: number,
  maxCjIntrafeesRatio: number,
  timeoutMs: number,
  onProgress?: (p: BoltzmannProgress) => void,
  signal?: AbortSignal,
): Promise<BoltzmannWorkerResult | null> {
  const pool = getWorkerPool(1);
  if (pool.length === 0) return Promise.resolve(null);
  const worker = pool[0];

  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(null); return; }

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.id !== id) return;

      if (msg.type === "result") {
        resolve(msg as BoltzmannWorkerResult);
      } else if (msg.type === "error") {
        resolve(null);
      } else if (msg.type === "progress" && onProgress) {
        let estimatedRemainingMs: number | null = null;
        if (msg.runFraction !== undefined && msg.runFraction > 0.05 && msg.runElapsedMs !== undefined) {
          const runRemainingMs = (msg.runElapsedMs / msg.runFraction) * (1 - msg.runFraction);
          if (msg.hasDualRun && msg.runIndex === 0) {
            estimatedRemainingMs = null;
          } else {
            estimatedRemainingMs = Math.max(0, Math.round(runRemainingMs));
          }
        }
        onProgress({
          fraction: msg.fraction,
          elapsedMs: msg.elapsedMs,
          estimatedRemainingMs,
        });
      }
    };

    worker.onerror = () => {
      terminatePool();
      resolve(null);
    };

    worker.postMessage({
      type: "compute",
      id,
      inputValues,
      outputValues,
      fee,
      maxCjIntrafeesRatio,
      timeoutMs,
    });
  });
}

/** Multi-worker parallel compute path. */
async function runMultiWorkerCompute(
  id: string,
  inputValues: number[],
  outputValues: number[],
  fee: number,
  feesMaker: number,
  feesTaker: number,
  hasCjPattern: boolean,
  numWorkers: number,
  timeoutMs: number,
  onProgress?: (p: BoltzmannProgress) => void,
  signal?: AbortSignal,
): Promise<BoltzmannWorkerResult | null> {
  if (signal?.aborted) return null;

  const pool = getWorkerPool(numWorkers);
  if (pool.length < 2) {
    // Fallback to single worker
    return runSingleWorkerCompute(
      id, inputValues, outputValues, fee,
      hasCjPattern ? 0.005 : 0.0, timeoutMs, onProgress, signal,
    );
  }

  try {
    const progressCallback = (fraction: number, elapsedMs: number) => {
      if (signal?.aborted || !onProgress) return;
      let estimatedRemainingMs: number | null = null;
      if (fraction > 0.05) {
        estimatedRemainingMs = Math.max(0, Math.round((elapsedMs / fraction) * (1 - fraction)));
      }
      const adjustedFraction = hasCjPattern ? fraction * 0.5 : fraction;
      onProgress({ fraction: adjustedFraction, elapsedMs, estimatedRemainingMs });
    };

    // Run 0: no intrafees
    const run0Result = await runParallelPass(
      pool, id, inputValues, outputValues, fee,
      0, 0, timeoutMs, progressCallback,
    );

    if (signal?.aborted) return null;

    // Run 1: with intrafees (if CoinJoin pattern detected and run 0 didn't timeout)
    if (hasCjPattern && !run0Result.timedOut && feesMaker > 0) {
      const progress1 = (fraction: number, elapsedMs: number) => {
        if (signal?.aborted || !onProgress) return;
        let estimatedRemainingMs: number | null = null;
        if (fraction > 0.05) {
          estimatedRemainingMs = Math.max(0, Math.round((elapsedMs / fraction) * (1 - fraction)));
        }
        onProgress({ fraction: 0.5 + fraction * 0.5, elapsedMs, estimatedRemainingMs });
      };

      const run1Result = await runParallelPass(
        pool, id, inputValues, outputValues, fee,
        feesMaker, feesTaker, timeoutMs, progress1,
      );

      if (signal?.aborted) return null;

      return run1Result.nbCmbn > run0Result.nbCmbn
        ? run1Result
        : { ...run0Result, intraFeesMaker: 0, intraFeesTaker: 0 };
    }

    return { ...run0Result, intraFeesMaker: 0, intraFeesTaker: 0 };
  } catch {
    terminatePool();
    return null;
  }
}
