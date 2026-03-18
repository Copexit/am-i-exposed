import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { fmtN } from "@/lib/format";
import { isCoinJoinTx } from "../heuristics/coinjoin";
import { getSpendableOutputs } from "../heuristics/tx-utils";

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

const ASHIGARU_FEE_ADDR = "bc1qsc887pxce0r3qed50e8he49a3amenemgptakg2";
const ASHIGARU_FEE_SATS = 100_000;

/** Check if a transaction is a Ricochet hop 0 (pays Ashigaru fee). */
function isRicochetHop0(tx: MempoolTransaction): boolean {
  return tx.vout.some(
    o => o.scriptpubkey_address === ASHIGARU_FEE_ADDR && o.value === ASHIGARU_FEE_SATS,
  );
}

/**
 * Detect ricochet pattern: chain of single-input single-output
 * transactions. Ricochet is a GOOD practice - adds hops between
 * CoinJoin and destination to defeat shallow chain analysis.
 *
 * Detection covers:
 * - Sweep chains originating from a CoinJoin (existing behavior)
 * - Hops 1-4 of a Ricochet chain (parent is hop 0 with Ashigaru fee, or another sweep from hop 0)
 */
export function detectRicochet(
  tx: MempoolTransaction,
  parentTxs: Map<number, MempoolTransaction>,
  allBackwardTxs?: Map<string, MempoolTransaction>,
): Finding | null {
  // Ricochet: 1 input, 1-2 outputs (sweep or PayNym fee split)
  if (tx.vin.length !== 1 || tx.vin[0].is_coinbase) return null;

  const spendable = getSpendableOutputs(tx.vout);
  if (spendable.length < 1 || spendable.length > 2) return null;

  // Walk backward through ancestors to find hop 0 or CoinJoin origin.
  // Use allBackwardTxs (all trace layers) when available for multi-hop detection.
  let hops = 1; // current tx counts as 1
  let originIsCoinJoin = false;
  let originIsRicochetHop0 = false;

  // Build a txid -> tx lookup from all available backward data
  const txLookup = new Map<string, MempoolTransaction>();
  if (allBackwardTxs) {
    for (const [txid, btx] of allBackwardTxs) txLookup.set(txid, btx);
  }
  // Also include immediate parents (always available, may overlap)
  for (const [, ptx] of parentTxs) {
    if (ptx && !txLookup.has(ptx.txid)) txLookup.set(ptx.txid, ptx);
  }

  // Walk backward through the chain: follow input txids to find ancestors
  let currentTx: MempoolTransaction | undefined = tx;
  const visited = new Set<string>([tx.txid]);

  for (let depth = 0; depth < 5; depth++) {
    const parentTxid = currentTx.vin[0]?.txid;
    if (!parentTxid || visited.has(parentTxid)) break;
    visited.add(parentTxid);

    const ancestor = txLookup.get(parentTxid);
    if (!ancestor) break;

    if (isCoinJoinTx(ancestor)) {
      originIsCoinJoin = true;
      hops++;
      break;
    }

    if (isRicochetHop0(ancestor)) {
      originIsRicochetHop0 = true;
      hops++;
      break;
    }

    // Ancestor must be a sweep (1-in, 1-2 out) to continue the chain
    const ancestorSpendable = getSpendableOutputs(ancestor.vout);
    if (
      ancestor.vin.length !== 1 ||
      ancestorSpendable.length > 2 ||
      ancestor.vin[0].is_coinbase
    ) {
      break;
    }

    hops++;
    currentTx = ancestor;
  }

  // Hop in a Ricochet chain originating from known hop 0
  if (originIsRicochetHop0) {
    const hopNumber = hops - 1;
    return {
      id: "chain-ricochet",
      severity: "good",
      title: `Ricochet (Ashigaru) hop ${hopNumber}`,
      description:
        `This transaction is hop ${hopNumber} of an Ashigaru Ricochet chain. ` +
        "Ricochet adds transactional distance between a CoinJoin and the final destination, " +
        "defeating shallow chain analysis by exchanges that only look back 3-5 transactions. " +
        "Ricochet provides retrospective anonymity (distancing past history) rather than " +
        "prospective anonymity (like CoinJoin).",
      recommendation:
        "Ricochet is a good practice when sending to exchanges or services that perform chain analysis. " +
        "For even better privacy, use the PayNym variant which eliminates the detectable fee address fingerprint.",
      scoreImpact: 5,
      params: { hops, hopNumber, wallet: "Ashigaru" },
      confidence: "high",
    };
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
 * Detect post-CoinJoin consolidation: 2+ inputs from CoinJoin outputs
 * spent together in a non-CoinJoin transaction. This re-links the UTXOs
 * via Common Input Ownership, destroying the anonymity gained from mixing.
 *
 * Amount correlation makes this especially damaging: an observer who sees
 * the CoinJoin inputs and the consolidated output can correlate the exact
 * amounts that entered the mix, effectively undoing it.
 */
function detectPostMixConsolidation(
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
  // The real cost is the reduction of the CoinJoin bonus (handled in cross-heuristic.ts).
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

  // 5. Post-CoinJoin consolidation (inputs from 2+ CoinJoin outputs)
  const postMixConsolidation = detectPostMixConsolidation(tx, coinJoinInputIndices);
  if (postMixConsolidation) findings.push(postMixConsolidation);

  return { findings, isRicochet, isKycConsolidationBeforeCJ, postCjPartialSpends };
}
