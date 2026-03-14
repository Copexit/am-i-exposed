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
  workerIndex?: number;
}

interface WorkerProgress {
  type: "progress";
  id: string;
  fraction: number;
  elapsedMs: number;
  runFraction?: number;
  runElapsedMs?: number;
  runIndex?: number;
  hasDualRun?: boolean;
  workerIndex?: number;
}

export interface BoltzmannProgress {
  fraction: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
}

type WorkerResponse = (BoltzmannWorkerResult & { workerIndex?: number }) | WorkerError | WorkerProgress;

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
const MAX_SUPPORTED_TOTAL = 80;

/** Maximum number of parallel workers. */
const MAX_WORKERS = 8;

// --- Worker pool ---
let workerPool: Worker[] = [];

function createWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker("/workers/boltzmann.worker.js", { type: "module" });
  } catch {
    return null;
  }
}

function getWorkerPool(size: number): Worker[] {
  // Reuse existing workers, create more if needed, terminate extras
  while (workerPool.length > size) {
    workerPool.pop()!.terminate();
  }
  while (workerPool.length < size) {
    const w = createWorker();
    if (!w) break;
    workerPool.push(w);
  }
  return workerPool;
}

function terminatePool() {
  for (const w of workerPool) w.terminate();
  workerPool = [];
}

/** Detect intrafees for CoinJoin pattern. Returns [feesMaker, feesTaker, hasCjPattern]. */
function detectIntrafees(
  outputValues: number[],
  maxRatio: number,
): { feesMaker: number; feesTaker: number; hasCjPattern: boolean } {
  const valueCounts = new Map<number, number>();
  for (const v of outputValues) {
    valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1);
  }
  let bestAmount = 0;
  let bestCount = 0;
  for (const [val, count] of valueCounts) {
    if (count >= 2 && (count > bestCount || (count === bestCount && val > bestAmount))) {
      bestAmount = val;
      bestCount = count;
    }
  }

  if (bestCount < 2 || outputValues.length > 2 * bestCount) {
    return { feesMaker: 0, feesTaker: 0, hasCjPattern: false };
  }

  const feesMaker = Math.round(bestAmount * maxRatio);
  const feesTaker = feesMaker * (bestCount - 1);
  return { feesMaker, feesTaker, hasCjPattern: true };
}

/** Detect JoinMarket CoinJoin structure for turbo Boltzmann mode. */
function detectJoinMarketForTurbo(
  inputValues: number[],
  outputValues: number[],
): { isJoinMarket: boolean; denomination: number } {
  // Find most common output value with count >= 2 (the CJ denomination)
  const valueCounts = new Map<number, number>();
  for (const v of outputValues) {
    valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1);
  }

  let bestAmount = 0;
  let bestCount = 0;
  for (const [val, count] of valueCounts) {
    if (count >= 2 && (count > bestCount || (count === bestCount && val > bestAmount))) {
      bestAmount = val;
      bestCount = count;
    }
  }

  if (bestCount < 2) return { isJoinMarket: false, denomination: 0 };

  const equalCount = bestCount;
  const denomination = bestAmount;

  // Check outputs fit CJ + change structure
  // Allow up to 5 extra outputs for multi-input taker changes
  // The Rust-side matching validates definitively and falls back if needed
  if (outputValues.length > 2 * equalCount + 5) return { isJoinMarket: false, denomination: 0 };

  // Must have at least one change output (changeless CJs are already fast)
  const changeCount = outputValues.length - equalCount;
  if (changeCount === 0) return { isJoinMarket: false, denomination: 0 };

  // Check enough inputs have value > denomination to cover most changes
  // Allow up to 5 unmatched changes (multi-input taker with sub-denomination inputs)
  const aboveDenom = inputValues.filter(v => v > denomination).length;
  if (aboveDenom < changeCount - 5) return { isJoinMarket: false, denomination: 0 };

  return { isJoinMarket: true, denomination };
}

/**
 * Merge partial results from multiple workers.
 *
 * Each worker's finalize_link_matrix adds a +1 base case to every cell and nb_cmbn.
 * For N workers, subtract (N-1) from each to correct.
 */
