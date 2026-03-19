/** Iteration budget for brute-force valid-mapping enumeration. */
const MAPPING_ITERATION_LIMIT = 10_000;

// ── Boltzmann partition formula for equal-value outputs ──────────────────────

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

  // Check if all outputs share the same value
  const outputValue = outputs[0];
  if (!outputs.every((v) => v === outputValue)) return null;

  const n = outputs.length;

  // Count inputs that can individually fund at least one output
  const fundableInputs = inputs.filter((v) => v >= outputValue);
  const k = fundableInputs.length;

  // Need at least 2 fundable inputs for any meaningful entropy
  if (k < 2) return null;

  if (k >= n) {
    // All outputs can be covered: use n as the Boltzmann base size
    // When k > n, add C(k, n) for choosing which n of k inputs are active
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
  // The k inputs create boltzmannEqualOutputs(k) valid mappings among
  // whichever k outputs they fund, and C(n, k) ways to choose those outputs.
  const outputChoiceCorrection = log2Binomial(n, k);

  if (k <= 50) {
    const count = boltzmannEqualOutputs(k);
    const baseEntropy = count > 1 ? Math.log2(count) : 0;
    return { entropy: baseEntropy + outputChoiceCorrection, method: "Boltzmann partition" };
  }

  const baseEntropy = estimateBoltzmannEntropy(k);
  return { entropy: baseEntropy + outputChoiceCorrection, method: "Boltzmann estimate" };
}

/** Compute log2 of the binomial coefficient C(n, k) using log-sum of factorials. */
function log2Binomial(n: number, k: number): number {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 0;
  // log2(C(n,k)) = sum(log2(i), i=k+1..n) - sum(log2(i), i=1..n-k)
  let result = 0;
  for (let i = 1; i <= n - k; i++) {
    result += Math.log2(k + i) - Math.log2(i);
  }
  return result;
}

/**
 * Compute the number of valid interpretations for n equal inputs and n equal
 * outputs using the Boltzmann partition formula.
 *
 * For each integer partition (s1, s2, ..., sk) of n:
 *   term = n!^2 / (prod(si!^2) * prod(mj!))
 * where mj = multiplicity of each distinct part size.
 *
 * Total N = sum of all terms.
 *
 * Reference values:
 *   n=2: 3, n=3: 16, n=4: 131, n=5: 1,496, n=6: 22,482,
 *   n=7: 426,833, n=8: 9,934,563, n=9: ~277,006,192
 */
function boltzmannEqualOutputs(n: number): number {
  const partitions = integerPartitions(n);

  // boltzmannExact computes (n!)^2 which exceeds MAX_SAFE_INTEGER for n > 12.
  // Use exact arithmetic only for small n; log-space avoids precision loss.
  if (n <= 12) {
    return boltzmannExact(n, partitions);
  }
  // Return 2^(log2 result) for larger n
  const log2Total = boltzmannLog2(n, partitions);
  return Math.pow(2, log2Total);
}

/** Exact Boltzmann partition count for small n (n <= 13). */
function boltzmannExact(n: number, partitions: number[][]): number {
  const nFact = factorial(n);
  const nFactSquared = nFact * nFact;
  let total = 0;

  for (const partition of partitions) {
    let prodPartFactSquared = 1;
    for (const part of partition) {
      const pf = factorial(part);
      prodPartFactSquared *= pf * pf;
    }

    const multiplicities = new Map<number, number>();
    for (const part of partition) {
      multiplicities.set(part, (multiplicities.get(part) ?? 0) + 1);
    }

    let prodMultFact = 1;
    for (const m of multiplicities.values()) {
      prodMultFact *= factorial(m);
    }

    total += nFactSquared / (prodPartFactSquared * prodMultFact);
  }

  return Math.round(total);
}

/** Log2 of Boltzmann partition count for large n (n > 18). Uses log-space to avoid factorial overflow. */
function boltzmannLog2(n: number, partitions: number[][]): number {
  const log2nFact = log2Factorial(n);
  const log2nFactSquared = 2 * log2nFact;

  // Use log-sum-exp: log2(sum(2^xi)) = max(xi) + log2(sum(2^(xi - max)))
  const logTerms: number[] = [];

  for (const partition of partitions) {
    let log2Denom = 0;
    for (const part of partition) {
      log2Denom += 2 * log2Factorial(part);
    }

    const multiplicities = new Map<number, number>();
    for (const part of partition) {
      multiplicities.set(part, (multiplicities.get(part) ?? 0) + 1);
    }
    for (const m of multiplicities.values()) {
      log2Denom += log2Factorial(m);
    }

    logTerms.push(log2nFactSquared - log2Denom);
  }

  // Log-sum-exp for numerical stability (loop-based max to avoid stack overflow with large arrays)
  let maxLog = -Infinity;
  for (const lt of logTerms) {
    if (lt > maxLog) maxLog = lt;
  }
  let sumExp = 0;
  for (const lt of logTerms) {
    sumExp += Math.pow(2, lt - maxLog);
  }
  return maxLog + Math.log2(sumExp);
}

/** Compute log2(n!) using sum of logs (overflow-safe). */
function log2Factorial(n: number): number {
  let result = 0;
  for (let i = 2; i <= n; i++) result += Math.log2(i);
  return result;
}

/**
 * Estimate Boltzmann entropy for large n using asymptotic approximation.
 * Based on the observation that log2(N) grows roughly as 2*n*log2(n) - n*log2(e).
 */
