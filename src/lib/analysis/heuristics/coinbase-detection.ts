import type { TxHeuristic } from "./types";

/**
 * Coinbase Transaction Detection
 *
 * Detects block reward (coinbase) transactions. These are informational -
 * receiving a mining reward is not inherently bad for privacy, but the
 * output addresses are associated with a mining pool or solo miner,
 * which is public knowledge.
 *
 * Impact: 0 (neutral/informational)
 */
export const analyzeCoinbase: TxHeuristic = (tx) => {
  // A real coinbase tx always has exactly 1 input with is_coinbase set.
  // Multi-input txs with a coinbase flag on one input are malformed, not coinbase.
  if (tx.vin.length === 1 && tx.vin[0].is_coinbase) {
    return {
      findings: [
        {
          id: "coinbase-transaction",
          severity: "low",
          confidence: "deterministic",
          title: "Coinbase transaction (block reward)",
          description:
            "This is a coinbase transaction that creates new coins as a block reward. " +
            "The output addresses belong to a mining pool or solo miner. " +
            "Mining pools are publicly identifiable entities, and chain analysis firms routinely label their payout addresses. " +
            "This is not inherently a privacy concern, but it means the origin of these funds is publicly attributable.",
          recommendation:
            "No action needed. Mining payouts are a normal part of Bitcoin. " +
            "If you want to reduce linkability of mined coins, consider using CoinJoin before spending them.",
          scoreImpact: 0,
        },
      ],
    };
  }

  return { findings: [] };
};
