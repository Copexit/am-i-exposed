import type { TxHeuristic } from "./types";

const MAX_ENUMERABLE_SIZE = 8;

/**
 * H5: Simplified Boltzmann Entropy
 *
 * Measures transaction ambiguity by counting how many valid interpretations
 * exist (which inputs could have funded which outputs).
 *
 * Full Boltzmann analysis is computationally infeasible client-side for large
 * transactions. We use a simplified approach:
 * - For small txs (<= 8 inputs and 8 outputs): enumerate valid sub-mappings
 * - For larger txs: estimate based on equal-output count
 *
 * Higher entropy = more ambiguity = better privacy.
 *
 * Reference: LaurentMT / OXT Research
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
            "Transactions with more inputs and outputs naturally have higher entropy. CoinJoin transactions maximize entropy.",
          scoreImpact: -5,
        },
      ],
    };
  }

  let entropyBits: number;
  let method: string;

  if (
    inputs.length <= MAX_ENUMERABLE_SIZE &&
    outputs.length <= MAX_ENUMERABLE_SIZE
  ) {
    const { count: validMappings, truncated } = countValidMappings(inputs, outputs);
    entropyBits = validMappings > 1 ? Math.log2(validMappings) : 0;
    method = truncated ? "lower-bound estimate" : "exact enumeration";
  } else {
    entropyBits = estimateEntropy(inputs, outputs);
    method = "structural upper bound";
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
            "Higher entropy transactions are harder to trace. Consider using CoinJoin to maximize transaction ambiguity.",
          scoreImpact: -3,
        },
      ],
    };
  }

  // Conservative scaling: low entropy gets modest impact, high entropy rewarded more
  const impact = entropyBits < 1 ? 0 : Math.min(Math.floor(entropyBits * 2), 15);

  return {
    findings: [
      {
        id: "h5-entropy",
        severity: impact >= 10 ? "good" : impact >= 5 ? "low" : "medium",
        title: `Transaction entropy: ${roundedEntropy} bits`,
        params: { entropy: roundedEntropy, method, interpretations: displayEntropy > 40 ? 0 : Math.round(Math.pow(2, displayEntropy)) },
        description:
          `This transaction has ${roundedEntropy} bits of entropy (via ${method}), meaning there are ` +
          (method === "structural upper bound" ? "up to " : "") +
          (displayEntropy > 40
            ? `~2^${Math.round(displayEntropy)} `
            : `~${Math.round(Math.pow(2, displayEntropy)).toLocaleString()} `) +
          (method === "structural upper bound" ? "possible" : "valid") +
          " interpretations of the fund flow. Higher entropy makes chain analysis less reliable.",
        recommendation:
          entropyBits >= 4
            ? "Good entropy level. CoinJoin transactions can achieve even higher entropy."
            : "Consider using CoinJoin to significantly increase transaction entropy.",
        scoreImpact: impact,
      },
    ],
  };
};

/**
 * Count valid input-to-output mappings for small transactions.
 *
 * A mapping is valid if each input can cover the outputs assigned to it
 * (sum of assigned outputs <= input value). This is a simplified model
 * that counts subset-sum valid partitions.
 */
function countValidMappings(inputs: number[], outputs: number[]): { count: number; truncated: boolean } {
  const n = inputs.length;
  const m = outputs.length;

  // For each output, find which inputs could fund it
  let count = 0;
  const totalInput = inputs.reduce((s, v) => s + v, 0);
  const totalOutput = outputs.reduce((s, v) => s + v, 0);

  // If total input < total output (shouldn't happen in valid tx), no valid mappings
  if (totalInput < totalOutput) return { count: 1, truncated: false };

  // Simple approach: for each permutation of input assignment, check validity.
  // For small transactions, we enumerate which input each output maps to.
  // Limit to prevent combinatorial explosion.
  const limit = 10_000;
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

  count = enumerate(0, [...inputs]);
  return { count: Math.max(count, 1), truncated: iterations > limit };
}

/**
 * Estimate entropy for large transactions based on equal-output patterns.
 */
function estimateEntropy(inputs: number[], outputs: number[]): number {
  // Count equal output groups
  const outputCounts = new Map<number, number>();
  for (const v of outputs) {
    outputCounts.set(v, (outputCounts.get(v) ?? 0) + 1);
  }

  // Find largest group of equal outputs
  let maxGroupSize = 0;
  for (const count of outputCounts.values()) {
    if (count > maxGroupSize) maxGroupSize = count;
  }

  // Entropy estimate using permutation entropy: equal outputs create ambiguity
  // because each equal output could map to any input capable of funding it.
  // Upper bound: log2(k!) where k = min(equalOutputs, inputs)
  // This is tighter than n * log2(m) which ignores subset-sum constraints.
  if (maxGroupSize >= 2) {
    const n = maxGroupSize;
    const m = inputs.length;
    if (m <= 1) return 0;
    const k = Math.min(n, m);
    let logFactorial = 0;
    for (let i = 2; i <= k; i++) logFactorial += Math.log2(i);
    return logFactorial;
  }

  // All unique outputs: entropy from input-output pairing ambiguity
  const minDim = Math.min(inputs.length, outputs.length);
  return minDim > 1 ? Math.log2(minDim) : 0;
}

