import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";

/**
 * Anonymity Set Analysis
 *
 * Calculates the anonymity set for each output value - the number of outputs
 * sharing the same value, making them indistinguishable from each other.
 *
 * An anonymity set of 1 means the output is unique and trivially traceable.
 * Higher anonymity sets (like in CoinJoin) mean more possible interpretations.
 *
 * This is separate from H4 CoinJoin detection - it provides granular per-output
 * analysis rather than a binary CoinJoin/not-CoinJoin determination.
 *
 * Impact: informational (-2 to +5, lighter than CoinJoin detection)
 */
export const analyzeAnonymitySet: TxHeuristic = (tx) => {
  const findings: Finding[] = [];
  const outputs = tx.vout;

  if (outputs.length < 2) return { findings };

  // Count occurrences of each output value
  const valueCounts = new Map<number, number>();
  for (const out of outputs) {
    valueCounts.set(out.value, (valueCounts.get(out.value) ?? 0) + 1);
  }

  // Calculate anonymity sets
  const sets: { value: number; count: number }[] = [];
  const seen = new Set<number>();
  for (const out of outputs) {
    if (seen.has(out.value)) continue;
    seen.add(out.value);
    const count = valueCounts.get(out.value) ?? 1;
    sets.push({ value: out.value, count });
  }

  // Sort by count descending
  sets.sort((a, b) => b.count - a.count);

  // Find max anonymity set
  const maxSet = sets[0];
  const uniqueOutputs = sets.filter((s) => s.count === 1).length;
  const totalSets = sets.length;

  if (maxSet.count >= 5) {
    // Strong anonymity set
    findings.push({
      id: "anon-set-strong",
      severity: "good",
      title: `Largest anonymity set: ${maxSet.count} outputs`,
      description:
        `${maxSet.count} outputs share the value ${formatSats(maxSet.value)}, creating an anonymity set of ${maxSet.count}. ` +
        `An observer cannot distinguish which input funded which of these ${maxSet.count} equal outputs. ` +
        buildSetSummary(sets),
      recommendation:
        "Strong anonymity sets indicate good privacy. CoinJoin transactions maximize this property.",
      scoreImpact: 5,
    });
  } else if (maxSet.count >= 2) {
    // Some ambiguity
    findings.push({
      id: "anon-set-moderate",
      severity: "low",
      title: `Anonymity set: ${maxSet.count} equal outputs`,
      description:
        `${maxSet.count} outputs share the value ${formatSats(maxSet.value)}. ` +
        `This provides limited ambiguity. ` +
        buildSetSummary(sets),
      recommendation:
        "For stronger privacy, use CoinJoin to create larger anonymity sets (5+ equal outputs).",
      scoreImpact: 1,
    });
  } else if (uniqueOutputs === totalSets) {
    // All outputs are unique - no ambiguity
    findings.push({
      id: "anon-set-none",
      severity: "medium",
      title: "No anonymity set (all outputs unique)",
      description:
        `All ${outputs.length} outputs have unique values. Each output is trivially distinguishable, ` +
        `making it easy to determine payment vs change and trace the fund flow.`,
      recommendation:
        "Transactions where all outputs have unique values provide no ambiguity to observers. Consider using CoinJoin for better privacy.",
      scoreImpact: -2,
    });
  }

  return { findings };
};

function formatSats(sats: number): string {
  if (sats >= 100_000_000) {
    return `${(sats / 100_000_000).toFixed(8).replace(/\.?0+$/, "")} BTC`;
  }
  return `${sats.toLocaleString()} sats`;
}

function buildSetSummary(sets: { value: number; count: number }[]): string {
  const grouped = sets.filter((s) => s.count >= 2);
  if (grouped.length === 0) return "";

  const parts = grouped
    .slice(0, 3)
    .map((s) => `${s.count}x ${formatSats(s.value)}`);

  const suffix = grouped.length > 3 ? ` and ${grouped.length - 3} more groups` : "";
  return `Equal-value groups: ${parts.join(", ")}${suffix}.`;
}
