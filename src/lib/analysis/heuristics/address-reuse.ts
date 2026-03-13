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
 * Impact: -70 to -93
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
    // Safety check: romanz/electrs (Umbrel) reports funded_txo_count=0 even
    // for reused addresses. If the backend reports 0 but there are multiple txs,
    // flag as uncertain. When totalFunded >= 1 the API is working correctly
    // and we trust it (extra txs are just spends, not additional receives).
    if (totalFunded === 0 && txCount > 2) {
      return {
        findings: [
          {
            id: "h8-reuse-uncertain",
            severity: "low",
            confidence: "low",
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
          confidence: "deterministic",
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
          confidence: "deterministic",
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
    impact = -93;
    severity = "critical";
  } else if (effectiveTxCount >= 100) {
    impact = -92;
    severity = "critical";
  } else if (effectiveTxCount >= 50) {
    impact = -90;
    severity = "critical";
  } else if (effectiveTxCount >= 10) {
    impact = -88;
    severity = "critical";
  } else if (effectiveTxCount >= 5) {
    impact = -84;
    severity = "critical";
  } else if (effectiveTxCount >= 3) {
    impact = -78;
    severity = "critical";
  } else {
    // First reuse (2 txs) - already catastrophic
    impact = -70;
    severity = "critical";
  }

  return {
    findings: [
      {
        id: "h8-address-reuse",
        severity,
        confidence: "deterministic",
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
          qualifier: "If you are the owner of this address:",
          steps: [
            "Stop using this address immediately - do not share it again for any future receives.",
            "Generate a fresh receive address in your wallet (HD wallets do this automatically).",
            "Spend remaining UTXOs individually - do not consolidate them into one transaction, as that creates additional linkage.",
            "Existing transaction history on a reused address cannot be unlinked. For future privacy, use CoinJoin before spending to break forward-tracing - but note that some exchanges may flag CoinJoin deposits.",
          ],
          tools: [
            { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
            { name: "Wasabi Wallet", url: "https://wasabiwallet.io" },
          ],
          urgency: "immediate",
        },
      },
    ],
  };
};
