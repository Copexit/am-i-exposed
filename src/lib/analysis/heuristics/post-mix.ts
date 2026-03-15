import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { analyzeCoinJoin, isCoinJoinFinding } from "./coinjoin";
import { isCoinbase } from "./tx-utils";

/**
 * Post-Mix Mistake Detection
 *
 * Detects the most common privacy mistake after CoinJoin:
 * consolidating multiple post-mix UTXOs into a single transaction.
 *
 * When a user spends outputs from 2+ different CoinJoin transactions
 * together, they re-link those UTXOs via Common Input Ownership,
 * completely undoing the mixing benefit.
 *
 * Uses pre-fetched parent transactions from TxContext.parentTxs to
 * check if each input's parent was a CoinJoin.
 *
 * Severity:
 *   - 2 post-mix inputs: high (-12)
 *   - 3+ post-mix inputs: critical (-18)
 *
 * Reference: OXT Research, Samourai Wallet documentation
 */

export const analyzePostMix: TxHeuristic = (tx, _rawHex?, ctx?) => {
  const findings: Finding[] = [];

  // Need at least 2 inputs to consolidate
  if (tx.vin.length < 2) return { findings };
  if (isCoinbase(tx)) return { findings };

  // If this transaction is itself a CoinJoin, spending CoinJoin outputs as
  // inputs is normal (remixing). Only flag non-CoinJoin transactions.
  const currentTxResult = analyzeCoinJoin(tx);
  if (currentTxResult.findings.some(isCoinJoinFinding)) return { findings };

  // Need parent transaction data
  const parentTxs = ctx?.parentTxs;
  if (!parentTxs || parentTxs.size === 0) return { findings };

  // Check each input: does its parent tx look like a CoinJoin?
  const coinJoinInputIndices: number[] = [];
  const coinJoinParentTxids = new Set<string>();

  for (let i = 0; i < tx.vin.length; i++) {
    const vin = tx.vin[i];
    if (vin.is_coinbase) continue;

    const parentTx = parentTxs.get(vin.txid);
    if (!parentTx) continue;

    const parentResult = analyzeCoinJoin(parentTx);
    const parentIsCoinJoin = parentResult.findings.some(isCoinJoinFinding);

    if (parentIsCoinJoin) {
      coinJoinInputIndices.push(i);
      coinJoinParentTxids.add(vin.txid);
    }
  }

  // No post-mix consolidation if less than 2 inputs from CoinJoin
  if (coinJoinInputIndices.length < 2) return { findings };

  const fromDifferentMixes = coinJoinParentTxids.size >= 2;
  const isCritical = coinJoinInputIndices.length >= 3;

  const severity = isCritical ? "critical" as const : "high" as const;
  const impact = isCritical ? -18 : -12;

  const sourceDesc = fromDifferentMixes
    ? `from ${coinJoinParentTxids.size} different CoinJoin transactions`
    : "from the same CoinJoin transaction";

  findings.push({
    id: "post-mix-consolidation",
    severity,
    confidence: "high",
    title: `Post-mix consolidation: ${coinJoinInputIndices.length} CoinJoin outputs spent together`,
    params: {
      postMixInputCount: coinJoinInputIndices.length,
      totalInputs: tx.vin.length,
      distinctCoinJoins: coinJoinParentTxids.size,
    },
    description:
      `This transaction spends ${coinJoinInputIndices.length} outputs ${sourceDesc} as inputs ` +
      "in a single transaction. Common Input Ownership heuristic re-links these UTXOs, " +
      "completely destroying the anonymity set gained from mixing. " +
      (fromDifferentMixes
        ? "Because the inputs come from different CoinJoin rounds, an observer can now link " +
          "activity across those rounds to the same entity."
        : "Even though the inputs come from the same CoinJoin, spending them together reveals " +
          "which outputs belonged to the same participant."),
    recommendation:
      "Never consolidate post-mix UTXOs. Spend each CoinJoin output individually in separate " +
      "transactions. Use coin control (available in Sparrow, Ashigaru) to select exactly one " +
      "post-mix UTXO per payment.",
    scoreImpact: impact,
    remediation: {
      steps: [
        "Stop: do not consolidate any more post-mix UTXOs.",
        "Re-mix the consolidated output through CoinJoin to recover some privacy.",
        "Going forward, use coin control to spend one post-mix UTXO per transaction.",
        "Consider using Stonewall or Stowaway for post-mix spending to add structural ambiguity.",
      ],
      tools: [
        { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
        { name: "Ashigaru (Whirlpool)", url: "https://ashigaru.rs" },
      ],
      urgency: "immediate",
    },
  });

  return { findings };
};
