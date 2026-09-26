/**
 * Post-mix consolidation detection.
 *
 * Detects when 2+ CoinJoin outputs are spent together in a single
 * non-CoinJoin transaction, re-linking them via Common Input Ownership
 * and destroying the anonymity gained from mixing.
 */

import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { isCoinJoinTx } from "../heuristics/coinjoin";

/**
 * Detect post-CoinJoin consolidation: 2+ inputs from CoinJoin outputs
 * spent together in a non-CoinJoin transaction. This re-links the UTXOs
 * via Common Input Ownership, destroying the anonymity gained from mixing.
 *
 * Amount correlation makes this especially damaging: an observer who sees
 * the CoinJoin inputs and the consolidated output can correlate the exact
 * amounts that entered the mix, effectively undoing it.
 */
export function detectPostMixConsolidation(
  tx: MempoolTransaction,
  coinJoinInputIndices: number[],
): Finding | null {
  // Need 2+ inputs from CoinJoin to constitute consolidation
  if (coinJoinInputIndices.length < 2) return null;

  // If this tx is itself a CoinJoin, spending CJ outputs is remixing (fine)
  if (isCoinJoinTx(tx)) return null;

  // Count distinct parent CoinJoin txids
  const coinJoinParentTxids = new Set<string>();
  for (const idx of coinJoinInputIndices) {
    const vin = tx.vin[idx];
    if (vin && !vin.is_coinbase) {
      coinJoinParentTxids.add(vin.txid);
    }
  }

  const fromDifferentMixes = coinJoinParentTxids.size >= 2;
  const count = coinJoinInputIndices.length;

  // Severity scales with count but this is a warning, not a harsh penalty.
  // The real cost is the reduction of the CoinJoin bonus (handled in cross-heuristic/compound-scoring.ts).
  // 2-3 inputs: medium (sometimes necessary), 4-9: high, 10+: critical
  const severity = count >= 10 ? "critical" as const
    : count >= 4 ? "high" as const
    : "medium" as const;

  const sourceDesc = fromDifferentMixes
    ? `from ${coinJoinParentTxids.size} different CoinJoin transactions`
    : "from the same CoinJoin transaction";

  return {
    id: "chain-post-mix-consolidation",
    severity,
    confidence: "high",
    title: `Post-mix consolidation: ${count} CoinJoin outputs spent together`,
    params: {
      postMixInputCount: count,
      totalInputs: tx.vin.length,
      distinctCoinJoins: coinJoinParentTxids.size,
    },
    description:
      `This transaction spends ${count} outputs ${sourceDesc} as inputs ` +
      "in a single non-CoinJoin transaction. Common Input Ownership heuristic re-links these UTXOs, " +
      "reducing the anonymity gained from mixing." +
      (count >= 4
        ? " Amount correlation allows an observer to match the consolidated total to the amounts " +
          "that entered the CoinJoin."
        : "") +
      (fromDifferentMixes
        ? " Because the inputs come from different CoinJoin rounds, activity across those rounds " +
          "can now be linked to the same entity."
        : ""),
    recommendation:
      count >= 4
        ? "Avoid consolidating this many post-mix UTXOs. Spend each CoinJoin output individually " +
          "in separate transactions. Use coin control (available in Sparrow, Ashigaru)."
        : "Try to spend post-mix UTXOs individually when possible. If consolidation is necessary, " +
          "keep it to 2-3 outputs and consider re-mixing the result.",
    scoreImpact: 0, // No direct penalty - the CoinJoin bonus is reduced instead
    remediation: {
      steps: [
        "Avoid consolidating more post-mix UTXOs in the future.",
        "Consider re-mixing the consolidated output through CoinJoin to recover privacy.",
        "Use coin control to spend one post-mix UTXO per transaction when possible.",
        "If consolidation is unavoidable, use Stonewall to add structural ambiguity.",
      ],
      tools: [
        { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
        { name: "Ashigaru (Whirlpool)", url: "https://ashigaru.rs" },
      ],
      urgency: "immediate",
    },
  };
}
