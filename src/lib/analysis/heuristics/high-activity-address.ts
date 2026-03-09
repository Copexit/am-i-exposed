import type { AddressHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { fmtN } from "@/lib/format";

/**
 * High Transaction Count Address Detection
 *
 * For address-level analysis, checks if the address has an unusually high
 * transaction count indicating it is likely an exchange or service address.
 * Hundreds or thousands of transactions to a single address reveal a
 * centralized entity and severely compromise the privacy of all senders.
 *
 * Impact: -3 to -8
 */
export const analyzeHighActivityAddress: AddressHeuristic = (address) => {
  const findings: Finding[] = [];

  const totalTxCount =
    address.chain_stats.tx_count + address.mempool_stats.tx_count;
  const timesReceived =
    address.chain_stats.funded_txo_count + address.mempool_stats.funded_txo_count;

  if (totalTxCount >= 1000) {
    findings.push({
      id: "high-activity-exchange",
      severity: "critical",
      confidence: "high",
      title: `Extremely high activity address (${fmtN(totalTxCount)} transactions)`,
      description:
        `This address has ${fmtN(totalTxCount)} transactions and has received ` +
        `funds ${fmtN(timesReceived)} times. This volume is consistent with ` +
        "a centralized exchange deposit address, payment processor, or major service. " +
        "All senders to this address are trivially linkable to the same entity.",
      recommendation:
        "Never reuse deposit addresses. If this is a service address, request a fresh " +
        "address for each transaction. If you sent funds here, assume the service " +
        "knows your identity and can link your transaction to your account.",
      scoreImpact: -8,
      params: { txCount: totalTxCount, timesReceived },
    });
  } else if (totalTxCount >= 100) {
    findings.push({
      id: "high-activity-service",
      severity: "high",
      confidence: "high",
      title: `High activity address (${fmtN(totalTxCount)} transactions)`,
      description:
        `This address has ${fmtN(totalTxCount)} transactions and has received ` +
        `funds ${fmtN(timesReceived)} times. This level of activity suggests ` +
        "a service, merchant, or frequently-used deposit address. " +
        "Multiple senders to this address can be linked to the same entity.",
      recommendation:
        "Addresses with high transaction counts are likely services or exchanges. " +
        "Request a fresh address for each payment to avoid linking your transaction " +
        "to other senders.",
      scoreImpact: -5,
      params: { txCount: totalTxCount, timesReceived },
    });
  } else if (totalTxCount >= 20) {
    findings.push({
      id: "high-activity-moderate",
      severity: "medium",
      confidence: "medium",
      title: `Moderate activity address (${totalTxCount} transactions)`,
      description:
        `This address has ${totalTxCount} transactions. While not necessarily an ` +
        "exchange or service, this level of reuse reduces privacy for all parties " +
        "who have transacted with this address.",
      recommendation:
        "For better privacy, use a new address for each transaction. HD wallets " +
        "generate fresh addresses automatically.",
      scoreImpact: -3,
      params: { txCount: totalTxCount, timesReceived },
    });
  }

  return { findings };
};
