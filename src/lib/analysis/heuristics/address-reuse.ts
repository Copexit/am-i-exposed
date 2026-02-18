import type { AddressHeuristic } from "./types";

/**
 * H8: Address Reuse Detection
 *
 * The single biggest privacy failure in Bitcoin. When an address receives
 * funds more than once, all transactions become trivially linkable.
 *
 * Impact: -20 to -70
 */
export const analyzeAddressReuse: AddressHeuristic = (address) => {
  const { chain_stats, mempool_stats } = address;
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

  // Severity scales with reuse count - extreme reuse gets extreme penalties
  let impact: number;
  let severity: "critical" | "high" | "medium";

  if (totalFunded >= 1000) {
    impact = -70;
    severity = "critical";
  } else if (totalFunded >= 100) {
    impact = -55;
    severity = "critical";
  } else if (totalFunded >= 50) {
    impact = -45;
    severity = "critical";
  } else if (totalFunded >= 10) {
    impact = -35;
    severity = "critical";
  } else if (totalFunded >= 5) {
    impact = -28;
    severity = "critical";
  } else if (totalFunded >= 3) {
    impact = -22;
    severity = "high";
  } else {
    impact = -20;
    severity = "high";
  }

  return {
    findings: [
      {
        id: "h8-address-reuse",
        severity,
        title: `Address reused ${totalFunded} times`,
        description:
          `This address has received funds ${totalFunded} times. Every transaction to and from this address is now trivially linkable by chain analysis. ` +
          `Address reuse is the single most damaging privacy practice in Bitcoin.`,
        recommendation:
          "Use a wallet that generates a new address for every receive (HD wallets). Never share the same address twice. Consider consolidating funds to a new address via CoinJoin.",
        scoreImpact: impact,
        remediation: {
          steps: [
            "Stop using this address immediately — do not share it again for any future receives.",
            "Generate a fresh receive address in your wallet (HD wallets do this automatically).",
            "Move remaining funds from this address through a CoinJoin to break the link to your transaction history.",
            "If CoinJoin is not an option, send funds to a new wallet through an intermediate address with a time delay.",
          ],
          tools: [
            { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
            { name: "Wasabi Wallet", url: "https://wasabiwallet.io" },
          ],
          urgency: totalFunded >= 10 ? "immediate" : "soon",
        },
      },
    ],
  };
};
