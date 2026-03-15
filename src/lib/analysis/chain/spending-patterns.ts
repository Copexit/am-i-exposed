import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { fmtN } from "@/lib/format";
import { isCoinJoinTx } from "../heuristics/coinjoin";
import { getSpendableOutputs } from "../heuristics/tx-utils";

/**
 * Spending pattern analysis: detect partial spends, ricochet,
 * post-CoinJoin spending mistakes, and KYC consolidation-before-CoinJoin.
 */

export interface SpendingPatternResult {
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
  const spendable = getSpendableOutputs(tx.vout);
  if (spendable.length !== 2) return null;

  const totalInput = tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
  if (totalInput === 0) return null;

  const [v1, v2] = [spendable[0].value, spendable[1].value];
  const smaller = Math.min(v1, v2);
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
 * Detect ricochet pattern: chain of 4+ single-input single-output
 * transactions. Ricochet is a GOOD practice - adds hops between
 * CoinJoin and destination to defeat shallow chain analysis.
 */
export function detectRicochet(
  tx: MempoolTransaction,
  parentTxs: Map<number, MempoolTransaction>,
): Finding | null {
  // Ricochet: 1 input, 1 output (sweep), chain of 4+ hops
  // Check if this tx is part of a chain of sweeps
  if (tx.vin.length !== 1 || tx.vin[0].is_coinbase) return null;

  const spendable = getSpendableOutputs(tx.vout);
  if (spendable.length !== 1) return null;

  // Walk backward through parent chain counting consecutive sweeps
  let hops = 1; // current tx counts as 1
  let originIsCoinJoin = false;
  const firstParent = parentTxs.get(0);

  if (firstParent && firstParent.txid !== tx.txid) {
    // Check if the parent is a CoinJoin (the origin)
    if (isCoinJoinTx(firstParent)) {
      originIsCoinJoin = true;
    } else {
      // Parent must also be 1-in-1-out sweep to count as a hop
      const parentSpendable = getSpendableOutputs(firstParent.vout);
      if (
        firstParent.vin.length === 1 &&
        parentSpendable.length === 1 &&
        !firstParent.vin[0].is_coinbase
      ) {
        hops++;
        // Can't walk further without grandparent data (single-parent limitation)
      }
    }
  }

  // Sweep from CoinJoin origin = ricochet (even 1 hop is meaningful)
  if (hops >= 1 && originIsCoinJoin) {
    return {
      id: "chain-ricochet",
      severity: "good",
      title: "Ricochet pattern detected (post-CoinJoin hop chain)",
      description:
        `This transaction is part of a chain of ${hops}+ single-input single-output ` +
        "transactions originating from a CoinJoin. This ricochet pattern adds hops " +
        "between the CoinJoin and the final destination, defeating exchange chain " +
        "analysis that only looks back 3-5 transactions.",
      recommendation:
        "Ricochet is a good privacy practice after CoinJoin, especially when sending " +
        "to exchanges or services that perform chain analysis. Ashigaru/Samourai " +
        "automates 4-hop ricochet.",
      scoreImpact: 5,
      params: { hops },
      confidence: "high",
    };
  }

  // If it's a sweep chain but NOT from CoinJoin, it could still be ricochet
  // but we can't confirm - just note the pattern
  if (hops >= 2) {
    return {
      id: "chain-sweep-chain",
      severity: "low",
      title: "Chain of sweep transactions detected",
      description:
        `This transaction is part of a chain of ${hops}+ single-input single-output ` +
        "transactions. This could be a ricochet (good - adding hops for privacy) or " +
        "a simple wallet migration pattern.",
      recommendation:
        "If this is intentional ricochet after CoinJoin, good practice. If not, " +
        "consider why funds are being moved through multiple hops without mixing.",
      scoreImpact: 0,
      params: { hops },
      confidence: "medium",
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
    const totalInput = tx.vin[0].prevout?.value ?? 0;
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
): SpendingPatternResult {
  const findings: Finding[] = [];
  let isRicochet = false;
  let isKycConsolidationBeforeCJ = false;
  const postCjPartialSpends: number[] = [];

  // 1. Near-exact spend warning
  const partialSpend = detectPartialSpendWarning(tx);
  if (partialSpend) findings.push(partialSpend);

  // 2. Ricochet detection
  const ricochet = detectRicochet(tx, parentTxs);
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
        (o) => o.value === minVal && o.scriptpubkey_type !== "op_return",
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

  return { findings, isRicochet, isKycConsolidationBeforeCJ, postCjPartialSpends };
}
