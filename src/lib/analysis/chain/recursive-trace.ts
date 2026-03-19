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
  const allTxs = new Map<string, MempoolTransaction>();
  const visited = new Set<string>([tx.txid]);
  const layers: TraceLayer[] = [];
  let fetchCount = 0;

  // Seed the frontier with the starting transaction
  let frontier = new Map<string, MempoolTransaction>([[tx.txid, tx]]);

  for (let d = 0; d < maxDepth; d++) {
    if (signal?.aborted) return { layers, allTxs, fetchCount, aborted: true };

    onProgress?.({ currentDepth: d + 1, maxDepth, txsFetched: fetchCount });

    // layerTxs = all txs discovered at this depth (including barrier txs)
    // nextFrontier = only non-barrier txs (expanded in next hop)
    const layerTxs = new Map<string, MempoolTransaction>();
    const nextFrontier = new Map<string, MempoolTransaction>();

    for (const [, ftx] of frontier) {
      for (const vin of ftx.vin) {
        if (vin.is_coinbase) continue;
        if (visited.has(vin.txid)) continue;

        // Filter by minimum value
        const value = vin.prevout?.value ?? 0;
        if (value > 0 && value < minSats) continue;

        visited.add(vin.txid);

        // Check existing parents first (depth 1 optimization)
        if (d === 0 && existingParents?.has(vin.txid)) {
          const cached = existingParents.get(vin.txid)!;
          allTxs.set(vin.txid, cached);
          layerTxs.set(vin.txid, cached);
          // Entity barrier: don't expand through custodial entities
          if (!entityBarrier || !entityBarrier(cached)) {
            nextFrontier.set(vin.txid, cached);
          }
          continue;
        }

        try {
          if (signal?.aborted) break;
          const parent = await fetcher.getTransaction(vin.txid);
          fetchCount++;
          allTxs.set(vin.txid, parent);
          layerTxs.set(vin.txid, parent);
          // Entity barrier: don't expand through custodial entities
          if (!entityBarrier || !entityBarrier(parent)) {
            nextFrontier.set(vin.txid, parent);
          }
          onProgress?.({ currentDepth: d + 1, maxDepth, txsFetched: fetchCount });
          if (layerTxs.size >= MAX_FANOUT_PER_LAYER) break;
        } catch {
          // Failed to fetch - skip this branch
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

  return { layers, allTxs, fetchCount, aborted: signal?.aborted ?? false };
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
  const allTxs = new Map<string, MempoolTransaction>();
  const visited = new Set<string>([tx.txid]);
  const layers: TraceLayer[] = [];
  let fetchCount = 0;

  // Seed frontier
  let frontier = new Map<string, MempoolTransaction>([[tx.txid, tx]]);
  // Cache outspends for first hop
  let frontierOutspends = new Map<string, MempoolOutspend[]>();
  if (existingOutspends) {
    frontierOutspends.set(tx.txid, existingOutspends);
  }

  for (let d = 0; d < maxDepth; d++) {
    if (signal?.aborted) return { layers, allTxs, fetchCount, aborted: true };

    onProgress?.({ currentDepth: d + 1, maxDepth, txsFetched: fetchCount });

    // layerTxs = all txs discovered at this depth (including barrier txs)
    // nextFrontier = only non-barrier txs (expanded in next hop)
    const layerTxs = new Map<string, MempoolTransaction>();
    const nextFrontier = new Map<string, MempoolTransaction>();

    for (const [txid, ftx] of frontier) {
      // Get outspends for this tx
      let outspends = frontierOutspends.get(txid);
      if (!outspends) {
        try {
          if (signal?.aborted) break;
          outspends = await fetcher.getTxOutspends(txid);
          fetchCount++;
        } catch {
          continue;
        }
      }

      // Follow spent outputs
      for (let i = 0; i < outspends.length; i++) {
        const os = outspends[i];
        if (!os.spent || !os.txid) continue;
        if (visited.has(os.txid)) continue;

        // Filter by minimum output value
        const outputValue = ftx.vout[i]?.value ?? 0;
        if (outputValue > 0 && outputValue < minSats) continue;

        visited.add(os.txid);

        // Check existing children first
        if (d === 0 && existingChildren?.has(os.txid)) {
          const cached = existingChildren.get(os.txid)!;
          allTxs.set(os.txid, cached);
          layerTxs.set(os.txid, cached);
          // Entity barrier: don't expand through custodial entities
          if (!entityBarrier || !entityBarrier(cached)) {
            nextFrontier.set(os.txid, cached);
          }
          continue;
        }

        try {
          if (signal?.aborted) break;
          const child = await fetcher.getTransaction(os.txid);
          fetchCount++;
          allTxs.set(os.txid, child);
          layerTxs.set(os.txid, child);
          // Entity barrier: don't expand through custodial entities
          if (!entityBarrier || !entityBarrier(child)) {
            nextFrontier.set(os.txid, child);
          }
          onProgress?.({ currentDepth: d + 1, maxDepth, txsFetched: fetchCount });
          if (layerTxs.size >= MAX_FANOUT_PER_LAYER) break;
        } catch {
          // Failed to fetch - skip this branch
        }
      }
      if (layerTxs.size >= MAX_FANOUT_PER_LAYER) break;
    }

    if (layerTxs.size === 0) break;
    layers.push({ depth: d + 1, txs: new Map(layerTxs) });

    // Only expand non-barrier txs in the next hop
    if (nextFrontier.size === 0) break;
    frontier = nextFrontier;
    frontierOutspends = new Map();
  }

  return { layers, allTxs, fetchCount, aborted: signal?.aborted ?? false };
}
