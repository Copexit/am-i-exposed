/**
 * Boltzmann entropy calculations for transaction privacy analysis.
 *
 * Core combinatorial math (factorials, partitions, Boltzmann formula)
 * lives in ./combinatorics.ts. This module provides the transaction-level
 * entropy functions that the entropy heuristic consumes.
 */

import {
  log2Binomial,
  boltzmannEqualOutputs,
  estimateBoltzmannEntropy,
} from "./combinatorics";

/**
 * Sum the values of UTXOs that share an address, keeping first-seen order.
 * Coins controlled by one address belong to one party, so they are one
 * input (or output) for entropy - LaurentMT's Boltzmann MERGE_INPUTS /
 * MERGE_OUTPUTS options. UTXOs without an address stay separate.
 */
export function mergeByAddress(utxos: { address?: string; value: number }[]): number[] {
  const merged: number[] = [];
  const slot = new Map<string, number>();
  for (const { address, value } of utxos) {
    const i = address ? slot.get(address) : undefined;
    if (i !== undefined) {
      merged[i] += value;
    } else {
      if (address) slot.set(address, merged.length);
      merged.push(value);
    }
  }
  return merged;
}

/** Iteration budget for brute-force valid-mapping enumeration. */
const MAPPING_ITERATION_LIMIT = 10_000;

// ---- Boltzmann partition formula for equal-value outputs -------------------

/**
 * Try the Boltzmann partition path: if all spendable outputs share the same
 * value, compute the exact interpretation count using integer partitions.
 *
 * When k inputs can each independently fund one equal output:
 * - If k >= n (all outputs coverable): boltzmannEqualOutputs(n) * C(k, n)
 * - If 2 <= k < n (partial coverage): boltzmannEqualOutputs(k) * C(n, k)
 *   The k fundable inputs create k! (or more, via many-to-many) valid
 *   assignments among k chosen outputs, and C(n, k) ways to choose which
 *   k of the n outputs they fund.
 *
 * Returns null if the transaction doesn't qualify (mixed output values,
 * or fewer than 2 fundable inputs).
 */
export function tryBoltzmannEqualOutputs(
  inputs: number[],
  outputs: number[],
): { entropy: number; method: string } | null {
  if (outputs.length < 2 || inputs.length < 2) return null;

  const outputValue = outputs[0];
  if (!outputs.every((v) => v === outputValue)) return null;

  const n = outputs.length;
  const k = inputs.filter((v) => v >= outputValue).length;
  if (k < 2) return null;

  if (k >= n) {
    const extraInputCorrection = k > n ? log2Binomial(k, n) : 0;
    if (n <= 50) {
      const count = boltzmannEqualOutputs(n);
      const baseEntropy = count > 1 ? Math.log2(count) : 0;
      return { entropy: baseEntropy + extraInputCorrection, method: "Boltzmann partition" };
    }
    const baseEntropy = estimateBoltzmannEntropy(n);
    return { entropy: baseEntropy + extraInputCorrection, method: "Boltzmann estimate" };
  }

  // Partial coverage: k fundable inputs, n equal outputs (k < n)
  const outputChoiceCorrection = log2Binomial(n, k);
  if (k <= 50) {
    const count = boltzmannEqualOutputs(k);
    const baseEntropy = count > 1 ? Math.log2(count) : 0;
    return { entropy: baseEntropy + outputChoiceCorrection, method: "Boltzmann partition" };
  }
  const baseEntropy = estimateBoltzmannEntropy(k);
  return { entropy: baseEntropy + outputChoiceCorrection, method: "Boltzmann estimate" };
}

// ---- Assignment-based enumeration (mixed-value fallback) -------------------

/**
 * Count valid input-to-output mappings for small mixed-value transactions.
 *
 * A mapping is valid if each input can cover the outputs assigned to it
 * (sum of assigned outputs <= input value). This is a lower-bound estimate
 * of the true Boltzmann count, which would consider many-to-many mappings.
 */
