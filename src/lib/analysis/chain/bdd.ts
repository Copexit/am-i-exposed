import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";

/**
 * Bitcoin Days Destroyed (BDD)
 *
 * BDD = sum(input_value * days_since_input_was_last_moved)
 *
 * High BDD: long-held coins being moved (whale alert, significant event)
 * Low BDD: recently received coins being spent (routine, less interesting)
 *
 * This is informational - it helps users understand how "significant" their
 * transaction appears to chain analysts. Chain analysis firms prioritize
 * high-BDD transactions for manual review.
 *
 * Requires parent tx confirmation times to calculate days held.
 */

export interface BddResult {
  /** Total Bitcoin Days Destroyed */
  totalBdd: number;
  /** Per-input breakdown */
  inputBreakdown: Array<{
    index: number;
    value: number;
    daysHeld: number;
    bdd: number;
  }>;
  findings: Finding[];
}

/**
 * Calculate BDD for a transaction.
 *
 * Uses the current tx's block_time and each input's parent tx block_time
 * to determine days held. For inputs without parent tx data, skips them.
 */
export function calculateBdd(
  tx: MempoolTransaction,
  parentTxs?: Map<string, MempoolTransaction>,
): BddResult {
  const findings: Finding[] = [];
  const breakdown: BddResult["inputBreakdown"] = [];

  if (!tx.status.confirmed || !tx.status.block_time) {
    return { totalBdd: 0, inputBreakdown: [], findings };
  }

  const txTime = tx.status.block_time;
  let totalBdd = 0;
  let inputsWithData = 0;

  for (let i = 0; i < tx.vin.length; i++) {
    const vin = tx.vin[i];
    if (vin.is_coinbase || !vin.prevout) continue;

    const parentTx = parentTxs?.get(vin.txid);
    if (!parentTx?.status.confirmed || !parentTx.status.block_time) continue;

    const parentTime = parentTx.status.block_time;
    const daysHeld = Math.max(0, (txTime - parentTime) / 86400);
    const valueBtc = vin.prevout.value / 1e8;
    const bdd = valueBtc * daysHeld;

    breakdown.push({
      index: i,
      value: vin.prevout.value,
      daysHeld: Math.round(daysHeld),
      bdd: Math.round(bdd * 100) / 100,
    });

    totalBdd += bdd;
    inputsWithData++;
  }

  if (inputsWithData === 0) {
    return { totalBdd: 0, inputBreakdown: [], findings };
  }

  totalBdd = Math.round(totalBdd * 100) / 100;

  // Generate finding based on BDD significance
  if (totalBdd >= 1000) {
    findings.push({
      id: "bdd-very-high",
      severity: "medium",
      confidence: "deterministic",
      title: `Very high Bitcoin Days Destroyed: ${totalBdd.toLocaleString()} BDD`,
      description:
        `This transaction destroys ${totalBdd.toLocaleString()} Bitcoin Days. ` +
        "This indicates long-held coins are being moved, which is a significant on-chain " +
        "event. Chain analysis firms and whale-watching services flag high-BDD transactions " +
        "for manual review, making this transaction more likely to attract attention.",
      recommendation:
        "High-BDD transactions are automatically flagged by chain surveillance services. " +
        "Consider breaking up the movement across multiple transactions and time periods. " +
        "Using CoinJoin before moving long-held UTXOs adds a privacy layer.",
      scoreImpact: -2,
      params: { bdd: totalBdd, inputsAnalyzed: inputsWithData },
    });
  } else if (totalBdd >= 100) {
    findings.push({
      id: "bdd-high",
      severity: "low",
      confidence: "deterministic",
      title: `High Bitcoin Days Destroyed: ${totalBdd.toLocaleString()} BDD`,
      description:
        `This transaction destroys ${totalBdd.toLocaleString()} Bitcoin Days, ` +
        "indicating coins held for a notable period are being moved. This moderate BDD " +
        "may appear on chain analysis dashboards that monitor coin age distribution.",
      recommendation:
        "Consider the timing and context of moving aged coins. Spacing movements " +
        "across time reduces the BDD signal of any single transaction.",
      scoreImpact: -1,
      params: { bdd: totalBdd, inputsAnalyzed: inputsWithData },
    });
  } else {
    findings.push({
      id: "bdd-low",
      severity: "good",
      confidence: "deterministic",
      title: `Low Bitcoin Days Destroyed: ${totalBdd.toLocaleString()} BDD`,
      description:
        `This transaction destroys only ${totalBdd.toLocaleString()} Bitcoin Days, ` +
        "indicating recently received coins are being spent. Low-BDD transactions are " +
        "routine and attract less attention from chain surveillance.",
      recommendation:
        "Low BDD is good for privacy - routine transactions blend in with normal network activity.",
      scoreImpact: 0,
      params: { bdd: totalBdd, inputsAnalyzed: inputsWithData },
    });
  }

  return { totalBdd, inputBreakdown: breakdown, findings };
}
