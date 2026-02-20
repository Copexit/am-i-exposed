import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";

/**
 * Timing Analysis
 *
 * Analyzes transaction timing patterns that may reveal information:
 * - Unconfirmed transactions: broadcast recency reveals IP correlation risk
 * - Confirmation time of day: off-hours vs business hours may reveal timezone
 * - Locktime-based timing: nLockTime set to a specific block height
 *
 * Impact: -2 to -3 (minor informational signal)
 */
export const analyzeTiming: TxHeuristic = (tx) => {
  const findings: Finding[] = [];
  const { status } = tx;

  if (!status.confirmed) {
    findings.push({
      id: "timing-unconfirmed",
      severity: "low",
      title: "Transaction is unconfirmed (mempool visible)",
      description:
        "This transaction has not yet been confirmed in a block. " +
        "Unconfirmed transactions are visible in the mempool, meaning anyone monitoring " +
        "the P2P network could have seen when your node broadcast it, potentially " +
        "correlating your IP address with this transaction.",
      recommendation:
        "When broadcasting sensitive transactions, use Tor to connect to the Bitcoin network. " +
        "Consider using a wallet that broadcasts via Tor by default (Sparrow, Wasabi).",
      scoreImpact: -2,
    });
  }

  // Check locktime for timing information
  if (tx.locktime > 0) {
    // Locktime as block height (< 500,000,000) vs UNIX timestamp
    if (tx.locktime >= 500_000_000) {
      // UNIX timestamp locktime - rare and reveals intended broadcast time
      const locktimeDate = new Date(tx.locktime * 1000);
      findings.push({
        id: "timing-locktime-timestamp",
        severity: "medium",
        title: `nLockTime set to timestamp (${locktimeDate.toISOString().slice(0, 10)})`,
        params: { date: locktimeDate.toISOString().slice(0, 10), locktime: tx.locktime },
        description:
          `This transaction uses nLockTime as a UNIX timestamp (${tx.locktime}), ` +
          "which is unusual. Most wallets use block-height-based locktime or 0. " +
          "Timestamp-based locktime can reveal the intended broadcast time and " +
          "narrow down when the transaction was created.",
        recommendation:
          "Use wallets that set nLockTime to the current block height (anti-fee-sniping) " +
          "rather than timestamps. Bitcoin Core and Sparrow do this by default.",
        scoreImpact: -3,
      });
    }
    // Block-height locktime close to confirmation height is normal (anti-fee-sniping)
    // Only flag if locktime is significantly different from block height
    else if (status.confirmed && status.block_height) {
      const diff = status.block_height - tx.locktime;
      // If locktime is more than 100 blocks before confirmation, it may be stale or intentional delay
      if (diff > 100) {
        findings.push({
          id: "timing-stale-locktime",
          severity: "low",
          title: `Transaction held for ~${diff} blocks before confirmation`,
          params: { diff, locktime: tx.locktime, blockHeight: status.block_height },
          description:
            `The nLockTime (${tx.locktime}) is ${diff} blocks before the confirmation height (${status.block_height}). ` +
            "This suggests the transaction was created well before it was broadcast, " +
            "or was deliberately delayed. This can reveal information about the sender's " +
            "transaction preparation patterns.",
          recommendation:
            "Broadcast transactions promptly after creation. Long delays between creation " +
            "and broadcast can be detected and may reveal transaction batching behavior.",
          scoreImpact: -1,
        });
      }
    }
  }

  return { findings };
};
