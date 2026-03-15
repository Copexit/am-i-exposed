import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { isCoinbase, getValuedOutputs } from "./tx-utils";
import { SATS_PER_BTC } from "@/lib/constants";

// Round fiat values people commonly send (same denominations for USD and EUR)
const ROUND_FIAT_VALUES = [
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
 * Impact: -8 to -20
 */
export const analyzeRoundAmounts: TxHeuristic = (tx, _rawHex?, ctx?) => {
  const findings: Finding[] = [];
  // Filter to spendable outputs (exclude OP_RETURN and other non-spendable)
  const outputs = getValuedOutputs(tx.vout);

  // Skip coinbase transactions (block reward amounts are protocol-defined)
  if (isCoinbase(tx)) return { findings };

  // Skip single-output transactions (no change to distinguish)
  if (outputs.length < 2) return { findings };

  let roundOutputCount = 0;

  for (const out of outputs) {
    if (isRoundAmount(out.value)) {
      roundOutputCount++;
    }
  }

  if (roundOutputCount > 0 && roundOutputCount < outputs.length) {
    // Some (but not all) outputs are round - strong change indicator
    const impact = Math.min(roundOutputCount * 8, 20);
    findings.push({
      id: "h1-round-amount",
      severity: impact >= 10 ? "medium" : "low",
      confidence: "high",
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
  } else if (roundOutputCount > 0 && roundOutputCount === outputs.length) {
    // All outputs are round - still leaks information (payment amount is
    // identifiable as one of the round values), but lower confidence since
    // CoinJoin or batch payments can also produce all-round outputs.
    findings.push({
      id: "h1-round-amount",
      severity: "low",
      confidence: "medium",
      title: "All outputs are round amounts",
      params: { count: roundOutputCount, total: outputs.length },
      description:
        `All ${outputs.length} outputs are round numbers. While this prevents using ` +
        `round amounts alone to distinguish payment from change, the payment amount is ` +
        `still identifiable as one of the round values.`,
      recommendation:
        "Avoid sending round BTC amounts. Even adding a few random sats helps obscure which output is the payment.",
      scoreImpact: -3,
    });
  }

  // Round fiat amount detection (USD + EUR, requires historical price)
  const tol = ctx?.isCustomApi ? ROUND_USD_TOLERANCE_SELF_HOSTED : ROUND_USD_TOLERANCE_DEFAULT;

  // Collect per-output fiat matches (deduplicate: each output counts once even if both USD and EUR match)
  const fiatMatchedIndices = new Set<number>();

  // USD detection
  const roundUsdOutputs: Array<{ index: number; usd: number }> = [];
  if (ctx?.usdPrice) {
    for (let i = 0; i < outputs.length; i++) {
      const usdMatch = getMatchingRoundUsd(outputs[i].value, ctx.usdPrice, tol);
      if (usdMatch !== null) {
        roundUsdOutputs.push({ index: i, usd: usdMatch });
        fiatMatchedIndices.add(i);
      }
    }
  }

  // EUR detection
  const roundEurOutputs: Array<{ index: number; eur: number }> = [];
  if (ctx?.eurPrice) {
    for (let i = 0; i < outputs.length; i++) {
      const eurMatch = getMatchingRoundEur(outputs[i].value, ctx.eurPrice, tol);
      if (eurMatch !== null) {
        roundEurOutputs.push({ index: i, eur: eurMatch });
        fiatMatchedIndices.add(i);
      }
    }
  }

  // Emit USD finding (only if some but not all outputs match)
  if (ctx?.usdPrice && roundUsdOutputs.length > 0 && roundUsdOutputs.length < outputs.length) {
    const impact = Math.min(roundUsdOutputs.length * 8, 20);
    const usdValues = roundUsdOutputs.map((o) => `$${o.usd.toLocaleString("en-US")}`).join(", ");
    findings.push({
      id: "h1-round-usd-amount",
      severity: impact >= 10 ? "medium" : "low",
      confidence: "high",
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

  // Emit EUR finding for outputs that matched EUR but NOT USD (avoid double-counting)
  if (ctx?.eurPrice) {
    const eurOnlyOutputs = roundEurOutputs.filter(
      (o) => !roundUsdOutputs.some((u) => u.index === o.index),
    );
    if (eurOnlyOutputs.length > 0 && fiatMatchedIndices.size < outputs.length) {
      const impact = Math.min(eurOnlyOutputs.length * 8, 20);
      const eurValues = eurOnlyOutputs.map((o) => `EUR${o.eur.toLocaleString("en-US")}`).join(", ");
      findings.push({
        id: "h1-round-eur-amount",
        severity: impact >= 10 ? "medium" : "low",
        confidence: "high",
        title: `${eurOnlyOutputs.length} round EUR amount output${eurOnlyOutputs.length > 1 ? "s" : ""} detected`,
        params: {
          count: eurOnlyOutputs.length,
          total: outputs.length,
          eurValues,
          eurPrice: Math.round(ctx.eurPrice),
        },
        description:
          `${eurOnlyOutputs.length} of ${outputs.length} outputs correspond to round EUR amounts (${eurValues}) ` +
          `at the BTC price when this transaction was confirmed (~EUR${Math.round(ctx.eurPrice).toLocaleString("en-US")}/BTC). ` +
          `People commonly send round fiat amounts, making these outputs likely payments and the rest change.`,
        recommendation:
          "Avoid sending exact euro amounts. When buying BTC, withdraw the full amount rather than a round fiat value. " +
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

/** Default tolerance for public mempool.space (high-quality price data). */
export const ROUND_USD_TOLERANCE_DEFAULT = 0.005; // 0.5%
/** Looser tolerance for self-hosted mempool instances whose historical price may differ slightly. */
export const ROUND_USD_TOLERANCE_SELF_HOSTED = 0.01; // 1%

/**
 * Check if a satoshi value corresponds to a round fiat amount at the given price.
 * Returns the matching round fiat value, or null if no match.
 *
 * @param tolerancePct - fractional tolerance (0.005 = 0.5%, 0.01 = 1%).
 *   Use the tighter default for public mempool.space and the looser value
 *   for self-hosted instances where historical prices may vary.
 */
export function getMatchingRoundFiat(
  sats: number,
  fiatPerBtc: number,
  tolerancePct: number = ROUND_USD_TOLERANCE_DEFAULT,
): number | null {
  const fiatValue = (sats / SATS_PER_BTC) * fiatPerBtc;
  for (const roundFiat of ROUND_FIAT_VALUES) {
    // Skip tiny amounts (< 5) - too common and noisy
    if (roundFiat < 5) continue;
    const tolerance = roundFiat * tolerancePct;
    if (Math.abs(fiatValue - roundFiat) <= tolerance) return roundFiat;
  }
  return null;
}

/** Check if a satoshi value corresponds to a round USD amount at the given price. */
export function getMatchingRoundUsd(
  sats: number,
  usdPerBtc: number,
  tolerancePct: number = ROUND_USD_TOLERANCE_DEFAULT,
): number | null {
  return getMatchingRoundFiat(sats, usdPerBtc, tolerancePct);
}

export function isRoundUsdAmount(
  sats: number,
  usdPerBtc: number,
  tolerancePct: number = ROUND_USD_TOLERANCE_DEFAULT,
): boolean {
  return getMatchingRoundFiat(sats, usdPerBtc, tolerancePct) !== null;
}

/** Check if a satoshi value corresponds to a round EUR amount at the given price. */
export function getMatchingRoundEur(
  sats: number,
  eurPerBtc: number,
  tolerancePct: number = ROUND_USD_TOLERANCE_DEFAULT,
): number | null {
  return getMatchingRoundFiat(sats, eurPerBtc, tolerancePct);
}

export function isRoundEurAmount(
  sats: number,
  eurPerBtc: number,
  tolerancePct: number = ROUND_USD_TOLERANCE_DEFAULT,
): boolean {
  return getMatchingRoundFiat(sats, eurPerBtc, tolerancePct) !== null;
}
