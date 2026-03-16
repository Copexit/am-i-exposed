/**
 * Node relevance scoring for smart graph auto-population.
 *
 * Scores each candidate node on a 0-100 scale. Only nodes scoring
 * above the threshold are auto-shown in the initial graph view.
 * Low-scoring nodes remain available via manual click-to-expand.
 */

import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { isCoinJoinTx } from "@/lib/analysis/heuristics/coinjoin";
import type { MempoolTransaction } from "@/lib/api/types";

/** Minimum relevance score to auto-show a node in the graph. */
export const RELEVANCE_THRESHOLD = 20;

export interface NodeScore {
  score: number;
  reasons: string[];
}

/**
 * Score a candidate node for relevance to the root transaction.
 *
 * @param tx - The candidate transaction to score
 * @param rootTx - The root transaction being analyzed
 * @param direction - Whether this node is backward (parent) or forward (child) of root
 * @param depth - Distance from root (1 = direct parent/child, 2 = grandparent/grandchild)
 * @param rootChangeOutputIndex - The identified change output index of the root tx (null if unknown)
 * @param edgeOutputIndex - Which output of the parent this node spends (for forward direction)
 */
export function scoreNode(
  tx: MempoolTransaction,
  rootTx: MempoolTransaction,
  direction: "backward" | "forward",
  depth: number,
  rootChangeOutputIndex: number | null,
  edgeOutputIndex?: number,
): NodeScore {
  let score = 0;
  const reasons: string[] = [];

  // ─── Entity detection (most important signal) ───────────
  const entityMatch = getBestEntityForScoring(tx);
  if (entityMatch) {
    if (entityMatch.ofac) {
      score += 60;
      reasons.push("OFAC entity");
    } else {
      score += 40;
      reasons.push(`Entity: ${entityMatch.name} (${entityMatch.category})`);
    }
  }

  // ─── CoinJoin detection (privacy boundary) ──────────────
  if (isCoinJoinTx(tx)) {
    score += 10;
    reasons.push("CoinJoin");
  }

  // ─── Structural signals ─────────────────────────────────

  const nonCoinbaseInputs = tx.vin.filter((v) => !v.is_coinbase).length;

  // Consolidation (5+ inputs = strong CIOH signal)
  if (nonCoinbaseInputs >= 5) {
    score += 25;
    reasons.push(`Consolidation (${nonCoinbaseInputs} inputs)`);
  }

  // 1-in/1-out sweep (likely same entity, traceable)
  if (nonCoinbaseInputs === 1 && tx.vout.length === 1) {
    score += 20;
    reasons.push("Sweep");
  }

  // ─── Direction-specific signals ─────────────────────────

  if (direction === "backward") {
    // Deterministic link: single-input tx feeding into root
    if (nonCoinbaseInputs === 1) {
      score += 15;
      reasons.push("Single-input parent");
    }

    // Same address as a root input (same wallet origin)
    const rootInputAddrs = new Set(
      rootTx.vin
        .filter((v) => !v.is_coinbase && v.prevout?.scriptpubkey_address)
        .map((v) => v.prevout!.scriptpubkey_address),
    );
    for (const vout of tx.vout) {
      if (vout.scriptpubkey_address && rootInputAddrs.has(vout.scriptpubkey_address)) {
        score += 20;
        reasons.push("Same address as root input");
        break;
      }
    }
  }

  if (direction === "forward") {
    // Spends the root's identified change output (peel chain continuation)
    if (rootChangeOutputIndex !== null && edgeOutputIndex === rootChangeOutputIndex) {
      score += 35;
      reasons.push("Spends change output");
    }

    // Spends a non-change output (payment recipient's next action)
    if (rootChangeOutputIndex !== null && edgeOutputIndex !== undefined && edgeOutputIndex !== rootChangeOutputIndex) {
      score += 15;
      reasons.push("Payment recipient action");
    }
  }

  // ─── Depth penalty (scales with distance) ────────────────
  if (depth >= 2) {
    const penalty = (depth - 1) * 10; // depth 2 = -10, depth 3 = -20, depth 4 = -30...
    score -= penalty;
    reasons.push(`Depth penalty (-${penalty})`);
  }

  return { score, reasons };
}

/** Quick entity check for scoring (cheaper than full getBestEntityMatch). */
function getBestEntityForScoring(tx: MempoolTransaction): { name: string; category: string; ofac: boolean } | null {
  // Check output addresses
  for (const o of tx.vout) {
    if (!o.scriptpubkey_address) continue;
    const m = matchEntitySync(o.scriptpubkey_address);
    if (m) return { name: m.entityName, category: m.category, ofac: m.ofac ?? false };
  }
  // Check input prevout addresses
  for (const v of tx.vin) {
    if (v.is_coinbase || !v.prevout?.scriptpubkey_address) continue;
    const m = matchEntitySync(v.prevout.scriptpubkey_address);
    if (m) return { name: m.entityName, category: m.category, ofac: m.ofac ?? false };
  }
  return null;
}
