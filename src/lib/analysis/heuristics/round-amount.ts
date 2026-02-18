import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";

const SATS_PER_BTC = 100_000_000;

// Round BTC values (in sats) to check against
const ROUND_BTC_VALUES = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10,
].map((btc) => btc * SATS_PER_BTC);

// Round sat multiples
const ROUND_SAT_MULTIPLES = [1_000, 10_000, 100_000, 1_000_000, 10_000_000];

/**
 * H1: Round Amount Detection
 *
 * Round payment amounts reveal information because change outputs are
 * rarely round. When one output is a round number and the other is not,
 * the round output is almost certainly the payment.
 *
 * Impact: -5 to -15
 */
export const analyzeRoundAmounts: TxHeuristic = (tx) => {
  const findings: Finding[] = [];
  const outputs = tx.vout;

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
      description:
        `${roundOutputCount} of ${outputs.length} outputs are round numbers. ` +
        `Round payment amounts make it trivial to distinguish payments from change, ` +
        `revealing the exact amount sent and which output is change.`,
      recommendation:
        "Avoid sending round BTC amounts. Many wallets let you send exact sat amounts. Even adding a few random sats helps obscure the payment amount.",
      scoreImpact: -impact,
    });
  }

  return { findings };
};

function isRoundAmount(sats: number): boolean {
  // Check against known round BTC values
  if (ROUND_BTC_VALUES.includes(sats)) return true;

  // Check if divisible by round sat multiples
  for (const multiple of ROUND_SAT_MULTIPLES) {
    if (sats >= multiple && sats % multiple === 0) return true;
  }

  return false;
}