function mergePartialResults(
  partials: BoltzmannWorkerResult[],
): BoltzmannWorkerResult {
  const N = partials.length;
  if (N === 1) return partials[0];

  const nOut = partials[0].matLnkCombinations.length;
  const nIn = nOut > 0 ? partials[0].matLnkCombinations[0].length : 0;

  // Sum matrices and nb_cmbn, then correct for overcounted base cases
  const mat: number[][] = Array.from({ length: nOut }, () => new Array<number>(nIn).fill(0));
  let nbCmbn = 0;
  let anyTimedOut = false;
  let maxElapsed = 0;

  for (const p of partials) {
    nbCmbn += p.nbCmbn;
    anyTimedOut = anyTimedOut || p.timedOut;
    if (p.elapsedMs > maxElapsed) maxElapsed = p.elapsedMs;
    for (let o = 0; o < nOut; o++) {
      for (let i = 0; i < nIn; i++) {
        mat[o][i] += p.matLnkCombinations[o][i];
      }
    }
  }

  // Correct for N-1 extra base cases
  nbCmbn -= (N - 1);
  for (let o = 0; o < nOut; o++) {
    for (let i = 0; i < nIn; i++) {
      mat[o][i] -= (N - 1);
    }
  }

  // Recompute derived fields
  const probs: number[][] = mat.map(row =>
    row.map(v => (nbCmbn > 0 ? v / nbCmbn : 0)),
  );
  const entropy = nbCmbn > 1 ? Math.log2(nbCmbn) : 0;
  const nbCmbnPrfctCj = partials[0].nbCmbnPrfctCj;
  const efficiency = nbCmbnPrfctCj > 0 && nbCmbn > 0 ? nbCmbn / nbCmbnPrfctCj : 0;

  // Find deterministic links from merged probabilities
  const deterministicLinks: [number, number][] = [];
  for (let o = 0; o < nOut; o++) {
    for (let i = 0; i < nIn; i++) {
      if (mat[o][i] === nbCmbn && nbCmbn > 0) {
        deterministicLinks.push([o, i]);
      }
    }
  }

  return {
    type: "result",
    id: partials[0].id,
    matLnkCombinations: mat,
    matLnkProbabilities: probs,
    nbCmbn,
    entropy,
    efficiency,
    nbCmbnPrfctCj,
    deterministicLinks,
    timedOut: anyTimedOut,
    elapsedMs: maxElapsed,
    nInputs: partials[0].nInputs,
    nOutputs: partials[0].nOutputs,
    fees: partials[0].fees,
    intraFeesMaker: partials[0].intraFeesMaker,
    intraFeesTaker: partials[0].intraFeesTaker,
  };
}

/**
 * Run a single DFS pass across N workers with explicit fees.
 * Returns a promise that resolves to the merged result.
 */
function runParallelPass(
  workers: Worker[],
  id: string,
  inputValues: number[],
  outputValues: number[],
  fee: number,
  feesMaker: number,
  feesTaker: number,
  timeoutMs: number,
  onProgress: (fraction: number, elapsedMs: number) => void,
): Promise<BoltzmannWorkerResult> {
  const N = workers.length;
  const startTime = performance.now();

  return new Promise((resolve, reject) => {
    const partials: (BoltzmannWorkerResult | null)[] = new Array(N).fill(null);
    const workerFractions: number[] = new Array(N).fill(0);
    let completed = 0;
    let settled = false;

    function detachAll() {
      for (const w of workers) {
        w.onmessage = null;
        w.onerror = null;
      }
    }

    for (let idx = 0; idx < N; idx++) {
      const w = workers[idx];

      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (settled) return;
        const msg = e.data;
        if (msg.id !== id) return;

        if (msg.type === "progress" && msg.workerIndex !== undefined) {
          workerFractions[msg.workerIndex] = msg.fraction;
          const avg = workerFractions.reduce((a, b) => a + b, 0) / N;
          onProgress(avg, performance.now() - startTime);
          return;
        }

        if (msg.type === "result" && "workerIndex" in msg && msg.workerIndex !== undefined) {
          partials[msg.workerIndex as number] = msg as BoltzmannWorkerResult;
          completed++;
          workerFractions[msg.workerIndex as number] = 1;
          const avg = workerFractions.reduce((a, b) => a + b, 0) / N;
          onProgress(avg, performance.now() - startTime);

          if (completed === N) {
            settled = true;
            detachAll();
            const merged = mergePartialResults(
              partials.filter((p): p is BoltzmannWorkerResult => p !== null),
            );
            resolve(merged);
          }
          return;
        }

        if (msg.type === "error") {
          settled = true;
          detachAll();
          reject(new Error(msg.message));
        }
      };

      w.onerror = (err) => {
        if (settled) return;
        settled = true;
        detachAll();
        reject(new Error(err.message || "Worker error"));
      };

      w.postMessage({
        type: "compute-range",
        id,
        inputValues,
        outputValues,
        fee,
        feesMaker,
        feesTaker,
        timeoutMs,
        workerIndex: idx,
        totalWorkers: N,
      });
    }
  });
}

