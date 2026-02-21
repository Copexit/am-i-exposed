import type { AddressHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { analyzeCoinJoin } from "./coinjoin";
import { getAddressType } from "@/lib/bitcoin/address-type";

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
  const { chain_stats, mempool_stats } = address;

  const totalTxs = chain_stats.tx_count + mempool_stats.tx_count;
  const spentCount = chain_stats.spent_txo_count + mempool_stats.spent_txo_count;
  const fundedCount = chain_stats.funded_txo_count + mempool_stats.funded_txo_count;

  // High volume address
  if (totalTxs >= 100) {
    findings.push({
      id: "spending-high-volume",
      severity: "medium",
      title: `High transaction volume (${totalTxs.toLocaleString()} transactions)`,
      params: { totalTxs },
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
    // Count unique counterparties from transactions where this address is a sender.
    // Exclude likely change outputs to avoid inflating the count.
    const counterparties = new Set<string>();
    const senderAddrType = getAddressType(address.address);

    for (const tx of txs) {
      // Only count counterparties when this address is an input (sender)
      const isSender = tx.vin.some(
        (v) => v.prevout?.scriptpubkey_address === address.address,
      );
      if (!isSender) continue;

      // Skip CoinJoin transactions - their outputs are other participants,
      // not true counterparties. Counting them would penalize CoinJoin users.
      const cjResult = analyzeCoinJoin(tx);
      const isCoinJoin = cjResult.findings.some(
        (f) => (f.id === "h4-whirlpool" || f.id === "h4-coinjoin") && f.scoreImpact > 0,
      );
      if (isCoinJoin) continue;

      const spendableOutputs = tx.vout.filter(
        (v) =>
          v.scriptpubkey_type !== "op_return" &&
          v.scriptpubkey_address &&
          v.scriptpubkey_address !== address.address,
      );

      // For 2-spendable-output txs (typical send), exclude the likely change output.
      // Change usually matches the sender's address type.
      if (spendableOutputs.length === 1) {
        // Single non-self output: clear counterparty
        counterparties.add(spendableOutputs[0].scriptpubkey_address!);
      } else if (spendableOutputs.length === 2) {
        // Identify likely payment (non-change) by address type mismatch
        const type0 = getAddressType(spendableOutputs[0].scriptpubkey_address!);
        const type1 = getAddressType(spendableOutputs[1].scriptpubkey_address!);

        if (type0 === senderAddrType && type1 !== senderAddrType) {
          // Output 0 matches sender type (likely change), output 1 is the payment
          counterparties.add(spendableOutputs[1].scriptpubkey_address!);
        } else if (type1 === senderAddrType && type0 !== senderAddrType) {
          // Output 1 matches sender type (likely change), output 0 is the payment
          counterparties.add(spendableOutputs[0].scriptpubkey_address!);
        } else {
          // Same type or mixed - count both (can't reliably exclude change)
          for (const out of spendableOutputs) {
            counterparties.add(out.scriptpubkey_address!);
          }
        }
      } else {
        // 3+ outputs (batch payment) - count all
        for (const out of spendableOutputs) {
          counterparties.add(out.scriptpubkey_address!);
        }
      }
    }

    if (counterparties.size >= 20) {
      findings.push({
        id: "spending-many-counterparties",
        severity: "medium",
        title: `Transacted with ${counterparties.size}+ counterparties`,
        params: { counterpartyCount: counterparties.size },
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


