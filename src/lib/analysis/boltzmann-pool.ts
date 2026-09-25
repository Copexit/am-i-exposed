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

export function terminatePool() {
  for (const w of workerPool) w.terminate();
  workerPool = [];
  const cancels = [...pendingJobs];
  pendingJobs.clear();
  for (const cancel of cancels) cancel();
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
      terminatePool();
      reject(new Error(message));
    }

    const unregister = onPoolTerminate(() => {
      if (settled) return;
      settled = true;
      detachAll();
      reject(new Error("Boltzmann worker pool terminated"));
    });

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
