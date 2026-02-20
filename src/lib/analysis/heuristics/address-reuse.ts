import type { AddressHeuristic } from "./types";

/**
 * H8: Address Reuse Detection
 *
 * The single biggest privacy failure in Bitcoin. When an address receives
 * funds more than once, all transactions become trivially linkable.
 *
 * Gates on funded_txo_count (actual receive events) to confirm address
 * reuse, then scales severity using tx_count (total transaction involvement
 * including spends) for a broader picture of linkability exposure.
 *
 * Impact: -24 to -70
 */
export const analyzeAddressReuse: AddressHeuristic = (address) => {
  const { chain_stats, mempool_stats } = address;

  // tx_count = number of distinct transactions involving this address
  // This is more accurate than funded_txo_count which counts individual
  // UTXOs (a single batched withdrawal can create multiple UTXOs)
  const txCount = chain_stats.tx_count + mempool_stats.tx_count;

  // Also check funded_txo_count to confirm the address actually received
  // more than once (tx_count includes spends too)
  const totalFunded =
    chain_stats.funded_txo_count + mempool_stats.funded_txo_count;

  if (totalFunded <= 1) {
    return {
      findings: [
        {
          id: "h8-no-reuse",
          severity: "good",
          title: "No address reuse detected",
          description:
            "This address has only received funds once. Single-use addresses are a core Bitcoin privacy practice.",
          recommendation: "Keep using fresh addresses for every receive.",
          scoreImpact: 0,
        },
      ],
    };
  }

  // Batch payment edge case: an exchange may send multiple outputs to the
  // same address in a single transaction (funded_txo_count > 1 but tx_count <= 1).
  // This is not true address reuse since only one transaction is involved.
  if (txCount <= 1) {
    return {
      findings: [
        {
          id: "h8-batch-receive",
          severity: "low",
          title: `Multiple UTXOs from a single transaction (batch payment)`,
          params: { totalFunded },
          description:
            `This address received ${totalFunded} outputs in a single transaction, likely a batched payment. ` +
            "While this creates multiple UTXOs, it does not constitute address reuse since only one transaction is involved.",
          recommendation:
            "This is typically caused by exchange batched withdrawals. Use a fresh address for the next receive.",
          scoreImpact: 0,
        },
      ],
    };
  }

  // Use tx_count for severity scaling (more accurate than funded_txo_count)
  let impact: number;
  let severity: "critical" | "high" | "medium";

  if (txCount >= 1000) {
    impact = -70;
    severity = "critical";
  } else if (txCount >= 100) {
    impact = -65;
    severity = "critical";
  } else if (txCount >= 50) {
    impact = -58;
    severity = "critical";
  } else if (txCount >= 10) {
    impact = -50;
    severity = "critical";
  } else if (txCount >= 5) {
    impact = -45;
    severity = "critical";
  } else if (txCount >= 3) {
    impact = -32;
    severity = "critical";
  } else {
    impact = -24;
    severity = "high";
  }

  return {
    findings: [
      {
        id: "h8-address-reuse",
        severity,
        title: `Address reused across ${txCount} transactions`,
        params: { txCount },
        description:
          `This address appears in ${txCount} transactions. Every transaction to and from this address is now trivially linkable by chain analysis. ` +
          `Address reuse is the single most damaging privacy practice in Bitcoin.`,
        recommendation:
          "Use a wallet that generates a new address for every receive (HD wallets). Never share the same address twice. Consider consolidating funds to a new address via CoinJoin.",
        scoreImpact: impact,
        remediation: {
          steps: [
            "Stop using this address immediately - do not share it again for any future receives.",
            "Generate a fresh receive address in your wallet (HD wallets do this automatically).",
            "Move remaining funds from this address through a CoinJoin to break the link to your transaction history.",
            "If CoinJoin is not an option, send funds to a new wallet through an intermediate address with a time delay.",
          ],
          tools: [
            { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
            { name: "Wasabi Wallet", url: "https://wasabiwallet.io" },
          ],
          urgency: txCount >= 10 ? "immediate" : "soon",
        },
      },
    ],
  };
};
