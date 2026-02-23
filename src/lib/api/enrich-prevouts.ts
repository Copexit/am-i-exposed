import type { MempoolTransaction } from "./types";

/**
 * Prevout Enrichment
 *
 * Self-hosted mempool instances (e.g., Umbrel with romanz/electrs) may return
 * `vin[].prevout = null` because they lack the indexes that mempool/electrs
 * builds. This module reconstructs missing prevout data by fetching the
 * parent transactions and looking up the referenced outputs.
 *
 * Zero overhead when not needed: needsEnrichment() checks the first non-coinbase
 * input and returns false immediately if prevout is already populated.
 */

const DEFAULT_MAX_PARENTS = 50;
const DEFAULT_CONCURRENCY = 4;

/**
 * Quick O(1) check: does any transaction have missing prevout data?
 * Checks the first non-coinbase input only - if the backend populates prevout,
 * all inputs will have it; if it doesn't, none will.
 */
export function needsEnrichment(txs: MempoolTransaction[]): boolean {
  for (const tx of txs) {
    for (const vin of tx.vin) {
      if (vin.is_coinbase) continue;
      return vin.prevout === null;
    }
  }
  return false;
}

export interface EnrichOptions {
  /** Function to fetch a transaction by txid (typically api.getTransaction) */
  getTransaction: (txid: string) => Promise<MempoolTransaction>;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Maximum number of unique parent txids to fetch (default 50) */
  maxParentTxids?: number;
  /** Maximum concurrent fetches per batch (default 4) */
  concurrency?: number;
}

export interface EnrichResult {
  /** Number of vin[].prevout fields successfully reconstructed */
  enrichedCount: number;
  /** Number of parent transaction fetches that failed */
  failedCount: number;
  /** Number of unique parent txids skipped due to cap */
  skippedCount: number;
}

/**
 * Reconstruct missing prevout data by fetching parent transactions.
 *
 * Mutates the input transactions in place - the same object references that
 * are passed to heuristics will have their prevout fields populated.
 *
 * For a typical 2-input transaction: 1 batch, ~200-400ms on LAN.
 * For production mempool.space where prevout is already populated: not called
 * (needsEnrichment returns false).
 */
export async function enrichPrevouts(
  txs: MempoolTransaction[],
  options: EnrichOptions,
): Promise<EnrichResult> {
  const {
    getTransaction,
    signal,
    maxParentTxids = DEFAULT_MAX_PARENTS,
    concurrency = DEFAULT_CONCURRENCY,
  } = options;

  // 1. Collect all inputs that need enrichment, grouped by parent txid
  const patchTargets = new Map<
    string,
    Array<{ tx: MempoolTransaction; vinIndex: number; voutIndex: number }>
  >();

  for (const tx of txs) {
    for (let i = 0; i < tx.vin.length; i++) {
      const vin = tx.vin[i];
      if (vin.is_coinbase || vin.prevout !== null) continue;

      const parentId = vin.txid;
      let targets = patchTargets.get(parentId);
      if (!targets) {
        targets = [];
        patchTargets.set(parentId, targets);
      }
      targets.push({ tx, vinIndex: i, voutIndex: vin.vout });
    }
  }

  if (patchTargets.size === 0) {
    return { enrichedCount: 0, failedCount: 0, skippedCount: 0 };
  }

  // 2. Apply cap on unique parent txids
  const allParentIds = [...patchTargets.keys()];
  const toFetch = allParentIds.slice(0, maxParentTxids);
  const skippedCount = Math.max(0, allParentIds.length - maxParentTxids);

  // 3. Fetch parent transactions in batches
  let enrichedCount = 0;
  let failedCount = 0;
  const parentCache = new Map<string, MempoolTransaction>();

  for (let i = 0; i < toFetch.length; i += concurrency) {
    if (signal?.aborted) break;

    const batch = toFetch.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((txid) => getTransaction(txid)),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        parentCache.set(batch[j], result.value);
      } else {
        failedCount++;
      }
    }
  }

  // 4. Patch prevout fields in place
  for (const [parentId, targets] of patchTargets) {
    const parentTx = parentCache.get(parentId);
    if (!parentTx) continue;

    for (const { tx, vinIndex, voutIndex } of targets) {
      const output = parentTx.vout[voutIndex];
      if (!output) continue;

      tx.vin[vinIndex].prevout = {
        scriptpubkey: output.scriptpubkey,
        scriptpubkey_asm: output.scriptpubkey_asm,
        scriptpubkey_type: output.scriptpubkey_type,
        // scriptpubkey_address may be undefined for bare multisig / non-standard outputs.
        // Default to empty string so heuristics' truthiness checks work correctly.
        scriptpubkey_address: output.scriptpubkey_address ?? "",
        value: output.value,
      };
      enrichedCount++;
    }
  }

  return { enrichedCount, failedCount, skippedCount };
}

/**
 * Count remaining null prevouts after enrichment, for diagnostic purposes.
 */
export function countNullPrevouts(txs: MempoolTransaction[]): number {
  let count = 0;
  for (const tx of txs) {
    for (const vin of tx.vin) {
      if (!vin.is_coinbase && vin.prevout === null) count++;
    }
  }
  return count;
}
