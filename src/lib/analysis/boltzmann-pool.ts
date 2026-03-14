/**
 * Boltzmann WASM worker pool singleton and helper functions.
 * Shared between the imperative computeBoltzmann() and the useBoltzmann hook.
 */

import type { BoltzmannWorkerResult } from "@/hooks/useBoltzmann";

// Re-export types for convenience
export type { BoltzmannWorkerResult };

export interface BoltzmannProgress {
  fraction: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
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

export type WorkerResponse = (BoltzmannWorkerResult & { workerIndex?: number }) | WorkerError | WorkerProgress;

/** Auto-compute when total UTXOs (inputs + outputs) is under this threshold. */
export const AUTO_COMPUTE_MAX_TOTAL = 20;

/** Maximum supported total UTXOs (inputs + outputs). */
export const MAX_SUPPORTED_TOTAL = 80;

/** Maximum number of parallel workers. */
export const MAX_WORKERS = 8;

// --- Worker pool singleton ---
let workerPool: Worker[] = [];

export function createWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker("/workers/boltzmann.worker.js", { type: "module" });
  } catch {
    return null;
  }
}

export function getWorkerPool(size: number): Worker[] {
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

export function terminatePool() {
  for (const w of workerPool) w.terminate();
  workerPool = [];
}

/** Detect intrafees for CoinJoin pattern. */
export function detectIntrafees(
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
export function detectJoinMarketForTurbo(
  inputValues: number[],
  outputValues: number[],
): { isJoinMarket: boolean; denomination: number } {
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

  if (outputValues.length > 2 * equalCount + 5) return { isJoinMarket: false, denomination: 0 };

  const changeCount = outputValues.length - equalCount;
  if (changeCount === 0) return { isJoinMarket: false, denomination: 0 };

  const aboveDenom = inputValues.filter(v => v > denomination).length;
  if (aboveDenom < changeCount - 5) return { isJoinMarket: false, denomination: 0 };

  return { isJoinMarket: true, denomination };
}

/**
 * Merge partial results from multiple workers.
 * Each worker's finalize_link_matrix adds a +1 base case to every cell and nb_cmbn.
 * For N workers, subtract (N-1) from each to correct.
 */
export function mergePartialResults(
  partials: BoltzmannWorkerResult[],
): BoltzmannWorkerResult {
  const N = partials.length;
  if (N === 1) return partials[0];

  const nOut = partials[0].matLnkCombinations.length;
  const nIn = nOut > 0 ? partials[0].matLnkCombinations[0].length : 0;

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

  nbCmbn -= (N - 1);
  for (let o = 0; o < nOut; o++) {
    for (let i = 0; i < nIn; i++) {
      mat[o][i] -= (N - 1);
    }
  }

  const probs: number[][] = mat.map(row =>
    row.map(v => (nbCmbn > 0 ? v / nbCmbn : 0)),
  );
  const entropy = nbCmbn > 1 ? Math.log2(nbCmbn) : 0;
  const nbCmbnPrfctCj = partials[0].nbCmbnPrfctCj;
  const efficiency = nbCmbnPrfctCj > 0 && nbCmbn > 0 ? nbCmbn / nbCmbnPrfctCj : 0;

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
export function runParallelPass(
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

/** Check if a transaction is eligible for auto Boltzmann computation. */
export function isAutoComputable(
  inputValues: number[],
  outputValues: number[],
): boolean {
  const nIn = inputValues.length;
  const nOut = outputValues.length;
  if (nIn === 0 || nOut === 0) return false;
  if (nIn + nOut < AUTO_COMPUTE_MAX_TOTAL) return true;
  if (nIn + nOut > MAX_SUPPORTED_TOTAL) return false;
  return detectJoinMarketForTurbo(inputValues, outputValues).isJoinMarket;
}

/** Extract input/output values from a transaction (filtering coinbase/OP_RETURN). */
export function extractTxValues(tx: { vin: Array<{ is_coinbase?: boolean; prevout?: { value: number } | null }>; vout: Array<{ scriptpubkey_type?: string; value: number }> }): {
  inputValues: number[];
  outputValues: number[];
} {
  const inputValues = tx.vin
    .filter(v => !v.is_coinbase && v.prevout)
    .map(v => v.prevout!.value);
  const outputValues = tx.vout
    .filter(o => o.scriptpubkey_type !== "op_return" && o.value > 0)
    .map(o => o.value);
  return { inputValues, outputValues };
}
