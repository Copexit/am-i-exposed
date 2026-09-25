/**
 * Ricochet pattern detection for spending-pattern analysis.
 *
 * Detects post-CoinJoin hop chains (ricochet) and Ashigaru Ricochet
 * with fee-address fingerprint. Ricochet is a GOOD practice - it adds
 * transactional distance between a CoinJoin and the final destination,
 * defeating shallow chain analysis by exchanges.
 */

import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { isCoinJoinTx } from "../heuristics/coinjoin";
import { getSpendableOutputs } from "../heuristics/tx-utils";

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
  if (tx.vin.length !== 1 || tx.vin[0]?.is_coinbase) return null;

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
      ancestor.vin[0]?.is_coinbase
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
