import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";

// Whirlpool pool denominations (in sats)
const WHIRLPOOL_DENOMS = [
  50_000, // 0.0005 BTC
  100_000, // 0.001 BTC
  1_000_000, // 0.01 BTC
  5_000_000, // 0.05 BTC
  50_000_000, // 0.5 BTC (retired 2023)
];

/**
 * H4: CoinJoin Detection
 *
 * CoinJoins are the ONLY positive privacy signal. Detects:
 * - Whirlpool: exactly 5 equal outputs at known denominations
 * - Wasabi/generic: many equal outputs (3+) with possible coordinator fee
 * - Equal-output pattern: general collaborative transaction detection
 *
 * Impact: +15 to +30
 */
export const analyzeCoinJoin: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // Need at least 2 inputs and 2 outputs
  if (tx.vin.length < 2 || tx.vout.length < 2) return { findings };

  // Check for Whirlpool pattern first (most specific)
  // Filter to spendable outputs (exclude OP_RETURN) for pattern matching
  const spendableOutputs = tx.vout.filter((o) => o.scriptpubkey_type !== "op_return");
  const whirlpool = detectWhirlpool(spendableOutputs.map((o) => o.value));
  if (whirlpool) {
    findings.push({
      id: "h4-whirlpool",
      severity: "good",
      title: `Whirlpool CoinJoin detected (${formatBtc(whirlpool.denomination)} pool)`,
      params: { denom: formatBtc(whirlpool.denomination) },
      description:
        "This transaction matches the Whirlpool CoinJoin pattern: 5 equal outputs at a standard denomination. " +
        "Whirlpool provides strong forward-looking privacy by breaking deterministic transaction links.",
      recommendation:
        "Whirlpool is one of the strongest CoinJoin implementations. Make sure to also remix (multiple rounds) for maximum privacy.",
      scoreImpact: 30,
    });
    return { findings };
  }

  // Check for WabiSabi / Wasabi pattern (many inputs, many outputs)
  // WabiSabi rounds can have as few as ~10 participants
  // WabiSabi rounds typically have 50+ participants; use >= 20 to avoid
  // false positives from exchange batched withdrawals (commonly 15-30 outputs)
  const isWabiSabi = tx.vin.length >= 20 && tx.vout.length >= 20;

  // Check for generic equal-output CoinJoin
  const equalOutput = detectEqualOutputs(spendableOutputs.map((o) => o.value));

  // WabiSabi multi-tier detection: if the structure looks like WabiSabi (many in/out)
  // but no single denomination has 5+ outputs, check for multiple denomination groups
  if (!equalOutput && isWabiSabi) {
    const counts = new Map<number, number>();
    for (const o of tx.vout) {
      counts.set(o.value, (counts.get(o.value) ?? 0) + 1);
    }
    const groups = [...counts.entries()].filter(([, c]) => c >= 2);
    const totalEqual = groups.reduce((sum, [, c]) => sum + c, 0);

    if (totalEqual >= 10 && groups.length >= 3) {
      const impact = totalEqual >= 20 ? 25 : 20;
      findings.push({
        id: "h4-coinjoin",
        severity: "good",
        title: `WabiSabi CoinJoin: ${groups.length} denomination tiers, ${totalEqual} equal outputs across ${tx.vout.length} total`,
        params: { groups: groups.length, totalEqual, vout: tx.vout.length, vin: tx.vin.length, isWabiSabi: 1 },
        description:
          `This transaction has ${tx.vin.length} inputs and ${tx.vout.length} outputs with ${groups.length} groups of equal-value outputs, ` +
          "consistent with a WabiSabi (Wasabi Wallet 2.0) CoinJoin using multiple denomination tiers. " +
          "This pattern breaks the link between inputs and outputs, significantly improving privacy.",
        recommendation:
          "WabiSabi CoinJoins provide excellent privacy through large anonymity sets and multiple denomination tiers. Continue using CoinJoin for maximum privacy.",
        scoreImpact: impact,
      });
      return { findings };
    }
  }

  if (equalOutput) {
    const { count, denomination, total } = equalOutput;

    // Higher confidence with more equal outputs
    const impact = count >= 10 ? 25 : count >= 5 ? 20 : 15;

    const label = isWabiSabi
      ? `WabiSabi CoinJoin: ${count} equal outputs across ${total} total`
      : `Likely CoinJoin: ${count} equal outputs of ${formatBtc(denomination)}`;

    findings.push({
      id: "h4-coinjoin",
      severity: "good",
      title: label,
      params: { count, denomination: formatBtc(denomination), total, vin: tx.vin.length, isWabiSabi: isWabiSabi ? 1 : 0 },
      description:
        (isWabiSabi
          ? `This transaction has ${tx.vin.length} inputs and ${total} outputs, consistent with a WabiSabi (Wasabi Wallet 2.0) CoinJoin. `
          : "") +
        `${count} of ${total} outputs have the same value (${formatBtc(denomination)}). ` +
        "This pattern is characteristic of collaborative CoinJoin transactions that break the " +
        "link between inputs and outputs, significantly improving privacy.",
      recommendation:
        isWabiSabi
          ? "WabiSabi CoinJoins provide excellent privacy through large anonymity sets and multiple denomination tiers. Continue using CoinJoin for maximum privacy."
          : "CoinJoin is a strong privacy technique. For maximum benefit, ensure you are using a reputable CoinJoin coordinator and consider multiple rounds.",
      scoreImpact: impact,
    });
  }

  return { findings };
};

function detectWhirlpool(values: number[]): { denomination: number } | null {
  // Whirlpool: exactly 5 equal outputs at a known denomination
  // Whirlpool txs typically have 5-8 outputs (5 equal + optional coordinator fees)
  if (values.length < 5 || values.length > 8) return null;

  for (const denom of WHIRLPOOL_DENOMS) {
    const matchCount = values.filter((v) => v === denom).length;
    if (matchCount === 5) {
      return { denomination: denom };
    }
  }
  return null;
}

function detectEqualOutputs(
  values: number[],
): { count: number; denomination: number; total: number } | null {
  // Count occurrences of each output value
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  // Find the most common value with 5+ occurrences
  // (3 equal outputs is too weak - exchange batched withdrawals and payroll
  // transactions routinely produce 3-4 equal outputs)
  let bestValue = 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount && count >= 5) {
      bestCount = count;
      bestValue = value;
    }
  }

  if (bestCount < 5) return null;

  return {
    count: bestCount,
    denomination: bestValue,
    total: values.length,
  };
}

function formatBtc(sats: number): string {
  return `${(sats / 100_000_000).toFixed(8).replace(/\.?0+$/, "")} BTC`;
}
