/**
 * Boltzmann WASM worker pool singleton and parallel execution.
 *
 * Pure detection helpers (intrafees, JoinMarket, WabiSabi, extractTxValues,
 * isAutoComputable) live in ./boltzmann-detection.ts and are re-exported
 * here for backward compatibility.
 */

// Re-export detection helpers so existing imports keep working
export {
  MAX_SUPPORTED_TOTAL,
  MAX_SUPPORTED_TOTAL_WABISABI,
  detectIntrafees,
  detectJoinMarketForTurbo,
  detectWabiSabiForTurbo,
  isAutoComputable,
  extractTxValues,
} from "./boltzmann-detection";

export type BoltzmannMethod = "exact" | "joinmarket" | "wabisabi";

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
  /** Which computation path produced this result. */
  method?: BoltzmannMethod;
}

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

/** Maximum number of parallel workers. */
export const MAX_WORKERS = 8;

// --- Worker pool singleton ---
let workerPool: Worker[] = [];

/**
 * Cancellers for jobs awaiting a reply from the current pool. A terminated
 * Worker fires neither onmessage nor onerror, so terminatePool() must settle
 * these itself or their callers await forever.
 */
const pendingJobs = new Set<() => void>();

/** Register a canceller run on terminatePool(); returns its unregister fn. */
export function onPoolTerminate(cancel: () => void): () => void {
  pendingJobs.add(cancel);
  return () => pendingJobs.delete(cancel);
}

/** True while some job awaits the pool, i.e. a new compute would preempt it. */
export function isPoolBusy(): boolean {
  return pendingJobs.size > 0;
}

function createWorker(): Worker | null {
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

/**
 * Drop the pool after the owning job failed. Unlike terminatePool() this runs
 * no cancellers: the failing job settles itself, and listeners must not read
 * its own failure as preemption by another job.
 */
export function dropFailedPool() {
  for (const w of workerPool) w.terminate();
  workerPool = [];
}

/** Terminate the pool (preemption or abort) and settle every pending job. */
export function terminatePool() {
  dropFailedPool();
  const cancels = [...pendingJobs];
  pendingJobs.clear();
  for (const cancel of cancels) cancel();
}

/**
 * boltzmann-rs sorts inputs and outputs by value (descending, stable) and
 * returns its matrices in that sorted order. Consumers index them by the
 * position of the input/output among the values that were sent (tx order), so
 * reorder rows, columns and deterministic links back to that order.
 */
export function toSubmittedOrder(
  result: BoltzmannWorkerResult,
  inputValues: readonly number[],
  outputValues: readonly number[],
): BoltzmannWorkerResult {
  const sortedPositions = (vals: readonly number[]) =>
    vals.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, i]) => i);
  const inOrder = sortedPositions(inputValues); // sorted rank -> submitted index
  const outOrder = sortedPositions(outputValues);
  const nIn = result.matLnkProbabilities[0]?.length ?? 0;
  const nOut = result.matLnkProbabilities.length;
  // Degenerate results (shape not matching the submitted values) are uniform; leave them.
  if (nIn !== inputValues.length || nOut !== outputValues.length) return result;
  const rankIn: number[] = [];
  const rankOut: number[] = [];
  inOrder.forEach((orig, rank) => { rankIn[orig] = rank; });
  outOrder.forEach((orig, rank) => { rankOut[orig] = rank; });
  const remap = (m: number[][]) =>
    outputValues.map((_, o) => inputValues.map((__, i) => m[rankOut[o]!]?.[rankIn[i]!] ?? 0));
  return {
    ...result,
    matLnkCombinations: remap(result.matLnkCombinations),
    matLnkProbabilities: remap(result.matLnkProbabilities),
    deterministicLinks: result.deterministicLinks.map(([o, i]) => [outOrder[o] ?? o, inOrder[i] ?? i] as [number, number]),
  };
}

/**
 * Merge partial results from multiple workers.
 * Each worker's finalize_link_matrix adds a +1 base case to every cell and nb_cmbn.
 * For N workers, subtract (N-1) from each to correct.
 */
function mergePartialResults(
  partials: BoltzmannWorkerResult[],
): BoltzmannWorkerResult {
  const N = partials.length;
  const first = partials[0];
  if (!first) throw new Error("No Boltzmann partial results to merge");
  if (N === 1) return first;

  // All partials come from the same tx, so every matrix has the first one's shape.
  // A mismatched cell yields NaN rather than a silently wrong count.
  const mat: number[][] = first.matLnkCombinations.map((row, o) =>
    row.map((_, i) =>
      partials.reduce((sum, p) => sum + (p.matLnkCombinations[o]?.[i] ?? NaN), 0) - (N - 1),
    ),
  );
  let nbCmbn = 0;
  let anyTimedOut = false;
  let maxElapsed = 0;

  for (const p of partials) {
    nbCmbn += p.nbCmbn;
    anyTimedOut = anyTimedOut || p.timedOut;
    if (p.elapsedMs > maxElapsed) maxElapsed = p.elapsedMs;
  }

  nbCmbn -= (N - 1);

  const probs: number[][] = mat.map(row =>
    row.map(v => (nbCmbn > 0 ? v / nbCmbn : 0)),
  );
  const entropy = nbCmbn > 1 ? Math.log2(nbCmbn) : 0;
  const nbCmbnPrfctCj = first.nbCmbnPrfctCj;
  const efficiency = nbCmbnPrfctCj > 0 && nbCmbn > 0 ? nbCmbn / nbCmbnPrfctCj : 0;

  const deterministicLinks: [number, number][] = [];
  for (const [o, row] of mat.entries()) {
    for (const [i, v] of row.entries()) {
      if (v === nbCmbn && nbCmbn > 0) {
        deterministicLinks.push([o, i]);
      }
    }
  }

  return {
    type: "result",
    id: first.id,
    matLnkCombinations: mat,
    matLnkProbabilities: probs,
    nbCmbn,
    entropy,
    efficiency,
    nbCmbnPrfctCj,
    deterministicLinks,
    timedOut: anyTimedOut,
    elapsedMs: maxElapsed,
    nInputs: first.nInputs,
    nOutputs: first.nOutputs,
    fees: first.fees,
    intraFeesMaker: first.intraFeesMaker,
    intraFeesTaker: first.intraFeesTaker,
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
      unregister();
      for (const w of workers) {
        w.onmessage = null;
        w.onerror = null;
      }
    }

    /** Settle with an error. Workers are left in an unknown state, so the pool is dropped. */
    function fail(message: string) {
      settled = true;
      detachAll();
      dropFailedPool();
      reject(new Error(message));
    }

    const unregister = onPoolTerminate(() => {
      if (settled) return;
      settled = true;
      detachAll();
      reject(new Error("Boltzmann worker pool terminated"));
    });

    for (const [idx, w] of workers.entries()) {

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
          const wi = msg.workerIndex;
          partials[wi] = msg;
          completed++;
          workerFractions[wi] = 1;
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

        if (msg.type === "error") fail(msg.message);
      };

      w.onerror = (err) => {
        if (settled) return;
        fail(err.message || "Worker error");
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
