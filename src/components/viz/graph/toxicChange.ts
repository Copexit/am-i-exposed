/**
 * Detect toxic change merges in the transaction graph.
 *
 * A toxic merge happens when a CoinJoin's non-equal-denomination output (change)
 * is later spent in the same transaction as one of the CoinJoin's equal outputs
 * (mixed UTXO). This destroys the CoinJoin's privacy by linking the mixed output
 * to the change, which is already identifiable.
 */

import { analyzeCoinJoin, isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import type { GraphNode } from "@/hooks/useGraphExpansion";
import type { MempoolTransaction } from "@/lib/api/types";

/** A toxic merge detection result. */
export interface ToxicMerge {
  /** Txid of the transaction that merges mixed + unmixed UTXOs. */
  mergeTxid: string;
  /** Txid of the CoinJoin whose privacy was destroyed. */
  coinjoinTxid: string;
  /** The mixed output index from the CoinJoin that was merged. */
  mixedOutputIndex: number;
  /** The change output index from the CoinJoin that was merged. */
  changeOutputIndex: number;
}

/**
 * Find CoinJoin equal-denomination outputs and non-equal outputs (change).
 * Returns { equalIndices, changeIndices } based on output value frequency.
 */
function classifyCoinJoinOutputs(tx: MempoolTransaction): { equalIndices: number[]; changeIndices: number[] } {
  const spendable = tx.vout
    .map((v, i) => ({ value: v.value, index: i, type: v.scriptpubkey_type }))
    .filter((v) => v.type !== "op_return" && v.value > 0);

  if (spendable.length < 3) return { equalIndices: [], changeIndices: [] };

  // Count value frequencies
  const freq = new Map<number, number>();
  for (const v of spendable) {
    freq.set(v.value, (freq.get(v.value) ?? 0) + 1);
  }

  // The denomination is the most frequent value (with at least 2 occurrences)
  let denomValue = 0;
  let denomCount = 0;
  for (const [val, count] of freq) {
    if (count > denomCount) {
      denomCount = count;
      denomValue = val;
    }
  }

  if (denomCount < 2) return { equalIndices: [], changeIndices: [] };

  const equalIndices = spendable.filter((v) => v.value === denomValue).map((v) => v.index);
  const changeIndices = spendable.filter((v) => v.value !== denomValue).map((v) => v.index);

  return { equalIndices, changeIndices };
}

/**
 * Detect toxic change merges across the graph.
 *
 * For each CoinJoin in the graph, check if any of its change outputs and any of
 * its equal outputs are both spent as inputs in the same future transaction.
 */
export function detectToxicMerges(nodes: Map<string, GraphNode>): ToxicMerge[] {
  const merges: ToxicMerge[] = [];

  // Build a spending map: which tx spends which output of which parent
  // Key: "${parentTxid}:${vout}" -> spending txid
  const spendingMap = new Map<string, string>();
  for (const [txid, node] of nodes) {
    for (const vin of node.tx.vin) {
      if (!vin.is_coinbase) {
        spendingMap.set(`${vin.txid}:${vin.vout}`, txid);
      }
    }
  }

  // For each CoinJoin in the graph
  for (const [txid, node] of nodes) {
    const cjResult = analyzeCoinJoin(node.tx);
    if (!cjResult.findings.some(isCoinJoinFinding)) continue;

    const { equalIndices, changeIndices } = classifyCoinJoinOutputs(node.tx);
    if (equalIndices.length === 0 || changeIndices.length === 0) continue;

    // Check if any equal output and any change output are spent in the same tx
    for (const mixIdx of equalIndices) {
      const mixSpender = spendingMap.get(`${txid}:${mixIdx}`);
      if (!mixSpender) continue;

      for (const changeIdx of changeIndices) {
        const changeSpender = spendingMap.get(`${txid}:${changeIdx}`);
        if (changeSpender === mixSpender) {
          merges.push({
            mergeTxid: mixSpender,
            coinjoinTxid: txid,
            mixedOutputIndex: mixIdx,
            changeOutputIndex: changeIdx,
          });
        }
      }
    }
  }

  return merges;
}

/** Build a set of txids that are toxic merge transactions. */
export function buildToxicMergeSet(merges: ToxicMerge[]): Set<string> {
  return new Set(merges.map((m) => m.mergeTxid));
}
