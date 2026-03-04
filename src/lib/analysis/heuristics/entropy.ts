import type { TxHeuristic } from "./types";

const MAX_ENUMERABLE_SIZE = 8;

/**
 * H5: Boltzmann Entropy
 *
 * Measures transaction ambiguity by counting how many valid interpretations
 * exist (which inputs could have funded which outputs).
 *
 * For equal-value outputs (CoinJoin), uses the Boltzmann partition formula:
 *   N = sum over all integer partitions of n:
 *       n!^2 / (prod(si!^2) * prod(mj!))
 * where si are partition parts and mj are multiplicities of each distinct part.
 *
 * For mixed-value transactions, uses assignment-based enumeration (lower bound).
 *
 * Higher entropy = more ambiguity = better privacy.
 *
 * Reference: LaurentMT / OXT Research, Boltzmann tool
 * Impact: -5 to +15
 */
export const analyzeEntropy: TxHeuristic = (tx) => {
  const inputs = tx.vin
    .filter((v) => !v.is_coinbase)
    .map((v) => v.prevout?.value)
    .filter((v): v is number => v != null);
  // Filter to spendable outputs (exclude OP_RETURN and other non-spendable)
  const outputs = tx.vout
    .filter((o) => o.scriptpubkey_type !== "op_return" && o.value > 0)
    .map((v) => v.value);

  // Coinbase transactions have no privacy implications
  if (inputs.length === 0) return { findings: [] };

  // Simple 1-in-1-out: zero entropy
  if (inputs.length === 1 && outputs.length === 1) {
    return {
      findings: [
        {
          id: "h5-zero-entropy",
          severity: "low",
          title: "Zero transaction entropy",
          description:
            "This transaction has a single input and single output, meaning there is only one possible interpretation. No ambiguity exists about the flow of funds.",
          recommendation:
            "Transactions with more inputs and outputs naturally have higher entropy. When possible, spend exact amounts to avoid change outputs. CoinJoin transactions maximize entropy but may be flagged by some exchanges.",
          scoreImpact: -5,
        },
      ],
    };
  }

  // N-in-1-out sweep/consolidation: zero entropy, all inputs provably linked
  if (outputs.length === 1 && inputs.length >= 2) {
    return {
      findings: [
        {
          id: "h5-zero-entropy",
          severity: inputs.length >= 5 ? "high" : "medium",
          title: `Zero entropy: ${inputs.length}-input sweep/consolidation`,
          params: { inputCount: inputs.length },
          description:
            `This transaction consolidates ${inputs.length} inputs into a single output. ` +
            "There is only one possible interpretation of the fund flow. " +
            "All input addresses are now provably linked.",
          recommendation:
            "Consolidation transactions have zero ambiguity. For future consolidations, " +
            "run UTXOs through a CoinJoin first to break ownership links before combining them.",
          scoreImpact: -3,
          remediation: {
            steps: [
              "The address linkage from this consolidation cannot be undone - all input addresses are now provably controlled by the same entity.",
              "Going forward, use coin control to select specific UTXOs rather than auto-selecting.",
              "If you need to consolidate in the future, run UTXOs through a CoinJoin first.",
              "Consider Lightning Network for smaller payments to reduce on-chain UTXO accumulation.",
            ],
            tools: [
              { name: "Sparrow Wallet (Coin Control)", url: "https://sparrowwallet.com" },
              { name: "Wasabi Wallet (CoinJoin)", url: "https://wasabiwallet.io" },
            ],
            urgency: inputs.length >= 10 ? "soon" as const : "when-convenient" as const,
          },
        },
      ],
    };
  }

  let entropyBits: number;
  let method: string;

  // Check for equal-value outputs (Boltzmann partition path)
  const equalOutputResult = tryBoltzmannEqualOutputs(inputs, outputs);

  if (equalOutputResult !== null) {
    entropyBits = equalOutputResult.entropy;
    method = equalOutputResult.method;
  } else if (
    inputs.length <= MAX_ENUMERABLE_SIZE &&
    outputs.length <= MAX_ENUMERABLE_SIZE
  ) {
    // Mixed-value: assignment-based enumeration (lower bound)
    const { count: validMappings, truncated } = countValidMappings(inputs, outputs);
    entropyBits = validMappings > 1 ? Math.log2(validMappings) : 0;
    method = truncated ? "lower-bound estimate" : "exact enumeration";

    // The one-to-one assignment model can return 0 when no single input can
    // cover an output alone (e.g., Stonewall: 3 inputs, 2 equal outputs at
    // 104k sats but no input >= 104k*2). In the many-to-many Boltzmann model,
    // equal-value outputs still create real ambiguity. Fall back to
    // equal-output permutation entropy as a conservative lower bound.
    if (entropyBits <= 0) {
      const counts = new Map<number, number>();
      for (const v of outputs) counts.set(v, (counts.get(v) ?? 0) + 1);
      let maxGroup = 0;
      for (const c of counts.values()) if (c > maxGroup) maxGroup = c;
      if (maxGroup >= 2) {
        const logBits = log2Factorial(maxGroup);
        if (logBits > 0) {
          entropyBits = logBits;
          method = "Boltzmann partition";
        }
      }
    }
  } else {
    entropyBits = estimateEntropy(inputs, outputs);
    method = "multi-tier permutation estimate";
  }

  // Cap displayed entropy to avoid misleadingly large values from estimation.
  // The estimation formula overestimates for large CoinJoins because it doesn't
  // account for subset-sum constraints. Cap display at 64 bits (practical maximum).
  const displayEntropy = Math.min(entropyBits, 64);
  const roundedEntropy = Math.round(displayEntropy * 100) / 100;

  if (roundedEntropy <= 0) {
    return {
      findings: [
        {
          id: "h5-low-entropy",
          severity: "medium",
          title: "Very low transaction entropy",
          params: { entropy: roundedEntropy, method },
          description:
            `This transaction has near-zero entropy (${roundedEntropy} bits, via ${method}). ` +
            "There is essentially only one valid interpretation of the fund flow, making it trivial to trace.",
          recommendation:
            "Higher entropy transactions are harder to trace. When possible, spend exact amounts to avoid change. Consider using CoinJoin to maximize ambiguity - but note that some exchanges may flag CoinJoin deposits.",
          scoreImpact: -3,
        },
      ],
    };
  }

  // Conservative scaling: low entropy gets modest impact, high entropy rewarded more
  const impact = entropyBits < 1 ? 0 : entropyBits < 2 ? 2 : Math.min(Math.floor(entropyBits * 2), 15);

  return {
    findings: [
      {
        id: "h5-entropy",
        severity: impact >= 10 ? "good" : impact >= 5 ? "low" : impact > 0 ? "low" : "medium",
        title: `Transaction entropy: ${roundedEntropy} bits`,
        params: {
          entropy: roundedEntropy,
          method,
          interpretations: displayEntropy > 40 ? `2^${Math.round(displayEntropy)}` : Math.round(Math.pow(2, displayEntropy)),
          context: entropyBits >= 4 ? "high" : "low",
          entropyPerUtxo: Math.round((entropyBits / (inputs.length + outputs.length)) * 1000) / 1000,
          nUtxos: inputs.length + outputs.length,
        },
        description:
          `This transaction has ${roundedEntropy} bits of entropy (via ${method}), meaning there are ` +
          (method.includes("estimate") ? "approximately " : "") +
          (displayEntropy > 40
            ? `~2^${Math.round(displayEntropy)} `
            : `~${Math.round(Math.pow(2, displayEntropy)).toLocaleString()} `) +
          (method.includes("estimate") ? "possible" : "valid") +
          " interpretations of the fund flow. Higher entropy makes chain analysis less reliable." +
          ` Entropy per UTXO: ${Math.round((entropyBits / (inputs.length + outputs.length)) * 1000) / 1000} bits (${inputs.length + outputs.length} UTXOs).`,
        recommendation:
          entropyBits >= 4
            ? "Good entropy level. Spending exact amounts (no change) further improves privacy."
            : "When possible, spend exact amounts to avoid change outputs. For significantly higher entropy, consider CoinJoin - but note that some exchanges may flag CoinJoin deposits.",
        scoreImpact: impact,
      },
    ],
  };
};