export function countValidMappings(inputs: number[], outputs: number[]): { count: number; truncated: boolean } {
  const n = inputs.length;
  const m = outputs.length;

  const totalInput = inputs.reduce((s, v) => s + v, 0);
  const totalOutput = outputs.reduce((s, v) => s + v, 0);
  if (totalInput < totalOutput) return { count: 1, truncated: false };

  const limit = MAPPING_ITERATION_LIMIT;
  let iterations = 0;

  function enumerate(outputIdx: number, inputRemaining: number[]): number {
    if (iterations > limit) return 0;
    if (outputIdx === m) {
      iterations++;
      return 1;
    }
    let valid = 0;
    const outVal = outputs[outputIdx];
    for (let i = 0; i < n; i++) {
      if (inputRemaining[i] >= outVal) {
        inputRemaining[i] -= outVal;
        valid += enumerate(outputIdx + 1, inputRemaining);
        inputRemaining[i] += outVal;
        if (iterations > limit) break;
      }
    }
    return valid;
  }

  let count = enumerate(0, [...inputs]);

  // Deduplicate by identical input values
  const inputValueCounts = new Map<number, number>();
  for (const v of inputs) {
    inputValueCounts.set(v, (inputValueCounts.get(v) ?? 0) + 1);
  }
  let duplicateFactor = 1;
  for (const c of inputValueCounts.values()) {
    if (c > 1) {
      let f = 1;
      for (let i = 2; i <= c; i++) f *= i;
      duplicateFactor *= f;
    }
  }
  count = Math.round(count / duplicateFactor);

  return { count: Math.max(count, 1), truncated: iterations > limit };
}

// ---- Single-denomination Boltzmann -----------------------------------------

/**
 * Single-denomination Boltzmann for JoinMarket-style CoinJoins.
 *
 * If outputs have one dominant group of equal values (5+) plus unique change
 * outputs, compute Boltzmann entropy using only the equal-valued outputs.
 *
 * Returns null if the pattern doesn't match (multiple tiers = WabiSabi).
 */
export function trySingleDenominationBoltzmann(
  outputs: number[],
): { entropy: number; method: string } | null {
  if (outputs.length < 5) return null;

  const counts = new Map<number, number>();
  for (const v of outputs) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  let bestValue = 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count >= 5 && count > bestCount) {
      bestCount = count;
      bestValue = value;
    }
  }

  if (bestCount < 5 || bestValue === 0) return null;

  // Must be the ONLY tier - all other outputs are unique (change)
  const otherTiers = [...counts.entries()].filter(([v, c]) => v !== bestValue && c >= 2);
  if (otherTiers.length > 0) return null;

  const n = bestCount;
  if (n <= 50) {
    const count = boltzmannEqualOutputs(n);
    const entropy = count > 1 ? Math.log2(count) : 0;
    return { entropy, method: "Boltzmann partition" };
  }
  const entropy = estimateBoltzmannEntropy(n);
  return { entropy, method: "Boltzmann estimate" };
}

// ---- Multi-tier entropy estimate -------------------------------------------

/**
 * Estimate total transaction entropy for large multi-denomination transactions
 * (e.g., WabiSabi CoinJoins) using tier-decomposed Boltzmann partition formulas.
 *
 * Each denomination tier (group of k equal-value outputs) is treated as an
 * independent mini-CoinJoin. Under a tier-independence approximation:
 *   Total entropy = sum of per-tier entropies = sum(log2(N_t))
 *
 * The independence assumption overestimates by 10-50% (Gavenda et al.,
 * ESORICS 2025). For a privacy tool, overestimating entropy is the safe
 * direction - it never tells users they have less privacy than they do.
 */
export function estimateEntropy(inputs: number[], outputs: number[]): number {
  const m = inputs.length;
  if (m <= 1) return 0;

  const outputCounts = new Map<number, number>();
  for (const v of outputs) {
    outputCounts.set(v, (outputCounts.get(v) ?? 0) + 1);
  }

  let totalEntropy = 0;

  for (const [denomination, count] of outputCounts) {
    if (count === 1) {
      const eligible = inputs.filter((v) => v >= denomination).length;
      if (eligible >= 2) totalEntropy += Math.log2(eligible);
      continue;
    }
    const eligible = inputs.filter((v) => v >= denomination).length;
    const k = Math.min(count, eligible, m);
    if (k >= 2) {
      if (k <= 50) {
        const n = boltzmannEqualOutputs(k);
        totalEntropy += n > 1 ? Math.log2(n) : 0;
      } else {
        totalEntropy += estimateBoltzmannEntropy(k);
      }
    }
  }

  if (totalEntropy > 0) return totalEntropy;

  const minDim = Math.min(inputs.length, outputs.length);
  return minDim > 1 ? Math.log2(minDim) : 0;
}
