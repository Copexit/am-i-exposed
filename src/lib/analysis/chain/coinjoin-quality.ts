import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { Finding } from "@/lib/types";

/**
 * CoinJoin break detection - evaluate post-mix spending quality.
 *
 * When a transaction's inputs came from CoinJoin, evaluate whether the
 * post-mix spending preserves or destroys the privacy gain.
 */

export interface CoinJoinQualityResult {
  findings: Finding[];
  /** Overall quality score: -20 to +25 */
  qualityScore: number;
  /** Individual quality checks that passed */
  goodBehaviors: string[];
  /** Individual quality checks that failed */
  badBehaviors: string[];
}

interface QualityCheck {
  id: string;
  passed: boolean;
  weight: number; // positive = good, negative = bad
  description: string;
}

/**
 * Evaluate the quality of post-CoinJoin spending.
 *
 * @param tx - The transaction being analyzed
 * @param coinJoinInputIndices - Input indices that came from CoinJoin (from backward analysis)
 * @param outspends - Outspend data for the transaction
 * @param childTxs - Child transactions (for forward analysis of outputs)
 * @param parentTxs - Parent transactions (for checking CoinJoin origin details)
 */
export function evaluateCoinJoinQuality(
  tx: MempoolTransaction,
  coinJoinInputIndices: number[],
  outspends: MempoolOutspend[] | null,
  childTxs: Map<number, MempoolTransaction>,
  parentTxs: Map<number, MempoolTransaction>,
): CoinJoinQualityResult {
  const findings: Finding[] = [];
  const checks: QualityCheck[] = [];

  // If no CoinJoin inputs, nothing to evaluate
  if (coinJoinInputIndices.length === 0) {
    return { findings, qualityScore: 0, goodBehaviors: [], badBehaviors: [] };
  }

  const nonCoinbase = tx.vin.filter((v) => !v.is_coinbase);
  const allFromCoinJoin = coinJoinInputIndices.length === nonCoinbase.length;

  // Check 1: Single UTXO per transaction (no consolidation of CJ outputs)
  const multipleCjInputs = coinJoinInputIndices.length > 1;
  const sameCjParent = checkSameCoinJoinParent(tx, coinJoinInputIndices);
  if (multipleCjInputs && sameCjParent) {
    checks.push({
      id: "no-consolidation",
      passed: false,
      weight: -15,
      description: "Multiple CoinJoin outputs from the same mix were consolidated",
    });
  } else if (coinJoinInputIndices.length === 1) {
    checks.push({
      id: "no-consolidation",
      passed: true,
      weight: 5,
      description: "Single CoinJoin UTXO spent per transaction",
    });
  }

  // Check 2: No mixing of CoinJoin and non-CoinJoin inputs
  if (!allFromCoinJoin && nonCoinbase.length > 1) {
    checks.push({
      id: "no-mix-origins",
      passed: false,
      weight: -8,
      description: "CoinJoin outputs mixed with non-CoinJoin inputs",
    });
  } else if (allFromCoinJoin || nonCoinbase.length === 1) {
    checks.push({
      id: "no-mix-origins",
      passed: true,
      weight: 3,
      description: "No mixing of CoinJoin and non-CoinJoin funds",
    });
  }

  // Check 3: Output goes to fresh addresses
  // We can only check structurally: if outputs use different script types than inputs,
  // that's slightly better (cross-type = likely fresh)
  const inputTypes = new Set(
    tx.vin.map((v) => v.prevout?.scriptpubkey_type).filter(Boolean),
  );
  const outputTypes = new Set(tx.vout.map((o) => o.scriptpubkey_type));
  const sameTypeOnly = [...outputTypes].every((t) => inputTypes.has(t));
  checks.push({
    id: "fresh-addresses",
    passed: sameTypeOnly,
    weight: sameTypeOnly ? 2 : -1,
    description: sameTypeOnly
      ? "Outputs use same address type as inputs (consistent fingerprint)"
      : "Outputs use different address types than inputs (may reveal change)",
  });

  // Check 4: Time elapsed since CoinJoin (> 6 blocks)
  const cjParentTx = parentTxs.get(coinJoinInputIndices[0]);
  if (cjParentTx && tx.status.confirmed && cjParentTx.status.confirmed) {
    const parentHeight = cjParentTx.status.block_height ?? 0;
    const txHeight = tx.status.block_height ?? 0;
    const blockGap = txHeight - parentHeight;

    if (blockGap >= 6) {
      checks.push({
        id: "time-elapsed",
        passed: true,
        weight: 3,
        description: `${blockGap} blocks elapsed since CoinJoin (>= 6 recommended)`,
      });
    } else {
      checks.push({
        id: "time-elapsed",
        passed: false,
        weight: -3,
        description: `Only ${blockGap} blocks since CoinJoin (< 6 minimum recommended)`,
      });
    }
  }

  // Check 5: Change is small relative to payment (if 2 outputs)
  const spendable = tx.vout.filter((o) => !o.scriptpubkey.startsWith("6a"));
  if (spendable.length === 2) {
    const [v1, v2] = [spendable[0].value, spendable[1].value];
    const smaller = Math.min(v1, v2);
    const larger = Math.max(v1, v2);
    const changeRatio = smaller / (smaller + larger);

    if (changeRatio < 0.05) {
      checks.push({
        id: "small-change",
        passed: true,
        weight: 2,
        description: "Change is very small relative to payment amount",
      });
    } else if (changeRatio > 0.3) {
      checks.push({
        id: "small-change",
        passed: false,
        weight: -2,
        description: "Significant change output - consider absorbing into fee or using exact amount",
      });
    }
  }

  // Check 6: No toxic change merge (forward analysis)
  if (outspends) {
    for (const [outputIdx, childTx] of childTxs.entries()) {
      if (!childTx || childTx.vin.length < 2) continue;
      // Check if child tx combines this tx's output with non-CJ outputs
      const hasThisTxInput = childTx.vin.some((v) => v.txid === tx.txid);
      const hasOtherInput = childTx.vin.some((v) => v.txid !== tx.txid);
      if (hasThisTxInput && hasOtherInput) {
        // Conservative: any child tx combining this CoinJoin output with
        // inputs from other transactions is flagged. Without fetching the
        // other parent txs we cannot verify whether they are also CoinJoin,
        // so this may over-report when two CoinJoin outputs are combined.
        checks.push({
          id: `toxic-merge-${outputIdx}`,
          passed: false,
          weight: -10,
          description: `Output ${outputIdx} was later spent alongside inputs from other transactions`,
        });
      }
    }
  }

  // Calculate overall quality score
  const goodChecks = checks.filter((c) => c.passed);
  const badChecks = checks.filter((c) => !c.passed);
  const qualityScore = checks.reduce((sum, c) => sum + c.weight, 0);

  // Generate finding based on overall quality
  if (badChecks.length === 0 && goodChecks.length > 0) {
    // Excellent post-mix behavior
    const bonus = Math.min(25, Math.max(15, qualityScore));
    findings.push({
      id: "chain-coinjoin-quality",
      severity: "good",
      title: "Excellent post-CoinJoin spending behavior",
      description:
        "The CoinJoin privacy benefit is well-preserved in this transaction. " +
        goodChecks.map((c) => c.description).join(". ") + ".",
      recommendation:
        "Continue this exemplary post-mix spending pattern. Each transaction " +
        "should spend a single CoinJoin UTXO to a fresh address.",
      scoreImpact: bonus,
      params: {
        qualityScore,
        goodCount: goodChecks.length,
        badCount: 0,
        _variant: "good",
      },
      confidence: "high",
    });
  } else if (badChecks.length > 0) {
    // Bad post-mix behavior - CoinJoin benefit reduced or negated
    const penalty = Math.max(-20, Math.min(0, qualityScore));
    const allBad = goodChecks.length === 0;
    findings.push({
      id: "chain-coinjoin-quality",
      severity: allBad ? "critical" : "high",
      title: allBad
        ? "CoinJoin benefit completely negated by poor spending"
        : "CoinJoin benefit partially undermined by spending behavior",
      description:
        "Post-CoinJoin spending mistakes reduce or eliminate the privacy gained from mixing. " +
        "Issues detected: " + badChecks.map((c) => c.description).join("; ") + ".",
      recommendation:
        "After CoinJoin, spend each UTXO individually in separate transactions to fresh " +
        "addresses. Wait at least 6 blocks before spending. Never consolidate post-mix " +
        "UTXOs or mix them with non-CoinJoin funds.",
      scoreImpact: penalty,
      params: {
        qualityScore,
        goodCount: goodChecks.length,
        badCount: badChecks.length,
        _variant: allBad ? "critical" : "bad",
      },
      confidence: "high",
    });
  }

  return {
    findings,
    qualityScore,
    goodBehaviors: goodChecks.map((c) => c.description),
    badBehaviors: badChecks.map((c) => c.description),
  };
}

/**
 * Check if multiple CoinJoin inputs came from the same CoinJoin transaction.
 * This is the worst case - consolidating outputs from the same mix.
 */
function checkSameCoinJoinParent(
  tx: MempoolTransaction,
  coinJoinInputIndices: number[],
): boolean {
  if (coinJoinInputIndices.length < 2) return false;

  const parentTxids = coinJoinInputIndices.map((idx) => tx.vin[idx]?.txid).filter(Boolean);
  const uniqueParents = new Set(parentTxids);

  // If all CoinJoin inputs come from the same parent, it's consolidation
  return uniqueParents.size === 1 && parentTxids.length >= 2;
}
