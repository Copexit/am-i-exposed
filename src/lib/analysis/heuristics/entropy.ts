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
    .map((v) => v.prevout?.value ?? 0);
  const outputs = tx.vout.map((v) => v.value);

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
    const validMappings = countValidMappings(inputs, outputs);
    entropyBits = validMappings > 1 ? Math.log2(validMappings) : 0;
    method = "exact enumeration";
  } else {
    entropyBits = estimateEntropy(inputs, outputs);
    method = "estimation";
  }

  const roundedEntropy = Math.round(entropyBits * 100) / 100;

  if (roundedEntropy <= 0) {
    return {
      findings: [
        {
          id: "h5-low-entropy",
          severity: "medium",
          title: "Very low transaction entropy",
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

  const impact = Math.min(Math.floor(entropyBits * 3), 15);

  return {
    findings: [
      {
        id: "h5-entropy",
        severity: impact >= 10 ? "good" : impact >= 5 ? "low" : "medium",
        title: `Transaction entropy: ${roundedEntropy} bits`,
        description:
          `This transaction has ${roundedEntropy} bits of entropy (via ${method}), meaning there are ~${Math.round(Math.pow(2, entropyBits))} valid interpretations ` +
          "of the fund flow. Higher entropy makes chain analysis less reliable.",
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
function countValidMappings(inputs: number[], outputs: number[]): number {
  const n = inputs.length;
  const m = outputs.length;

  // For each output, find which inputs could fund it
  let count = 0;
  const totalInput = inputs.reduce((s, v) => s + v, 0);
  const totalOutput = outputs.reduce((s, v) => s + v, 0);

  // If total input < total output (shouldn't happen in valid tx), no valid mappings
  if (totalInput < totalOutput) return 1;

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
  return Math.max(count, 1);
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

  // Entropy estimate: equal outputs create ambiguity
  // n equal outputs among m inputs gives roughly log2(m^n / n!) bits
  if (maxGroupSize >= 2) {
    const n = maxGroupSize;
    const m = Math.min(inputs.length, n);
    // Simplified: log2(C(inputs, equalOutputs)) for the largest group
    return Math.log2(factorial(m)) / Math.log2(2);
  }

  // All unique outputs: entropy from input-output pairing ambiguity
  const minDim = Math.min(inputs.length, outputs.length);
  return minDim > 1 ? Math.log2(minDim) : 0;
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}
