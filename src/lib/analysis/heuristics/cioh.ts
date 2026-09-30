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
  let nonCoinbaseCount = 0;

  for (const vin of tx.vin) {
    if (vin.is_coinbase) continue;
    nonCoinbaseCount++;
    if (vin.prevout?.scriptpubkey_address) {
      uniqueInputAddresses.add(vin.prevout.scriptpubkey_address);
    }
  }

  // Coinbase transaction - CIOH is not applicable
  if (nonCoinbaseCount === 0) {
    return { findings: [] };
  }

  // All prevouts missing (self-hosted backend without prevout data) - cannot evaluate CIOH
  if (uniqueInputAddresses.size === 0 && nonCoinbaseCount > 0) {
    return { findings: [] };
  }

  // Multiple inputs from one address: not CIOH, but the tx itself proves reuse
  // when those inputs were received in different transactions.
  if (uniqueInputAddresses.size === 1 && nonCoinbaseCount > 1) {
    const parentCount = new Set(tx.vin.filter((v) => !v.is_coinbase).map((v) => v.txid)).size;

    // All inputs come from one parent tx (e.g. an exchange batch withdrawal
    // paying the same address twice): mirrors h8-batch-receive, not reuse.
    if (parentCount <= 1) {
      return {
        findings: [
          {
            id: "h3-batch-receive-spend",
            severity: "low",
            confidence: "deterministic",
            title: "Inputs from a single batch receive",
            params: { inputCount: nonCoinbaseCount },
            description:
              `This transaction spends ${nonCoinbaseCount} outputs that one address received in a single transaction (likely a batched payment). ` +
              "This is not address reuse, and no additional addresses are clustered.",
            recommendation: "Use a fresh address for every receive so each payment lands on its own address.",
            scoreImpact: 0,
          },
        ],
      };
    }

    const impact = parentCount >= 5 ? 30 : 20;
    return {
      findings: [
        {
          id: "h3-input-reuse",
          severity: impact >= 30 ? "critical" : "high",
          confidence: "deterministic",
          title: `Inputs from one address reused across ${parentCount} receives`,
          params: { inputCount: nonCoinbaseCount, parentCount },
          description:
            `All ${nonCoinbaseCount} inputs of this transaction come from the same address, which received funds in ${parentCount} separate transactions. ` +
            "Address reuse publicly links every payment to that address, and spending them together confirms it on-chain.",
          recommendation:
            "Use a wallet that generates a new address for every receive. Never share the same address twice.",
          scoreImpact: -impact,
        },
      ],
    };
  }

  // Single input address - no CIOH concern
  if (uniqueInputAddresses.size <= 1) {
    return {
      findings: [
        {
          id: "h3-single-input",
          severity: "good",
          confidence: "deterministic",
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
  // Addresses funding 2+ inputs received in separate transactions prove
  // address reuse on-chain. Reported, not scored: CIOH already links those
  // inputs, so the reuse adds no link inside this transaction.
  const parentsByAddress = new Map<string, Set<string>>();
  const inputsByAddress = new Map<string, number>();
  for (const vin of tx.vin) {
    const addr = vin.prevout?.scriptpubkey_address;
    if (vin.is_coinbase || !addr) continue;
    const parents = parentsByAddress.get(addr) ?? new Set<string>();
    parents.add(vin.txid);
    parentsByAddress.set(addr, parents);
    inputsByAddress.set(addr, (inputsByAddress.get(addr) ?? 0) + 1);
  }
  const reusedCount = [...parentsByAddress.values()].filter((p) => p.size >= 2).length;

  // When inputs outnumber addresses, the title counts both so neither number
  // is read as the other (40b88e16: 5 inputs from 4 addresses).
  const repeated = [...inputsByAddress.values()].filter((n) => n >= 2);
  const inputCount = [...inputsByAddress.values()].reduce((a, b) => a + b, 0);
  const uses = repeated.length === 1 ? repeated[0]! : undefined;
  const repeatNote = uses !== undefined
    ? `1 ${reusedCount > 0 ? "reused " : ""}address funds ${uses} inputs`
    : `${repeated.length} addresses fund several inputs` + (reusedCount > 0 ? `, ${reusedCount} reused` : "");
  const title = repeated.length === 0
    ? `${count} input addresses clustered via CIOH`
    : `${inputCount} inputs from ${count} addresses linked by CIOH (${repeatNote})`;
  const params: Record<string, string | number> = repeated.length === 0 ? { count } : {
    count,
    inputCount,
    repeatedCount: repeated.length,
    ...(uses !== undefined ? { uses } : {}),
    ...(reusedCount > 0 ? { reusedCount } : {}),
    _variant: `${reusedCount > 0 ? "reuse" : "repeat"}_${uses !== undefined ? "one" : "many"}`,
  };

  // Tiered scaling: larger consolidations are worse for privacy
  let impact: number;
  if (count >= 50) impact = 45;
  else if (count >= 20) impact = 35;
  else if (count >= 10) impact = 25;
  else if (count >= 5) impact = 15;
  else impact = count * 3; // 2=6, 3=9, 4=12

  return {
    findings: [
      {
        id: "h3-cioh",
        severity: impact >= 25 ? "critical" : impact >= 12 ? "high" : "medium",
        confidence: "high",
        title,
        params,
        description:
          `This transaction combines inputs from ${count} different addresses. ` +
          `Chain analysis firms will assume these ${count} addresses belong to the same entity. ` +
          `This assumption is probabilistic but widely applied in commercial chain surveillance.` +
          (reusedCount > 0
            ? ` ${reusedCount} of these addresses fund several inputs received in separate transactions, ` +
              "which proves address reuse on-chain: every payment to that address is linked as well."
            : ""),
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
