import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { fmtN } from "@/lib/format";
import { isCoinJoinTx } from "../heuristics/coinjoin";
import { getSpendableOutputs, isOpReturnOutput } from "../heuristics/tx-utils";
import { detectRicochet } from "./ricochet-detection";
import { detectPostMixConsolidation } from "./post-mix-consolidation";

/**
 * Spending pattern analysis: detect partial spends, ricochet,
 * post-CoinJoin spending mistakes, and KYC consolidation-before-CoinJoin.
 */

interface SpendingPatternResult {
  findings: Finding[];
  /** Whether a ricochet pattern was detected */
  isRicochet: boolean;
  /** Whether KYC consolidation-before-CoinJoin pattern was detected */
  isKycConsolidationBeforeCJ: boolean;
  /** Output indices where post-CoinJoin partial spend was detected */
  postCjPartialSpends: number[];
}

/**
 * Detect near-exact spend (change < 5% of total input value).
 * When the change is very small relative to the spend, recommend
 * absorbing it into the fee next time.
 */
export function detectPartialSpendWarning(
  tx: MempoolTransaction,
): Finding | null {
  // Need at least 2 outputs (payment + change) and non-coinbase inputs
  const [out1, out2, extra] = getSpendableOutputs(tx.vout);
  if (!out1 || !out2 || extra) return null;

  const totalInput = tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
  if (totalInput === 0) return null;
  const smaller = Math.min(out1.value, out2.value);
  const changeRatio = smaller / totalInput;

  // Change is < 5% of total input - near-exact spend
  if (changeRatio > 0 && changeRatio < 0.05) {
    return {
      id: "chain-near-exact-spend",
      severity: "low",
      title: "Near-exact spend with tiny change output",
      description:
        `Change output (${fmtN(smaller)} sats) is less than 5% of the total ` +
        `input value. This small change creates a traceable link back to this transaction. ` +
        "Consider absorbing change into the miner fee or selecting a UTXO that matches " +
        "the payment amount more closely.",
      recommendation:
        "When a UTXO is close to the payment amount, spend the entire UTXO (no change) " +
        "even if it means slightly overpaying in fees. Use Branch-and-Bound coin selection " +
        "to find exact-match UTXOs automatically.",
      scoreImpact: -1,
      params: {
        changeAmount: smaller,
        changePercent: Math.round(changeRatio * 100),
      },
      confidence: "deterministic",
    };
  }

  return null;
}

/**
 * Detect post-CoinJoin partial spend: when a CoinJoin output is spent
 * with change, creating a traceable link. This is a high-severity mistake.
 */
export function detectPostCoinJoinPartialSpend(
  tx: MempoolTransaction,
  coinJoinInputIndices: number[],
): Finding | null {
  if (coinJoinInputIndices.length === 0) return null;

  // Check if this tx creates change (2 outputs, one smaller)
  const spendable = getSpendableOutputs(tx.vout);
  if (spendable.length < 2) return null; // full spend = good

  // If spending a single CoinJoin UTXO and creating change = bad
  if (coinJoinInputIndices.length === 1 && tx.vin.length === 1) {
    const totalInput = tx.vin[0]?.prevout?.value ?? 0;
    const largestOutput = Math.max(...spendable.map((o) => o.value));
    const changeAmount = totalInput - largestOutput - tx.fee;

    if (changeAmount > 0) {
      return {
        id: "chain-post-cj-partial-spend",
        severity: "high",
        title: "Post-CoinJoin UTXO was partially spent, creating traceable change",
        description:
          "A CoinJoin output was spent with a change output. This change is now linked " +
          "to the CoinJoin transaction, potentially allowing analysts to trace funds " +
          "through the mix. The CoinJoin's equal-output anonymity set is partially " +
          "broken by this change output.",
        recommendation:
          "Never partially spend CoinJoin outputs. Either spend the entire UTXO " +
          "(absorb difference into fee), use STONEWALL to create ambiguity, or " +
          "send change to a Monero atomic swap or Lightning channel.",
        scoreImpact: -8,
        params: { changeAmount },
        confidence: "high",
      };
    }
  }

  return null;
}

/**
 * Detect KYC consolidation-before-CoinJoin pattern:
 * consolidation from same source -> CoinJoin -> clean spend.
 * This is a GOOD practice - intentional privacy improvement.
 */
