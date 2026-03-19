import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";
import { getAddressedOutputs, isCoinbase } from "./tx-utils";

/**
 * Peel Chain Detection
 *
 * Detects the linear chain pattern where a transaction has 1 input and
 * 2 outputs, and one output becomes the single input of the next tx,
 * repeated across multiple hops.
 *
 * In a peel chain the smaller output is typically the payment and the
 * larger output is change fed forward - making every payment trivially
 * traceable.
 *
 * Uses pre-fetched parent and child transactions from TxContext to
 * check 1 hop backward and 1 hop forward (up to 3 consecutive hops).
 *
 * Severity:
 *   - 2 hops: high (-15)
 *   - 3+ hops: critical (-20, chain likely extends further)
 *
 * Reference: Blockchair Privacy-o-meter, Meiklejohn et al. 2013
 */

/** Check if a transaction has the classic peel shape: 1 input, 2 spendable outputs. */
function isPeelShape(tx: MempoolTransaction): boolean {
  if (tx.vin.length !== 1 || isCoinbase(tx)) return false;
  return getAddressedOutputs(tx.vout).length === 2;
}

export const analyzePeelChain: TxHeuristic = (tx, _rawHex?, ctx?) => {
  const findings: Finding[] = [];

  // Current tx must have the peel shape
  if (!isPeelShape(tx)) return { findings };

  let backwardHops = 0;
  let forwardHops = 0;

  // Check backward: is the parent tx also peel-shaped and linked to us?
  const parentTx = ctx?.parentTx;
  if (parentTx && isPeelShape(parentTx) && parentTx.txid === tx.vin[0].txid) {
    backwardHops = 1;
  }

  // Check forward: is the child tx also peel-shaped and fed by one of our outputs?
  const childTx = ctx?.childTx;
  if (childTx && isPeelShape(childTx) && childTx.vin[0].txid === tx.txid) {
    forwardHops = 1;
  }

  const chainDepth = 1 + backwardHops + forwardHops;

  // Need at least 2 consecutive peel-shaped txs to flag
  if (chainDepth < 2) return { findings };

  const severity = chainDepth >= 3 ? "critical" as const : "high" as const;
  const confidence = chainDepth >= 3 ? "high" as const : "medium" as const;
  const impact = chainDepth >= 3 ? -20 : -15;

  findings.push({
    id: "peel-chain",
    severity,
    confidence,
    title: `Peel chain detected (${chainDepth}+ consecutive hops)`,
    params: { chainDepth, backwardHops, forwardHops },
    description:
      `This transaction is part of a peel chain - a sequence of ${chainDepth}+ transactions ` +
      "each with 1 input and 2 outputs, where one output feeds the next transaction as its sole input. " +
      "The smaller output at each hop is typically the payment, making the entire payment history " +
      "trivially traceable by following the chain.",
    recommendation:
      "Break the linear chain by using CoinJoin between payments. " +
      "Batch multiple payments into a single transaction, or use PayJoin to add " +
      "inputs from the recipient and destroy the peel pattern.",
    scoreImpact: impact,
    remediation: {
      steps: [
        "Stop the chain: run your remaining balance through a CoinJoin before making more payments.",
        "Use coin control to spend from different UTXOs rather than always spending the change from the last transaction.",
        "Consider PayJoin for future payments - it adds recipient inputs, breaking the 1-in-2-out pattern.",
        "Batch multiple payments into a single transaction to avoid the linear hop pattern.",
      ],
      tools: [
        { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
        { name: "Ashigaru (Whirlpool)", url: "https://ashigaru.rs" },
        { name: "Bull Bitcoin (PayJoin V2)", url: "https://www.bullbitcoin.com" },
      ],
      urgency: "when-convenient",
    },
  });

  return { findings };
};
