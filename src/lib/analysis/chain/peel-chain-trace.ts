import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";

/**
 * Multi-hop Peel Chain Tracing
 *
 * Follows the change output forward through successive transactions to build
 * a complete peel chain trace with amounts peeling off at each hop.
 *
 * A peel chain hop is: a tx with 2 significant outputs where the larger one
 * feeds the next transaction as the primary input, while the smaller one is
 * the "peeled" payment.
 *
 * This provides the data structure for visualization but does NOT perform
 * API calls - it operates on pre-fetched transaction data.
 */

export interface PeelChainHop {
  txid: string;
  /** Block height (null if unconfirmed) */
  blockHeight: number | null;
  /** Total input value (sats) */
  inputTotal: number;
  /** Payment output value (smaller, "peeled" off) */
  paymentValue: number;
  /** Change output value (larger, feeds next hop) */
  changeValue: number;
  /** Fee paid */
  fee: number;
  /** Whether the change address was reused */
  addressReused: boolean;
  /** Whether this hop broke the chain (CoinJoin, sweep, etc.) */
  chainBreak: boolean;
  /** Reason for chain break if applicable */
  breakReason?: string;
}

export interface PeelChainTrace {
  hops: PeelChainHop[];
  /** Total amount peeled off across all hops */
  totalPeeled: number;
  /** Remaining balance after last hop */
  remainingBalance: number;
  /** Whether the chain is still active (last output unspent) */
  active: boolean;
  findings: Finding[];
}

/**
 * Build a peel chain trace starting from a given transaction.
 *
 * @param startTx - The initial transaction in the chain
 * @param childTxMap - Map of txid -> child transaction (pre-fetched forward analysis data)
 * @param seenAddresses - Set of previously seen addresses (for reuse detection)
 * @param maxHops - Maximum number of hops to trace (default 20)
 */
export function tracePeelChain(
  startTx: MempoolTransaction,
  childTxMap: Map<string, MempoolTransaction>,
  seenAddresses?: Set<string>,
  maxHops = 20,
): PeelChainTrace {
  const findings: Finding[] = [];
  const hops: PeelChainHop[] = [];
  const addressHistory = seenAddresses ?? new Set<string>();

  let currentTx = startTx;
  let totalPeeled = 0;

  for (let hopIndex = 0; hopIndex < maxHops; hopIndex++) {
    const spendable = currentTx.vout.filter(
      (o) => o.scriptpubkey_type !== "op_return" && o.value > 0,
    );

    // Peel chain hops must have exactly 2 significant outputs
    if (spendable.length !== 2) break;

    // Identify payment (smaller) and change (larger)
    const sorted = [...spendable].sort((a, b) => a.value - b.value);
    const payment = sorted[0];
    const change = sorted[1];

    // Check if the ratio is sufficiently asymmetric
    // (payment should be < 50% of change for clear peel pattern)
    if (payment.value > change.value * 0.5) break;

    // Check for address reuse
    const changeAddr = change.scriptpubkey_address ?? "";
    const addressReused = changeAddr !== "" && addressHistory.has(changeAddr);
    if (changeAddr) addressHistory.add(changeAddr);

    const inputTotal = currentTx.vin.reduce(
      (s, v) => s + (v.prevout?.value ?? 0),
      0,
    );

    hops.push({
      txid: currentTx.txid,
      blockHeight: currentTx.status.block_height ?? null,
      inputTotal,
      paymentValue: payment.value,
      changeValue: change.value,
      fee: currentTx.fee,
      addressReused,
      chainBreak: false,
    });

    totalPeeled += payment.value;

    // Try to follow the change output to the next transaction.
    // The map is keyed by txid and may store any child. When the child
    // references the parent, verify it spends the change output specifically
    // (not the payment output) to avoid following the wrong branch.
    const nextTx = childTxMap.get(currentTx.txid);
    if (!nextTx) break;

    // If the child has a vin referencing this tx, verify it's the change output
    const parentRef = nextTx.vin.find((v) => v.txid === currentTx.txid);
    if (parentRef) {
      const changeVoutIdx = currentTx.vout.findIndex(
        (o) => o.value === change.value && o.scriptpubkey_type !== "op_return",
      );
      if (parentRef.vout !== changeVoutIdx) break;
    }

    // Check if the child tx is a CoinJoin (chain break)
    const isLargeCoinjoin =
      nextTx.vin.length >= 5 && nextTx.vout.length >= 5;
    if (isLargeCoinjoin) {
      hops[hops.length - 1].chainBreak = true;
      hops[hops.length - 1].breakReason = "CoinJoin";
      break;
    }

    // Check if the child tx is a sweep (1 in, 1 out - no change)
    const nextSpendable = nextTx.vout.filter(
      (o) => o.scriptpubkey_type !== "op_return" && o.value > 0,
    );
    if (nextTx.vin.length === 1 && nextSpendable.length === 1) {
      hops[hops.length - 1].chainBreak = true;
      hops[hops.length - 1].breakReason = "Sweep";
      break;
    }

    currentTx = nextTx;
  }

  const remainingBalance =
    hops.length > 0 ? hops[hops.length - 1].changeValue : 0;
  const active = hops.length > 0 && !hops[hops.length - 1].chainBreak;

  // Generate findings
  if (hops.length >= 4) {
    const reusedCount = hops.filter((h) => h.addressReused).length;
    const hasBreak = hops.some((h) => h.chainBreak);

    findings.push({
      id: "peel-chain-trace",
      severity: hops.length >= 6 ? "critical" : "high",
      confidence: "high",
      title: `Peel chain: ${hops.length} hops traced, ${totalPeeled.toLocaleString()} sats peeled`,
      description:
        `A peel chain of ${hops.length} hops was traced from this transaction. ` +
        `Total of ${totalPeeled.toLocaleString()} sats were "peeled off" as payments, ` +
        `leaving ${remainingBalance.toLocaleString()} sats remaining. ` +
        (reusedCount > 0
          ? `${reusedCount} hop(s) reused change addresses, further weakening privacy. `
          : "") +
        (hasBreak
          ? "The chain was broken by a CoinJoin or sweep transaction. "
          : "The chain appears to still be active. ") +
        "Peel chains are trivially traceable - every payment and the total spending pattern are visible.",
      recommendation:
        "Break peel chains by using CoinJoin before spending change. " +
        "Alternatively, use coin selection strategies that avoid creating sequential " +
        "change outputs (BnB for changeless transactions).",
      scoreImpact: -(2 + Math.min(hops.length, 8)),
      params: {
        hops: hops.length,
        totalPeeled,
        remainingBalance,
        reusedAddresses: reusedCount,
        hasBreak: hasBreak ? 1 : 0,
      },
    });
  } else if (hops.length >= 2) {
    findings.push({
      id: "peel-chain-trace-short",
      severity: "medium",
      confidence: "medium",
      title: `Short peel chain: ${hops.length} hops detected`,
      description:
        `A short peel chain of ${hops.length} hops was detected. While shorter chains ` +
        "are less revealing than long ones, the pattern of sequential spending with " +
        "asymmetric outputs is still identifiable.",
      recommendation:
        "Consider varying your spending patterns. Use different UTXO selection " +
        "strategies and avoid creating obvious change outputs.",
      scoreImpact: -2,
      params: { hops: hops.length, totalPeeled, remainingBalance },
    });
  }

  return { hops, totalPeeled, remainingBalance, active, findings };
}