export function detectKycConsolidationBeforeCJ(
  tx: MempoolTransaction,
  outspends: MempoolOutspend[] | null,
  childTxs: Map<number, MempoolTransaction>,
): Finding | null {
  // This tx should be a consolidation: many inputs, 1-2 outputs
  const spendable = getSpendableOutputs(tx.vout);
  if (tx.vin.length < 2 || spendable.length > 2) return null;

  // Check if all inputs appear to come from similar sources
  // (same script type = likely same wallet)
  const inputTypes = new Set(
    tx.vin.map((v) => v.prevout?.scriptpubkey_type).filter(Boolean),
  );
  if (inputTypes.size > 2) return null; // too diverse = not same-source consolidation

  // Check if any output was spent into a CoinJoin
  if (!outspends) return null;

  for (const [outputIdx, childTx] of childTxs.entries()) {
    if (!childTx) continue;
    const outspend = outspends[outputIdx];
    if (!outspend?.spent) continue;

    if (isCoinJoinTx(childTx)) {
      return {
        id: "chain-kyc-consolidation-before-cj",
        severity: "good",
        title: "KYC consolidation before CoinJoin detected",
        description:
          "This transaction consolidates UTXOs from similar sources before sending " +
          "to a CoinJoin transaction. This is the recommended pattern for moving KYC " +
          "funds to privacy: consolidate same-source UTXOs, then CoinJoin to break " +
          "the link. Note that CoinJoin does not erase KYC from the exchange's records, " +
          "but it provides forward-looking on-chain privacy.",
        recommendation:
          "Good practice. After CoinJoin, spend each post-mix UTXO individually " +
          "to fresh addresses. Consider Ricochet (4 extra hops) before sending to " +
          "any service that performs chain analysis.",
        scoreImpact: 5,
        params: { inputCount: tx.vin.length },
        confidence: "high",
      };
    }
  }

  return null;
}

/**
 * Run all spending pattern detections on a transaction.
 */
export function analyzeSpendingPatterns(
  tx: MempoolTransaction,
  parentTxs: Map<number, MempoolTransaction>,
  coinJoinInputIndices: number[],
  outspends: MempoolOutspend[] | null,
  childTxs: Map<number, MempoolTransaction>,
  allBackwardTxs?: Map<string, MempoolTransaction>,
): SpendingPatternResult {
  const findings: Finding[] = [];
  let isRicochet = false;
  let isKycConsolidationBeforeCJ = false;
  const postCjPartialSpends: number[] = [];

  // 1. Near-exact spend warning
  const partialSpend = detectPartialSpendWarning(tx);
  if (partialSpend) findings.push(partialSpend);

  // 2. Ricochet detection (pass all backward txs for multi-hop ancestor walk)
  const ricochet = detectRicochet(tx, parentTxs, allBackwardTxs);
  if (ricochet) {
    findings.push(ricochet);
    isRicochet = ricochet.id === "chain-ricochet";
  }

  // 3. Post-CoinJoin partial spend
  const postCjPartial = detectPostCoinJoinPartialSpend(tx, coinJoinInputIndices);
  if (postCjPartial) {
    findings.push(postCjPartial);
    // Track which output indices have the problematic change.
    // In a 1-in-2-out post-CJ partial spend, the smaller output is the change.
    const spendableOuts = getSpendableOutputs(tx.vout);
    if (spendableOuts.length >= 2) {
      const minVal = Math.min(...spendableOuts.map((o) => o.value));
      const changeIdx = tx.vout.findIndex(
        (o) => o.value === minVal && !isOpReturnOutput(o),
      );
      if (changeIdx >= 0) postCjPartialSpends.push(changeIdx);
    }
  }

  // 4. KYC consolidation before CoinJoin
  const kycConsolidation = detectKycConsolidationBeforeCJ(tx, outspends, childTxs);
  if (kycConsolidation) {
    findings.push(kycConsolidation);
    isKycConsolidationBeforeCJ = true;
  }

  // 5. Post-CoinJoin consolidation (inputs from 2+ CoinJoin outputs)
  const postMixConsolidation = detectPostMixConsolidation(tx, coinJoinInputIndices);
  if (postMixConsolidation) findings.push(postMixConsolidation);

  return { findings, isRicochet, isKycConsolidationBeforeCJ, postCjPartialSpends };
}
