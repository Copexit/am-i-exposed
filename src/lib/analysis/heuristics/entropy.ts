import type { TxHeuristic } from "./types";
import { fmtN, roundTo } from "@/lib/format";
import { getValuedOutputs } from "./tx-utils";
import {
  tryBoltzmannEqualOutputs,
  countValidMappings,
  trySingleDenominationBoltzmann,
  estimateEntropy,
} from "./entropy-math";

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
  const outputs = getValuedOutputs(tx.vout).map((v) => v.value);

  // Coinbase transactions have no privacy implications
  if (inputs.length === 0) return { findings: [] };

  // Simple 1-in-1-out: zero entropy, but this is a normal sweep/exact payment
  // No consolidation, no change - not a privacy concern per se.
  if (inputs.length === 1 && outputs.length === 1) {
    return {
      findings: [
        {
          id: "h5-zero-entropy",
          severity: "low",
          confidence: "deterministic",
          title: "Zero transaction entropy",
          description:
            "This transaction has a single input and single output, meaning there is only one possible interpretation. " +
            "This is typical of sweep transactions, exact-amount payments, or wallet migrations.",
          recommendation:
            "Single-input, single-output transactions are a normal spending pattern. " +
            "For future payments, collaborative transactions (PayJoin/Stowaway) or batch payments increase entropy.",
          scoreImpact: 0,
        },
      ],
    };
  }

  // N-in-1-out sweep/consolidation: zero entropy, all inputs provably linked
  if (outputs.length === 1 && inputs.length >= 2) {
    return {
      findings: [
        {
          id: "h5-zero-entropy-sweep",
          severity: inputs.length >= 5 ? "high" : "medium",
          confidence: "deterministic",
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
      // Count total permutations from all equal-output groups
      let totalPerms = 1;
      let totalGrouped = 0;
      for (const c of counts.values()) {
        if (c >= 2) {
          let f = 1;
          for (let i = 2; i <= c; i++) f *= i;
          totalPerms *= f;
          totalGrouped += c;
        }
      }
      // Unique (non-grouped) outputs add cross-group ambiguity: each pair
      // of unique outputs can be redistributed between input groups (the
      // "which change belongs to whom" ambiguity in Stonewall-like txs).
      const uniqueOutputs = outputs.length - totalGrouped;
      if (uniqueOutputs >= 2 && totalPerms >= 2) {
        totalPerms += Math.floor(uniqueOutputs / 2);
      }
      if (totalPerms >= 2) {
        entropyBits = Math.log2(totalPerms);
        method = "Boltzmann partition";
      }
    }
  } else {
    // Large mixed-value transaction.
    // Check for single-denomination CoinJoin (JoinMarket) before multi-tier estimate.
    // JoinMarket has one group of equal outputs + unique change outputs.
    // Use Boltzmann on just the equal outputs (change doesn't contribute to mixing entropy).
    const singleDenomResult = trySingleDenominationBoltzmann(outputs);
    if (singleDenomResult !== null) {
      entropyBits = singleDenomResult.entropy;
      method = singleDenomResult.method;
    } else {
      entropyBits = estimateEntropy(inputs, outputs);
      method = "multi-tier permutation estimate";
    }
  }

  // Cap displayed entropy for simple txs where estimation may overcount.
  // Multi-tier CoinJoins (WabiSabi) legitimately produce 500-1000+ bits;
  // the WASM path provides the authoritative value via boltzmann-enhance.
  const displayEntropy = method.includes("tier") ? entropyBits : Math.min(entropyBits, 64);
  const roundedEntropy = Math.round(displayEntropy * 100) / 100;

  if (roundedEntropy <= 0) {
    return {
      findings: [
        {
          id: "h5-low-entropy",
          severity: "medium",
          confidence: "medium",
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
        severity: impact >= 10 ? "good" : impact > 0 ? "low" : "medium",
        confidence: "medium",
        title: `Transaction entropy: ${roundedEntropy} bits`,
        params: {
          entropy: roundedEntropy,
          method,
          interpretations: displayEntropy > 40 ? `2^${Math.round(displayEntropy)}` : Math.round(Math.pow(2, displayEntropy)),
          context: entropyBits >= 4 ? "high" : "low",
          entropyPerUtxo: roundTo(entropyBits / (inputs.length + outputs.length)),
          nUtxos: inputs.length + outputs.length,
        },
        description:
          `This transaction has ${roundedEntropy} bits of entropy (via ${method}), meaning there are ` +
          (method.includes("estimate") ? "approximately " : "") +
          (displayEntropy > 40
            ? `~2^${Math.round(displayEntropy)} `
            : `~${fmtN(Math.round(Math.pow(2, displayEntropy)))} `) +
          (method.includes("estimate") ? "possible" : "valid") +
          " interpretations of the fund flow. Higher entropy makes chain analysis less reliable." +
          ` Entropy per UTXO: ${roundTo(entropyBits / (inputs.length + outputs.length))} bits (${inputs.length + outputs.length} UTXOs).`,
        recommendation:
          entropyBits >= 4
            ? "Good entropy level. Spending exact amounts (no change) further improves privacy."
            : "When possible, spend exact amounts to avoid change outputs. For significantly higher entropy, consider CoinJoin - but note that some exchanges may flag CoinJoin deposits.",
        scoreImpact: impact,
      },
    ],
  };
};