function estimateBoltzmannEntropy(n: number): number {
  // For large n, the dominant partition is the all-ones partition giving (n!)^2 / n!
  // = n!, and there are many more partitions. Use a conservative estimate.
  let logN = 0;
  for (let i = 2; i <= n; i++) logN += Math.log2(i);
  // The all-ones partition contributes n! interpretations.
  // Other partitions add roughly 50-80% more. Scale by ~1.7x for a reasonable estimate.
  return logN + Math.log2(1.7);
}

// ── Integer partition generator ─────────────────────────────────────────────

/**
 * Generate all integer partitions of n.
 * A partition is a list of positive integers that sum to n, in non-increasing order.
 * E.g., partitions(4) = [[4], [3,1], [2,2], [2,1,1], [1,1,1,1]]
 *
 * For n <= 50, this produces at most ~204,226 partitions - trivially fast.
 */
function integerPartitions(n: number): number[][] {
  const result: number[][] = [];

  function generate(remaining: number, maxPart: number, current: number[]): void {
    if (remaining === 0) {
      result.push([...current]);
      return;
    }
    for (let part = Math.min(remaining, maxPart); part >= 1; part--) {
      current.push(part);
      generate(remaining - part, part, current);
      current.pop();
    }
  }

  generate(n, n, []);
  return result;
}

// ── Memoized factorial ──────────────────────────────────────────────────────

const factorialCache: number[] = [1, 1];

function factorial(n: number): number {
  if (n < factorialCache.length) return factorialCache[n];
  let result = factorialCache[factorialCache.length - 1];
  for (let i = factorialCache.length; i <= n; i++) {
    result *= i;
    factorialCache[i] = result;
  }
  return result;
}

// ── Assignment-based enumeration (mixed-value fallback) ─────────────────────

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

  // If total input < total output (shouldn't happen in valid tx), no valid mappings
  if (totalInput < totalOutput) return { count: 1, truncated: false };

  // For each output, try assigning it to each input that can fund it.
  // Limit iterations to prevent combinatorial explosion.
  const limit = MAPPING_ITERATION_LIMIT;
  let iterations = 0;

  function enumerate(
    outputIdx: number,
    inputRemaining: number[],
  ): number {
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

  // Deduplicate by identical input values: swapping indistinguishable inputs
  // doesn't create a new interpretation from an adversary's perspective.
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

/**
 * Single-denomination Boltzmann for JoinMarket-style CoinJoins.
 *
 * If outputs have one dominant group of equal values (5+) plus unique change
 * outputs, compute Boltzmann entropy using only the equal-valued outputs.
 *
 * In JoinMarket, each participant contributes one or more inputs to fund one
 * equal output. The number of mixing participants = number of equal outputs = n.
 * Change outputs belong to individual makers/taker and don't contribute to
 * the mixing ambiguity.
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

  // Find the dominant denomination (most common value with 5+ occurrences)
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
  if (otherTiers.length > 0) return null; // Multiple tiers = WabiSabi

  // Single denomination with n equal outputs: use Boltzmann partition
  const n = bestCount;

  if (n <= 50) {
    const count = boltzmannEqualOutputs(n);
    const entropy = count > 1 ? Math.log2(count) : 0;
    return { entropy, method: "Boltzmann partition" };
  }

  const entropy = estimateBoltzmannEntropy(n);
  return { entropy, method: "Boltzmann estimate" };
}

/**
 * Estimate total transaction entropy for large multi-denomination transactions
 * (e.g., WabiSabi CoinJoins) using tier-decomposed Boltzmann partition formulas.
 *
 * Each denomination tier (group of k equal-value outputs) is treated as an
 * independent mini-CoinJoin. Within a tier of k equal outputs with e eligible
 * inputs, the Boltzmann partition formula gives the exact intra-tier combination
 * count N_t = boltzmannEqualOutputs(min(k, e)).
 *
 * Under a tier-independence approximation (valid upper bound):
 *   Total entropy = sum of per-tier entropies = sum(log2(N_t))
 *
 * Only inputs with value >= the denomination are eligible to fund a tier.
 *
 * The independence assumption overestimates by 10-50% (Gavenda et al.,
 * ESORICS 2025). For a privacy tool, overestimating entropy is the safe
 * direction - it never tells users they have less privacy than they do.
 *
 * The exact multi-denomination entropy is NP-hard (constrained subset sum).
 */
export function estimateEntropy(inputs: number[], outputs: number[]): number {
  const m = inputs.length;
  if (m <= 1) return 0;

  // Count equal output groups (denomination tiers)
  const outputCounts = new Map<number, number>();
  for (const v of outputs) {
    outputCounts.set(v, (outputCounts.get(v) ?? 0) + 1);
  }

  // Sum of per-tier Boltzmann entropies (independence approximation)
  let totalEntropy = 0;

  for (const [denomination, count] of outputCounts) {
    // Unique outputs: each eligible input has 1/eligible chance
    if (count === 1) {
      const eligible = inputs.filter((v) => v >= denomination).length;
      if (eligible >= 2) totalEntropy += Math.log2(eligible);
      continue;
    }
    const eligible = inputs.filter((v) => v >= denomination).length;
    const k = Math.min(count, eligible, m);
    if (k >= 2) {
      // Use the Boltzmann partition formula (same as tryBoltzmannEqualOutputs)
      if (k <= 50) {
        const n = boltzmannEqualOutputs(k);
        totalEntropy += n > 1 ? Math.log2(n) : 0;
      } else {
        totalEntropy += estimateBoltzmannEntropy(k);
      }
    }
  }

  if (totalEntropy > 0) return totalEntropy;

  // All unique outputs: entropy from input-output pairing ambiguity
  const minDim = Math.min(inputs.length, outputs.length);
  return minDim > 1 ? Math.log2(minDim) : 0;
}