export function useBoltzmann(tx: MempoolTransaction | null) {
  const [state, setState] = useState<BoltzmannState>(INITIAL_STATE);
  const requestIdRef = useRef<string | null>(null);
  const computedTxidRef = useRef<string | null>(null);

  const cancel = useCallback(() => {
    requestIdRef.current = null;
    terminatePool();
    setState(INITIAL_STATE);
  }, []);

  const compute = useCallback(() => {
    if (!tx) return;

    if (typeof Worker === "undefined") {
      setState({ status: "unsupported", result: null, error: null, progress: null });
      return;
    }

    // Terminate any existing workers to avoid stale WASM state conflicts
    terminatePool();

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

    const id = `${tx.txid}-${Date.now()}`;
    requestIdRef.current = id;
    computedTxidRef.current = tx.txid;

    const { boltzmannTimeout = 300 } = getAnalysisSettings() as { boltzmannTimeout?: number };
    const timeoutMs = boltzmannTimeout * 1000;

    // Detect CoinJoin intrafees
    const { feesMaker, feesTaker, hasCjPattern } = detectIntrafees(outputValues, 0.005);
    const maxCjIntrafeesRatio = hasCjPattern ? 0.005 : 0.0;

    // Check for JoinMarket turbo mode (always fast, no parallelism needed)
    const jmDetection = detectJoinMarketForTurbo(inputValues, outputValues);
    if (jmDetection.isJoinMarket) {
      const pool = getWorkerPool(1);
      if (pool.length === 0) {
        setState({ status: "unsupported", result: null, error: null, progress: null });
        return;
      }
      const worker = pool[0];

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.id !== id) return;
        if (msg.type === "result") {
          setState({ status: "complete", result: msg as BoltzmannWorkerResult, error: null, progress: null });
        } else if (msg.type === "error") {
          setState({ status: "error", result: null, error: msg.message, progress: null });
        }
      };

      worker.onerror = (err) => {
        if (requestIdRef.current !== id) return;
        setState({ status: "error", result: null, error: err.message || "Worker error", progress: null });
        terminatePool();
      };

      setState({ status: "computing", result: null, error: null, progress: null });

      worker.postMessage({
        type: "compute-jm",
        id,
        inputValues,
        outputValues,
        fee: tx.fee,
        denomination: jmDetection.denomination,
        maxCjIntrafeesRatio,
        timeoutMs,
      });
      return;
    }

    // Determine worker count
    const hwCores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency || 1) : 1;
    const numWorkers = Math.min(hwCores, MAX_WORKERS);

    // For small txs or single core, use the original single-worker path
    // The single-worker path handles dual-run internally via prepare_boltzmann
    const useParallel = numWorkers > 1 && nIn + nOut >= 10;

    if (!useParallel) {
      // --- Single-worker path (existing behavior) ---
      const pool = getWorkerPool(1);
      if (pool.length === 0) {
        setState({ status: "unsupported", result: null, error: null, progress: null });
        return;
      }
      const worker = pool[0];

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.id !== id) return;

        if (msg.type === "result") {
          setState({ status: "complete", result: msg as BoltzmannWorkerResult, error: null, progress: null });
        } else if (msg.type === "error") {
          setState({ status: "error", result: null, error: msg.message, progress: null });
        } else if (msg.type === "progress") {
          let estimatedRemainingMs: number | null = null;
          if (msg.runFraction !== undefined && msg.runFraction > 0.05 && msg.runElapsedMs !== undefined) {
            const runRemainingMs = (msg.runElapsedMs / msg.runFraction) * (1 - msg.runFraction);
            if (msg.hasDualRun && msg.runIndex === 0) {
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
        terminatePool();
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
      return;
    }

    // --- Multi-worker parallel path ---
    // First, do a probe with a single worker to get totalBranches
    const probeWorker = getWorkerPool(1)[0];
    if (!probeWorker) {
      setState({ status: "unsupported", result: null, error: null, progress: null });
      return;
    }

    setState({ status: "computing", result: null, error: null, progress: null });

    // Use prepare_boltzmann on probe worker to discover branch count
    probeWorker.onmessage = () => {
      // Ignore - we'll use the ranged API directly
    };

    // Instead of probing, go straight to parallel dispatch.
    // Each worker independently runs Phase 1+2 (microseconds), so no wasted work.
    const startParallel = async () => {
      if (requestIdRef.current !== id) return;

      const pool = getWorkerPool(numWorkers);
      if (pool.length < 2) {
        // Fallback to single worker if pool creation fails
        const w = pool[0];
        if (!w) {
          setState({ status: "unsupported", result: null, error: null, progress: null });
          return;
        }
        w.onmessage = (e: MessageEvent<WorkerResponse>) => {
          const msg = e.data;
          if (msg.id !== id) return;
          if (msg.type === "result") {
            setState({ status: "complete", result: msg as BoltzmannWorkerResult, error: null, progress: null });
          } else if (msg.type === "error") {
            setState({ status: "error", result: null, error: msg.message, progress: null });
          }
        };
        w.postMessage({
          type: "compute", id, inputValues, outputValues,
          fee: tx.fee, maxCjIntrafeesRatio, timeoutMs,
        });
        return;
      }

      try {
        const onProgress = (fraction: number, elapsedMs: number) => {
          if (requestIdRef.current !== id) return;
          let estimatedRemainingMs: number | null = null;
          if (fraction > 0.05) {
            estimatedRemainingMs = Math.max(0, Math.round((elapsedMs / fraction) * (1 - fraction)));
          }
          const adjustedFraction = hasCjPattern ? fraction * 0.5 : fraction;
          setState(prev => ({
            ...prev,
            status: "computing",
            progress: { fraction: adjustedFraction, elapsedMs, estimatedRemainingMs },
          }));
        };

        // Run 0: no intrafees
        const run0Result = await runParallelPass(
          pool, id, inputValues, outputValues, tx.fee,
          0, 0, timeoutMs, onProgress,
        );

        if (requestIdRef.current !== id) return;

        // Run 1: with intrafees (if CoinJoin pattern detected and run 0 didn't timeout)
        if (hasCjPattern && !run0Result.timedOut && feesMaker > 0) {
          const onProgress1 = (fraction: number, elapsedMs: number) => {
            if (requestIdRef.current !== id) return;
            let estimatedRemainingMs: number | null = null;
            if (fraction > 0.05) {
              estimatedRemainingMs = Math.max(0, Math.round((elapsedMs / fraction) * (1 - fraction)));
            }
            setState(prev => ({
              ...prev,
              status: "computing",
              progress: { fraction: 0.5 + fraction * 0.5, elapsedMs, estimatedRemainingMs },
            }));
          };

          const run1Result = await runParallelPass(
            pool, id, inputValues, outputValues, tx.fee,
            feesMaker, feesTaker, timeoutMs, onProgress1,
          );

          if (requestIdRef.current !== id) return;

          // Pick the run with more combinations
          const finalResult = run1Result.nbCmbn > run0Result.nbCmbn
            ? run1Result
            : { ...run0Result, intraFeesMaker: 0, intraFeesTaker: 0 };

          setState({ status: "complete", result: finalResult, error: null, progress: null });
        } else {
          setState({
            status: "complete",
            result: { ...run0Result, intraFeesMaker: 0, intraFeesTaker: 0 },
            error: null,
            progress: null,
          });
        }
      } catch (err) {
        // Clear requestId so stale progress from surviving workers is ignored
        requestIdRef.current = null;
        terminatePool();
        setState({
          status: "error",
          result: null,
          error: err instanceof Error ? err.message : String(err),
          progress: null,
        });
      }
    };

    startParallel();
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

    // Auto-compute for small txs or JM-detected txs (always fast via turbo)
    const isJmAutoDetect = (() => {
      if (nIn <= 1 || nOut === 0) return false;
      const iv = tx.vin.filter(v => !v.is_coinbase && v.prevout).map(v => v.prevout!.value);
      const ov = tx.vout.filter(o => o.scriptpubkey_type !== "op_return" && o.value > 0).map(o => o.value);
      return detectJoinMarketForTurbo(iv, ov).isJoinMarket;
    })();

    if (nIn + nOut < AUTO_COMPUTE_MAX_TOTAL || isJmAutoDetect) {
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
        if (nIn + nOut < AUTO_COMPUTE_MAX_TOTAL) return true;
        if (nIn <= 1 || nOut === 0) return false;
        const iv = tx.vin.filter(v => !v.is_coinbase && v.prevout).map(v => v.prevout!.value);
        const ov = tx.vout.filter(o => o.scriptpubkey_type !== "op_return" && o.value > 0).map(o => o.value);
        return detectJoinMarketForTurbo(iv, ov).isJoinMarket;
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
