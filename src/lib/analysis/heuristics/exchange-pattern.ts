import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";

/**
 * Exchange UTXO Pattern Detection
 *
 * Detects structural patterns consistent with centralized exchange withdrawals
 * without maintaining any database of exchange addresses.
 *
 * Patterns:
 * - Fan-out: 1-2 inputs, 10+ outputs (batch withdrawal)
 * - High output count with mixed address types (exchanges serve all formats)
 * - Many outputs going to unique addresses (customer withdrawals)
 * - Small fee relative to total value (exchanges optimize fees)
 *
 * This is purely structural - no address list is used.
 *
 * Impact: -3 (informational, reduces privacy due to exchange origin)
 */
export const analyzeExchangePattern: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  if (tx.vin.some((v) => v.is_coinbase)) return { findings };

  const spendable = tx.vout.filter(
    (o) => o.scriptpubkey_type !== "op_return" && o.value > 0,
  );

  // Exchange batch withdrawal: 1-2 inputs, 10+ outputs
  if (tx.vin.length > 2 || spendable.length < 10) return { findings };

  // Check output address type diversity (exchanges serve all formats)
  const outputTypes = new Set<string>();
  for (const o of spendable) {
    if (o.scriptpubkey_type) outputTypes.add(o.scriptpubkey_type);
  }

  // Check for unique output addresses (batch withdrawals to different customers)
  const uniqueAddresses = new Set(
    spendable
      .map((o) => o.scriptpubkey_address)
      .filter(Boolean),
  );

  // Strong exchange signal: many unique addresses AND mixed types
  const hasMixedTypes = outputTypes.size >= 3;
  const hasHighDiversity = uniqueAddresses.size >= spendable.length * 0.8;
  const isBatchSize = spendable.length >= 10;

  if (!isBatchSize) return { findings };

  // Calculate value distribution for pattern detection
  const values = spendable.map((o) => o.value).sort((a, b) => a - b);
  const maxValue = values[values.length - 1];
  const minValue = values[0];
  const valueSpread = maxValue / Math.max(minValue, 1);

  // Exchange withdrawals typically have wide value spread (diverse customer amounts)
  const hasWideSpread = valueSpread > 100;

  // Count signals
  let signals = 0;
  if (hasMixedTypes) signals++;
  if (hasHighDiversity) signals++;
  if (hasWideSpread) signals++;

  // Need at least 2 structural signals to flag
  if (signals < 2) return { findings };

  const signalList: string[] = [];
  if (hasMixedTypes) signalList.push(`${outputTypes.size} different output script types`);
  if (hasHighDiversity) signalList.push(`${uniqueAddresses.size} unique output addresses`);
  if (hasWideSpread) signalList.push("wide value spread across outputs");

  findings.push({
    id: "exchange-withdrawal-pattern",
    severity: "medium",
    confidence: "medium",
    title: `Possible exchange batch withdrawal (${spendable.length} outputs)`,
    params: {
      outputCount: spendable.length,
      typeCount: outputTypes.size,
      uniqueAddresses: uniqueAddresses.size,
      signals: signalList.join(", "),
    },
    description:
      `This transaction has ${tx.vin.length} input${tx.vin.length > 1 ? "s" : ""} and ${spendable.length} outputs, ` +
      `a pattern consistent with a centralized exchange batch withdrawal. ` +
      `Structural indicators: ${signalList.join("; ")}. ` +
      "Exchange-origin UTXOs carry KYC linkage risk - the exchange knows your identity " +
      "and can link your withdrawal to your account.",
    recommendation:
      "If these funds came from a KYC exchange, they are linked to your identity. " +
      "Before spending, pass them through CoinJoin to break the chain analysis link. " +
      "Never mix exchange-origin UTXOs with non-KYC UTXOs in the same transaction.",
    scoreImpact: -3,
  });

  return { findings };
};
