import type { AddressHeuristic } from "./types";

/**
 * H8: Address Reuse Detection
 *
 * The single biggest privacy failure in Bitcoin. When an address receives
 * funds more than once, all transactions become trivially linkable.
 *
 * Primary signal: funded_txo_count from the address stats API.
 * Fallback: count transactions with outputs to this address from the fetched
 * tx list. This handles romanz/electrs (Umbrel) where funded_txo_count can
 * return 0 for addresses that have clearly been reused.
 *
 * Severity scales using tx_count (total transaction involvement including
 * spends) for a broader picture of linkability exposure.
 *
 * Impact: -24 to -70
 */
export const analyzeAddressReuse: AddressHeuristic = (address, _utxos, txs) => {
  const { chain_stats, mempool_stats } = address;

  // tx_count = number of distinct transactions involving this address
  // This is more accurate than funded_txo_count which counts individual
  // UTXOs (a single batched withdrawal can create multiple UTXOs)
  const txCount = chain_stats.tx_count + mempool_stats.tx_count;

  // Also check funded_txo_count to confirm the address actually received
  // more than once (tx_count includes spends too)
  const totalFunded =
    chain_stats.funded_txo_count + mempool_stats.funded_txo_count;

  // Fallback: count transactions that have at least one output to this address.
  // This works even when funded_txo_count is unreliable (romanz/electrs on Umbrel).
  const actualReceives = txs.filter((tx) =>
    tx.vout.some((v) => v.scriptpubkey_address === address.address),
  ).length;

  // Use the best available data for reuse detection
  const effectiveFunded = Math.max(totalFunded, actualReceives);

  if (effectiveFunded <= 1) {
    // Safety check: the backend may not report funded data correctly AND we
    // may not have all txs fetched. If tx_count indicates more activity than
    // what we can see, flag as uncertain.
    if ((totalFunded === 0 && txCount > 0) || txCount > 2) {
      return {
        findings: [
          {
            id: "h8-reuse-uncertain",
            severity: "low",
            title: "Address reuse data incomplete",
            params: { txCount, totalFunded },
            description:
              `This address has ${txCount} transactions but the receive count (${totalFunded}) appears incomplete. ` +
              "The API backend may not fully index funded outputs. Address reuse cannot be confirmed or ruled out.",
            recommendation:
              "Try analyzing this address using the public mempool.space API for more complete data.",
            scoreImpact: 0,
          },
        ],
      };
    }

    return {
      findings: [
        {
          id: "h8-no-reuse",
          severity: "good",
          title: "No address reuse detected",
          description:
            "This address has only received funds once. Single-use addresses are a core Bitcoin privacy practice.",
          recommendation: "Keep using fresh addresses for every receive.",
          scoreImpact: 3,
        },
      ],
    };
  }

  // Batch payment edge case: an exchange may send multiple outputs to the
  // same address in a single transaction (funded_txo_count > 1 but tx_count <= 1).
  // This is not true address reuse since only one transaction is involved.
  if (txCount <= 1 && actualReceives <= 1) {
    return {
      findings: [
        {
          id: "h8-batch-receive",
          severity: "low",
          title: `Multiple UTXOs from a single transaction (batch payment)`,
          params: { totalFunded: effectiveFunded },
          description:
            `This address received ${effectiveFunded} outputs in a single transaction, likely a batched payment. ` +
            "While this creates multiple UTXOs, it does not constitute address reuse since only one transaction is involved.",
          recommendation:
            "This is typically caused by exchange batched withdrawals. Use a fresh address for the next receive.",
          scoreImpact: 0,
        },
      ],
    };
  }

  // Use tx_count for severity scaling (more accurate than funded_txo_count).
  // When tx_count is low but actualReceives is high, use actualReceives instead.
  const effectiveTxCount = Math.max(txCount, actualReceives);

  let impact: number;
  let severity: "critical" | "high" | "medium";

  if (effectiveTxCount >= 1000) {
    impact = -70;
    severity = "critical";
  } else if (effectiveTxCount >= 100) {
    impact = -65;
    severity = "critical";
  } else if (effectiveTxCount >= 50) {
    impact = -58;
    severity = "critical";
  } else if (effectiveTxCount >= 10) {
    impact = -50;
    severity = "critical";
  } else if (effectiveTxCount >= 5) {
    impact = -45;
    severity = "critical";
  } else if (effectiveTxCount >= 3) {
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
        title: `Address reused across ${effectiveTxCount} transactions`,
        params: { txCount: effectiveTxCount },
        description:
          `This address appears in ${effectiveTxCount} transactions. Every transaction to and from this address is now trivially linkable by chain analysis. ` +
          `Address reuse is the single most damaging privacy practice in Bitcoin.`,
        recommendation:
          "Use a wallet that generates a new address for every receive (HD wallets). Never share the same address twice. " +
          "Send remaining funds to a new address using coin control. For stronger unlinking, use CoinJoin - but note that some exchanges may flag CoinJoin transactions.",
        scoreImpact: impact,
        remediation: {
          steps: [
            "Stop using this address immediately - do not share it again for any future receives.",
            "Generate a fresh receive address in your wallet (HD wallets do this automatically).",
            "Move remaining funds to a new address using coin control. When possible, spend exact amounts to avoid creating change outputs.",
            "For stronger unlinking, use CoinJoin to break the link to your transaction history - but note that some exchanges may flag CoinJoin deposits.",
          ],
          tools: [
            { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
            { name: "Wasabi Wallet", url: "https://wasabiwallet.io" },
          ],
          urgency: effectiveTxCount >= 10 ? "immediate" : "soon",
        },
      },
    ],
  };
};
