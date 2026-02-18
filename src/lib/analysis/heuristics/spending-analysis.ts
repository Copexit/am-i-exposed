import type { AddressHeuristic } from "./types";
import type { Finding } from "@/lib/types";

/**
 * Spending Pattern Analysis (Address-level)
 *
 * Analyzes the spending behavior of an address:
 * - Unspent vs spent ratio
 * - Total transaction volume
 * - Spending patterns that reveal usage type
 *
 * Impact: -3 to +2 (informational)
 */
export const analyzeSpendingPattern: AddressHeuristic = (address, _utxos, txs) => {
  const findings: Finding[] = [];
  const { chain_stats } = address;

  const totalTxs = chain_stats.tx_count;
  const spentCount = chain_stats.spent_txo_count;
  const fundedCount = chain_stats.funded_txo_count;

  // High volume address
  if (totalTxs >= 100) {
    findings.push({
      id: "spending-high-volume",
      severity: "medium",
      title: `High transaction volume (${totalTxs.toLocaleString()} transactions)`,
      description:
        `This address has been involved in ${totalTxs.toLocaleString()} transactions. ` +
        "High-volume addresses are more likely to be monitored by chain analysis firms " +
        "and may be associated with services, exchanges, or businesses.",
      recommendation:
        "Use HD wallets to spread activity across many addresses. Avoid concentrating activity on a single address.",
      scoreImpact: -3,
    });
  }

  // Never spent (cold storage pattern)
  if (spentCount === 0 && fundedCount > 0) {
    findings.push({
      id: "spending-never-spent",
      severity: "good",
      title: "Address has never spent (cold storage)",
      description:
        "This address has received funds but never spent them. " +
        "This is characteristic of cold storage, which is good for security. " +
        "Since no spend transactions exist, no on-chain spending patterns can be analyzed.",
      recommendation:
        "When you do spend from this address, use coin control and consider CoinJoin.",
      scoreImpact: 2,
    });
  }

  // Mixed receive/send with transaction history to analyze
  if (txs.length > 0 && spentCount > 0) {
    // Check if the address mixes with many different counterparties
    const counterparties = new Set<string>();
    for (const tx of txs) {
      for (const vout of tx.vout) {
        if (
          vout.scriptpubkey_address &&
          vout.scriptpubkey_address !== address.address
        ) {
          counterparties.add(vout.scriptpubkey_address);
        }
      }
    }

    if (counterparties.size >= 20) {
      findings.push({
        id: "spending-many-counterparties",
        severity: "medium",
        title: `Transacted with ${counterparties.size}+ counterparties`,
        description:
          `This address has sent or received funds involving ${counterparties.size}+ different addresses. ` +
          "A large number of counterparties creates a wide exposure surface " +
          "and makes the address easier to cluster with other known entities.",
        recommendation:
          "Use separate addresses for different transaction partners. HD wallets do this automatically.",
        scoreImpact: -2,
      });
    }
  }

  return { findings };
};
