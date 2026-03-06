import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";

const SATS_PER_BTC = 100_000_000;

// Round USD values people commonly send
const ROUND_USD_VALUES = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000,
];

// Round BTC values (in sats) to check against
const ROUND_BTC_VALUES = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10,
].map((btc) => btc * SATS_PER_BTC);

// Round sat multiples (10k+ only; 1000 sats is too common to be a meaningful signal)
const ROUND_SAT_MULTIPLES = [10_000, 100_000, 1_000_000, 10_000_000];

/**
 * H1: Round Amount Detection
 *
 * Round payment amounts reveal information because change outputs are
 * rarely round. When one output is a round number and the other is not,
 * the round output is almost certainly the payment.
 *
 * Impact: -5 to -15
 */
export const analyzeRoundAmounts: TxHeuristic = (tx, _rawHex?, ctx?) => {
  const findings: Finding[] = [];
  // Filter to spendable outputs (exclude OP_RETURN and other non-spendable)
  const outputs = tx.vout.filter(
    (o) => o.scriptpubkey_type !== "op_return" && o.value > 0,
  );

  // Skip coinbase transactions (block reward amounts are protocol-defined)
  if (tx.vin.some((v) => v.is_coinbase)) return { findings };

  // Skip single-output transactions (no change to distinguish)
  if (outputs.length < 2) return { findings };

  let roundOutputCount = 0;

  for (const out of outputs) {
    if (isRoundAmount(out.value)) {
      roundOutputCount++;
    }
  }

  // Only flag if some (but not all) outputs are round.
  // If all outputs are round, this could be a CoinJoin or batched payment.
  if (roundOutputCount > 0 && roundOutputCount < outputs.length) {
    const impact = Math.min(roundOutputCount * 5, 15);
    findings.push({
      id: "h1-round-amount",
      severity: impact >= 10 ? "medium" : "low",
      title: `${roundOutputCount} round amount output${roundOutputCount > 1 ? "s" : ""} detected`,
      params: { count: roundOutputCount, total: outputs.length },
      description:
        `${roundOutputCount} of ${outputs.length} outputs are round numbers. ` +
        `Round payment amounts make it trivial to distinguish payments from change, ` +
        `revealing the exact amount sent and which output is change.`,
      recommendation:
        "Avoid sending round BTC amounts. Many wallets let you send exact sat amounts. Even adding a few random sats helps obscure the payment amount.",
      scoreImpact: -impact,
    });
  }

  // Round USD amount detection (requires historical price)
  if (ctx?.usdPrice) {
    const roundUsdOutputs: Array<{ index: number; usd: number }> = [];
    for (let i = 0; i < outputs.length; i++) {
      const usdMatch = getMatchingRoundUsd(outputs[i].value, ctx.usdPrice);
      if (usdMatch !== null) {
        roundUsdOutputs.push({ index: i, usd: usdMatch });
      }
    }

    // Only flag if some (but not all) outputs are round USD
    if (roundUsdOutputs.length > 0 && roundUsdOutputs.length < outputs.length) {
      const impact = Math.min(roundUsdOutputs.length * 5, 15);
      const usdValues = roundUsdOutputs.map((o) => `$${o.usd.toLocaleString("en-US")}`).join(", ");
      findings.push({
        id: "h1-round-usd-amount",
        severity: impact >= 10 ? "medium" : "low",
        title: `${roundUsdOutputs.length} round USD amount output${roundUsdOutputs.length > 1 ? "s" : ""} detected`,
        params: {
          count: roundUsdOutputs.length,
          total: outputs.length,
          usdValues,
          usdPrice: Math.round(ctx.usdPrice),
        },
        description:
          `${roundUsdOutputs.length} of ${outputs.length} outputs correspond to round USD amounts (${usdValues}) ` +
          `at the BTC price when this transaction was confirmed (~$${Math.round(ctx.usdPrice).toLocaleString("en-US")}/BTC). ` +
          `People commonly send round fiat amounts, making these outputs likely payments and the rest change.`,
        recommendation:
          "Avoid sending exact dollar amounts. When buying BTC, withdraw the full amount rather than a round fiat value. " +
          "Add a random offset to the payment amount to obscure fiat-denominated rounding.",
        scoreImpact: -impact,
      });
    }
  }

  return { findings };
};

export function isRoundAmount(sats: number): boolean {
  // Check against known round BTC values
  if (ROUND_BTC_VALUES.includes(sats)) return true;

  // Check if divisible by round sat multiples
  for (const multiple of ROUND_SAT_MULTIPLES) {
    if (sats >= multiple && sats % multiple === 0) return true;
  }

  return false;
}

/**
 * Check if a satoshi value corresponds to a round USD amount at the given price.
 * Returns the matching round USD value, or null if no match.
 * Allows 0.5% tolerance to account for fee adjustments and rounding.
 */
export function getMatchingRoundUsd(sats: number, usdPerBtc: number): number | null {
  const usdValue = (sats / SATS_PER_BTC) * usdPerBtc;
  for (const roundUsd of ROUND_USD_VALUES) {
    // Skip tiny amounts (< $5) - too common and noisy
    if (roundUsd < 5) continue;
    const tolerance = roundUsd * 0.005; // 0.5%
    if (Math.abs(usdValue - roundUsd) <= tolerance) return roundUsd;
  }
  return null;
}

export function isRoundUsdAmount(sats: number, usdPerBtc: number): boolean {
  return getMatchingRoundUsd(sats, usdPerBtc) !== null;
}
