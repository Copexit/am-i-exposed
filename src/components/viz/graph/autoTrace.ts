/**
 * Auto-trace utilities for the transaction graph.
 *
 * Identifies the most likely change output for peel chain tracing,
 * and orchestrates multi-hop auto-expansion.
 */

import { analyzeChangeDetection } from "@/lib/analysis/heuristics/change-detection";
import { analyzeCoinJoin, isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import type { MempoolTransaction } from "@/lib/api/types";

/** Result of identifying the best change output for tracing. */
export interface ChangeOutputResult {
  /** The vout index of the most likely change output, or null if ambiguous/terminal. */
  changeOutputIndex: number | null;
  /** Why this output was chosen (or why tracing stopped). */
  reason: "change-detected" | "same-address-io" | "self-send" | "single-spendable" | "ambiguous" | "coinjoin" | "entity" | "no-spendable" | "unspent";
  /** Confidence level. */
  confidence: "deterministic" | "high" | "medium" | "low" | "none";
}

/**
 * Identify the most likely change output for a transaction.
 * Used by auto-trace to decide which output to follow.
 *
 * Priority:
 * 1. Same-address-in-output (deterministic - output returns to input address)
 * 2. Change detection heuristics (h2-change-detected with changeIndex)
 * 3. Single spendable output (trivial - only one option)
 * 4. Ambiguous (multiple candidates, no consensus)
 *
 * Returns null changeOutputIndex for terminal conditions:
 * - CoinJoin detected (mixing boundary - don't trace through)
 * - Known entity detected (custodial boundary)
 * - No spendable outputs
 */
export function identifyChangeOutput(tx: MempoolTransaction): ChangeOutputResult {
  // Terminal: CoinJoin detected - don't trace through mixing
  const cjResult = analyzeCoinJoin(tx);
  if (cjResult.findings.some(isCoinJoinFinding)) {
    return { changeOutputIndex: null, reason: "coinjoin", confidence: "none" };
  }

  // Terminal: known entity on any output (custodial boundary)
  for (const vout of tx.vout) {
    if (vout.scriptpubkey_address) {
      const entity = matchEntitySync(vout.scriptpubkey_address);
      if (entity && (entity.category === "exchange" || entity.category === "gambling" || entity.category === "payment")) {
        return { changeOutputIndex: null, reason: "entity", confidence: "none" };
      }
    }
  }

  // Count spendable outputs (non-OP_RETURN, non-zero-value)
  const spendable: number[] = [];
  for (let i = 0; i < tx.vout.length; i++) {
    const v = tx.vout[i];
    if (v.scriptpubkey_type !== "op_return" && v.value > 0 && v.scriptpubkey_address) {
      spendable.push(i);
    }
  }

  if (spendable.length === 0) {
    return { changeOutputIndex: null, reason: "no-spendable", confidence: "none" };
  }

  // Single spendable output - trivial, it's the only option (sweep or consolidation output)
  if (spendable.length === 1) {
    return { changeOutputIndex: spendable[0], reason: "single-spendable", confidence: "high" };
  }

  // Run change detection heuristics
  const cdResult = analyzeChangeDetection(tx);

  // Priority 1: same-address-io (deterministic)
  const sameAddrFinding = cdResult.findings.find((f) => f.id === "h2-same-address-io");
  if (sameAddrFinding?.params) {
    const indicesStr = (sameAddrFinding.params as Record<string, unknown>).selfSendIndices;
    if (typeof indicesStr === "string" && indicesStr.length > 0) {
      const indices = indicesStr.split(",").map(Number).filter((n) => !isNaN(n));
      if (indices.length === 1) {
        return { changeOutputIndex: indices[0], reason: "same-address-io", confidence: "deterministic" };
      }
      // Multiple same-address outputs - pick the largest (most likely the main change)
      if (indices.length > 1) {
        const largest = indices.reduce((best, idx) =>
          tx.vout[idx].value > tx.vout[best].value ? idx : best, indices[0]);
        return { changeOutputIndex: largest, reason: "same-address-io", confidence: "high" };
      }
    }
  }

  // Priority 2: h2-change-detected (heuristic consensus)
  const changeFinding = cdResult.findings.find((f) => f.id === "h2-change-detected");
  if (changeFinding?.params) {
    const idx = (changeFinding.params as Record<string, unknown>).changeIndex;
    if (typeof idx === "number") {
      const confidence = (changeFinding.params as Record<string, unknown>).confidence;
      return {
        changeOutputIndex: idx,
        reason: "change-detected",
        confidence: confidence === "high" ? "high" : "medium",
      };
    }
  }

  // Ambiguous - no clear change output
  return { changeOutputIndex: null, reason: "ambiguous", confidence: "none" };
}
