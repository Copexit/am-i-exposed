import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";

/**
 * Recursive multi-hop transaction tracing engine.
 *
 * Traces backward (input provenance) and forward (output destinations)
 * up to a configurable depth, filtering by minimum sats to avoid
 * exponential blowup on dust inputs/outputs.
 *
 * Designed to run client-side with rate-limited API calls via the
 * existing RequestQueue infrastructure.
 */

export interface TraceLayer {
  depth: number;
  txs: Map<string, MempoolTransaction>;
}

interface TraceResult {
  /** Layers of ancestor/descendant transactions, indexed by depth */
  layers: TraceLayer[];
  /** All transactions discovered across all layers */
  allTxs: Map<string, MempoolTransaction>;
  /** Total API calls made */
  fetchCount: number;
  /** Whether the trace was cut short by abort signal */
  aborted: boolean;
  /** Fetches that failed (429, timeout, ...): their branches are missing from the layers */
  failedFetches: number;
}

type TraceProgressCallback = (progress: {
  currentDepth: number;
  maxDepth: number;
  txsFetched: number;
}) => void;

const MAX_FANOUT_PER_LAYER = 50;

interface TraceFetcher {
  getTransaction(txid: string): Promise<MempoolTransaction>;
  getTxOutspends(txid: string): Promise<MempoolOutspend[]>;
}

/**
 * Check if a transaction contains a known entity address (inputs or outputs).
 * Used as a barrier: tracing stops at known entities because custodial services
 * break the chain of custody (no link between deposits and withdrawals).
 */
export type EntityBarrierCheck = (tx: MempoolTransaction) => boolean;

/** Candidate txids to follow from one frontier tx; "skip" drops it, "abort" ends the layer. */
type NextTxids = (
  ftxid: string,
  ftx: MempoolTransaction,
  depth: number,
  countFetch: () => void,
  failFetch: () => void,
) => Promise<string[] | "skip" | "abort">;

/**
 * Shared breadth-first layer walk for backward and forward tracing.
 * `existing` holds already-fetched depth-1 txs; entity-barrier txs are
 * recorded in their layer but never expanded.
 */
async function traceLayers(
  root: MempoolTransaction,
  maxDepth: number,
  fetcher: TraceFetcher,
  signal: AbortSignal | undefined,
  onProgress: TraceProgressCallback | undefined,
  existing: Map<string, MempoolTransaction> | undefined,
  entityBarrier: EntityBarrierCheck | undefined,
  nextTxids: NextTxids,
): Promise<TraceResult> {
  const allTxs = new Map<string, MempoolTransaction>();
  const visited = new Set<string>([root.txid]);
  const layers: TraceLayer[] = [];
  let fetchCount = 0;
  let failedFetches = 0;
  const countFetch = () => { fetchCount++; };
  const failFetch = () => { failedFetches++; };

  let frontier = new Map<string, MempoolTransaction>([[root.txid, root]]);

  for (let d = 0; d < maxDepth; d++) {
    if (signal?.aborted) return { layers, allTxs, fetchCount, aborted: true, failedFetches };

    onProgress?.({ currentDepth: d + 1, maxDepth, txsFetched: fetchCount });

    // layerTxs = all txs discovered at this depth (including barrier txs)
    // nextFrontier = only non-barrier txs (expanded in next hop)
    const layerTxs = new Map<string, MempoolTransaction>();
    const nextFrontier = new Map<string, MempoolTransaction>();
    const addToLayer = (txid: string, found: MempoolTransaction) => {
      allTxs.set(txid, found);
      layerTxs.set(txid, found);
      // Entity barrier: don't expand through custodial entities
      if (!entityBarrier || !entityBarrier(found)) nextFrontier.set(txid, found);
    };

    for (const [ftxid, ftx] of frontier) {
      const next = await nextTxids(ftxid, ftx, d, countFetch, failFetch);
      if (next === "abort") break;
      if (next === "skip") continue;

      for (const txid of next) {
        if (visited.has(txid)) continue;
        visited.add(txid);

        // Reuse already-fetched txs (depth 1 optimization)
        const cached = d === 0 ? existing?.get(txid) : undefined;
        if (cached) {
          addToLayer(txid, cached);
          continue;
        }

        try {
          if (signal?.aborted) break;
          const found = await fetcher.getTransaction(txid);
          fetchCount++;
          addToLayer(txid, found);
          onProgress?.({ currentDepth: d + 1, maxDepth, txsFetched: fetchCount });
          if (layerTxs.size >= MAX_FANOUT_PER_LAYER) break;
        } catch {
          // Failed to fetch - skip this branch, but record it
          failedFetches++;
        }
      }
      if (layerTxs.size >= MAX_FANOUT_PER_LAYER) break;
    }

    if (layerTxs.size === 0) break;
    layers.push({ depth: d + 1, txs: new Map(layerTxs) });

    // Only expand non-barrier txs in the next hop
    if (nextFrontier.size === 0) break;
    frontier = nextFrontier;
  }

  return { layers, allTxs, fetchCount, aborted: signal?.aborted ?? false, failedFetches };
}

