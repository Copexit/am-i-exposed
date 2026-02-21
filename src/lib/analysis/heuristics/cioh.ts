import type { TxHeuristic } from "./types";

/**
 * H3: Common Input Ownership Heuristic (CIOH)
 *
 * The foundational clustering heuristic: if a transaction has multiple inputs,
 * they are assumed to be controlled by the same entity. This is the primary
 * technique used by chain analysis firms to cluster addresses.
 *
 * Exception: CoinJoin and PayJoin transactions intentionally violate this.
 *
 * References:
 * - Nakamoto, 2008 (Section 10)
 * - Meiklejohn et al., 2013
 *
 * Impact: -3 to -45
 */
export const analyzeCioh: TxHeuristic = (tx) => {
  const uniqueInputAddresses = new Set<string>();

  for (const vin of tx.vin) {
    if (vin.is_coinbase) continue;
    if (vin.prevout?.scriptpubkey_address) {
      uniqueInputAddresses.add(vin.prevout.scriptpubkey_address);
    }
  }

  // Single input or coinbase - no CIOH concern
  if (uniqueInputAddresses.size <= 1) {
    return {
      findings: [
        {
          id: "h3-single-input",
          severity: "good",
          title: "Single input address",
          description:
            "This transaction uses a single input address, so the common-input-ownership heuristic does not apply. No address clustering is possible from inputs alone.",
          recommendation: "Keep using single-input transactions when possible.",
          scoreImpact: 0,
        },
      ],
    };
  }

  const count = uniqueInputAddresses.size;
  // Tiered scaling: larger consolidations are exponentially worse for privacy
  let impact: number;
  if (count >= 50) impact = 45;
  else if (count >= 20) impact = 35;
  else if (count >= 10) impact = 25;
  else if (count >= 5) impact = 15;
  else impact = count * 3;

  return {
    findings: [
      {
        id: "h3-cioh",
        severity: impact >= 25 ? "critical" : impact >= 12 ? "high" : "medium",
        title: `${count} input addresses linked by CIOH`,
        params: { count },
        description:
          `This transaction combines inputs from ${count} different addresses. ` +
          `Chain analysis firms will assume these ${count} addresses belong to the same entity. ` +
          `This assumption is probabilistic but widely applied in commercial chain surveillance.`,
        recommendation:
          "Use coin control to avoid combining UTXOs from different addresses. If consolidation is necessary, use CoinJoin first to break the link between source addresses.",
        scoreImpact: -impact,
        remediation: {
          steps: [
            "Use coin control in your wallet to select specific UTXOs for each transaction - never auto-select.",
            "Avoid multi-input transactions unless all inputs are from the same address or have been through a CoinJoin.",
            "If you need to consolidate UTXOs, run them through a CoinJoin first to break the ownership link.",
            "For future transactions, use a wallet that supports strict coin control and labels.",
          ],
          tools: [
            { name: "Sparrow Wallet (Coin Control)", url: "https://sparrowwallet.com" },
            { name: "Wasabi Wallet (CoinJoin)", url: "https://wasabiwallet.io" },
          ],
          urgency: count >= 5 ? "soon" : "when-convenient",
        },
      },
    ],
  };
};