// ── Boltzmann partition formula for equal-value outputs ──────────────────────

/**
 * Try the Boltzmann partition path: if all spendable outputs share the same
 * value AND all inputs can individually fund at least one output, compute
 * the exact interpretation count using integer partitions.
 *
 * Returns null if the transaction doesn't qualify (mixed output values).
 */
function tryBoltzmannEqualOutputs(
  inputs: number[],
  outputs: number[],
): { entropy: number; method: string } | null {
  if (outputs.length < 2 || inputs.length < 2) return null;

  // Check if all outputs share the same value
  const outputValue = outputs[0];
  if (!outputs.every((v) => v === outputValue)) return null;

  const n = outputs.length;

  // All inputs must be able to fund at least one output
  const fundableInputs = inputs.filter((v) => v >= outputValue);
  if (fundableInputs.length < n) return null;

  // Use output count as the base partition size
  const effectiveN = n;

  // When there are more fundable inputs than outputs, additional inputs
  // create more valid assignments (some inputs can be "idle"). Add a
  // correction factor of log2(C(k, n)) for choosing which n of k inputs
  // are active.
  const k = fundableInputs.length;
  let extraInputCorrection = 0;
  if (k > n) {
    extraInputCorrection = log2Binomial(k, n);
  }

  if (effectiveN <= 50) {
    const count = boltzmannEqualOutputs(effectiveN);
    const baseEntropy = count > 1 ? Math.log2(count) : 0;
    return { entropy: baseEntropy + extraInputCorrection, method: "Boltzmann partition" };
  }

  // For very large n, use Stirling approximation
  const baseEntropy = estimateBoltzmannEntropy(effectiveN);
  return { entropy: baseEntropy + extraInputCorrection, method: "Boltzmann estimate" };
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
  if (n <= 13) {
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
function countValidMappings(inputs: number[], outputs: number[]): { count: number; truncated: boolean } {
  const n = inputs.length;
  const m = outputs.length;

  const totalInput = inputs.reduce((s, v) => s + v, 0);
  const totalOutput = outputs.reduce((s, v) => s + v, 0);

  // If total input < total output (shouldn't happen in valid tx), no valid mappings
  if (totalInput < totalOutput) return { count: 1, truncated: false };

  // For each output, try assigning it to each input that can fund it.
  // Limit iterations to prevent combinatorial explosion.
  const limit = 10_000;
  let iterations = 0;
  let count = 0;

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

  count = enumerate(0, [...inputs]);

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
 * Estimate per-participant entropy for large multi-denomination transactions
 * (e.g., WabiSabi CoinJoins) using weighted-average permutation entropy.
 *
 * Each denomination tier (group of k equal-value outputs) is treated as a
 * mini-CoinJoin. Within a tier, k! permutations are valid (swapping equal-
 * valued columns preserves the flow matrix). This gives log2(k!) bits of
 * per-tier entropy.
 *
 * The weighted average across tiers (weighted by tier size) represents the
 * expected entropy for a randomly chosen participant. This is consistent
 * with what Boltzmann computes for single-tier CoinJoins like Whirlpool:
 * per-participant entropy, not total transaction entropy.
 *
 * Only inputs with value >= the denomination are eligible to fund a tier.
 * The effective k is min(output_count, eligible_inputs).
 *
 * The exact multi-denomination entropy is NP-hard (constrained subset sum).
 * See Gavenda et al., "Analysis of Input-Output Mappings in CoinJoin
 * Transactions with Arbitrary Values" (ESORICS 2025).
 */
function estimateEntropy(inputs: number[], outputs: number[]): number {
  const m = inputs.length;
  if (m <= 1) return 0;

  // Count equal output groups (denomination tiers)
  const outputCounts = new Map<number, number>();
  for (const v of outputs) {
    outputCounts.set(v, (outputCounts.get(v) ?? 0) + 1);
  }

  // Compute per-tier permutation entropy, then weighted average.
  // Weight by tier size: larger tiers contain more participants, so they
  // contribute proportionally more to the "expected participant entropy."
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [denomination, count] of outputCounts) {
    if (count < 2) continue;
    const eligible = inputs.filter((v) => v >= denomination).length;
    const k = Math.min(count, eligible, m);
    if (k >= 2) {
      let logFact = 0;
      for (let i = 2; i <= k; i++) logFact += Math.log2(i);
      weightedSum += count * logFact;
      totalWeight += count;
    }
  }

  if (totalWeight > 0) return weightedSum / totalWeight;

  // All unique outputs: entropy from input-output pairing ambiguity
  const minDim = Math.min(inputs.length, outputs.length);
  return minDim > 1 ? Math.log2(minDim) : 0;
}