/**
 * Trace backward from a transaction, fetching parent txs up to `maxDepth` hops.
 *
 * At each hop, fetches parent transactions for all non-coinbase inputs
 * whose prevout value meets the `minSats` threshold.
 *
 * @param tx - Starting transaction
 * @param maxDepth - Maximum hops to trace (1 = parents only)
 * @param minSats - Minimum prevout value to follow (filters dust)
 * @param fetcher - API client for fetching transactions
 * @param signal - AbortSignal for cancellation
 * @param existingParents - Already-fetched parent txs (depth 1) to avoid re-fetching
 */
export async function traceBackward(
  tx: MempoolTransaction,
  maxDepth: number,
  minSats: number,
  fetcher: TraceFetcher,
  signal?: AbortSignal,
  onProgress?: TraceProgressCallback,
  existingParents?: Map<string, MempoolTransaction>,
  entityBarrier?: EntityBarrierCheck,
): Promise<TraceResult> {
  return traceLayers(tx, maxDepth, fetcher, signal, onProgress, existingParents, entityBarrier, async (_id, ftx) =>
    ftx.vin
      .filter((vin) => {
        if (vin.is_coinbase) return false;
        // Filter by minimum value
        const value = vin.prevout?.value ?? 0;
        return !(value > 0 && value < minSats);
      })
      .map((vin) => vin.txid),
  );
}

/**
 * Trace forward from a transaction, fetching child txs up to `maxDepth` hops.
 *
 * At each hop, uses outspends to find spending transactions, then fetches
 * the child txs for outputs meeting the `minSats` threshold.
 *
 * @param tx - Starting transaction
 * @param maxDepth - Maximum hops to trace
 * @param minSats - Minimum output value to follow
 * @param fetcher - API client for fetching transactions and outspends
 * @param signal - AbortSignal for cancellation
 * @param existingChildren - Already-fetched child txs to avoid re-fetching
 * @param existingOutspends - Already-fetched outspends for the starting tx
 */
export async function traceForward(
  tx: MempoolTransaction,
  maxDepth: number,
  minSats: number,
  fetcher: TraceFetcher,
  signal?: AbortSignal,
  onProgress?: TraceProgressCallback,
  existingChildren?: Map<string, MempoolTransaction>,
  existingOutspends?: MempoolOutspend[],
  entityBarrier?: EntityBarrierCheck,
): Promise<TraceResult> {
  return traceLayers(tx, maxDepth, fetcher, signal, onProgress, existingChildren, entityBarrier,
    async (ftxid, ftx, d, countFetch, failFetch) => {
      // Outspends of the starting tx may already be known
      let outspends = d === 0 ? existingOutspends : undefined;
      if (!outspends) {
        if (signal?.aborted) return "abort";
        try {
          outspends = await fetcher.getTxOutspends(ftxid);
          countFetch();
        } catch {
          failFetch();
          return "skip";
        }
      }

      // Follow spent outputs above the minimum value
      const next: string[] = [];
      for (const [i, os] of outspends.entries()) {
        if (!os.spent || !os.txid) continue;
        const outputValue = ftx.vout[i]?.value ?? 0;
        if (outputValue > 0 && outputValue < minSats) continue;
        next.push(os.txid);
      }
      return next;
    },
  );
}
