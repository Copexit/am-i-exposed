import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { getSpendableOutputs } from "../heuristics/tx-utils";
import { isCoinJoinTx } from "../heuristics/coinjoin";
import { roundTo } from "@/lib/format";

/**
 * Simplified Linkability Matrix
 *
 * For each (input, output) pair, estimates the probability that they are
 * linked (i.e., the same entity controls both). This is a simplified version
 * of LaurentMT's full Boltzmann linkability matrix.
 *
 * The simplified approach uses:
 * 1. Value-based feasibility: can this input fund this output?
 * 2. Knapsack analysis: how many valid input subsets can produce this output?
 * 3. Deterministic links: obvious connections (same address, only possible source)
 *
 * For performance, limits to txs with <= 8 inputs and <= 8 outputs.
 */

interface LinkabilityCell {
  inputIndex: number;
  outputIndex: number;
  /** 0-1 probability of link */
  probability: number;
  /** Whether this is a deterministic (certain) link */
  deterministic: boolean;
}

interface LinkabilityResult {
  matrix: LinkabilityCell[][];
  /** Number of deterministic links found */
  deterministicLinks: number;
  /** Average ambiguity (0 = fully deterministic, 1 = fully ambiguous) */
  averageAmbiguity: number;
  /** Number of valid interpretations found (exact for small txs, 1 for heuristic) */
  totalInterpretations: number;
  findings: Finding[];
}

/**
 * Build a simplified linkability matrix for a transaction.
 *
 * Returns null if the transaction is too large to analyze efficiently.
 */
export function buildLinkabilityMatrix(
  tx: MempoolTransaction,
): LinkabilityResult | null {
  const findings: Finding[] = [];

  // Skip coinbase
  if (tx.vin.some((v) => v.is_coinbase)) return null;

  // Limit to manageable sizes (2^8 * 2^8 = 65K combinations max)
  if (tx.vin.length > 8 || tx.vout.length > 8) return null;
  if (tx.vin.length < 1 || tx.vout.length < 1) return null;

  const spendable = getSpendableOutputs(tx.vout);
  if (spendable.length < 1) return null;

  const inputValues = tx.vin.map((v) => v.prevout?.value ?? 0);
  const outputValues = spendable.map((o) => o.value);

  // Build feasibility matrix: can input i fund output j (even with other inputs)?
  // An input can fund an output if input_value >= output_value
  // (simplified - ignores multi-input funding)
  const nIn = inputValues.length;
  const nOut = outputValues.length;

  // Count valid partitions for each input-output pair
  // For each (i, j), count how many valid input subsets containing i
  // can produce output j (value-wise)
  const linkCounts: number[][] = Array.from({ length: nIn }, () =>
    new Array(nOut).fill(0),
  );

  // Total valid interpretations (normalizer)
  let totalInterpretations = 0;

  // For small txs, enumerate all possible input->output mappings
  // A valid mapping assigns each input to an output such that the
  // sum of inputs assigned to each output >= output value
  if (nIn <= 4 && nOut <= 4) {
    // Enumerate all nOut^nIn assignments
    const totalAssignments = nOut ** nIn;
    for (let assign = 0; assign < totalAssignments; assign++) {
      // Decode assignment: which output does each input map to?
      const mapping = new Array(nIn).fill(0);
      let temp = assign;
      for (let i = 0; i < nIn; i++) {
        mapping[i] = temp % nOut;
        temp = Math.floor(temp / nOut);
      }

      // Check if this assignment is valid (each output is funded)
      const outputTotals = new Array(nOut).fill(0);
      for (let i = 0; i < nIn; i++) {
        outputTotals[mapping[i]] += inputValues[i];
      }

      let valid = true;
      for (let j = 0; j < nOut; j++) {
        if (outputTotals[j] < outputValues[j]) {
          valid = false;
          break;
        }
      }

      if (valid) {
        totalInterpretations++;
        for (let i = 0; i < nIn; i++) {
          linkCounts[i][mapping[i]]++;
        }
      }
    }
  } else {
    // For larger txs, use a simpler heuristic: value proportional probability
    // Use raw min(input, output) as link strength; row normalization below
    // converts to probabilities (consistent with the exact-enumeration path)
    totalInterpretations = 1;
    // For 5-8 inputs, Bitcoin's value granularity means many subsets can sum
    // to the same value. Apply a conservative discount to reduce overestimate.
    const granularityDiscount = 0.7;
    for (let i = 0; i < nIn; i++) {
      for (let j = 0; j < nOut; j++) {
        linkCounts[i][j] = Math.min(inputValues[i], outputValues[j]) * granularityDiscount;
      }
    }
  }

  // Normalize to probabilities
  const matrix: LinkabilityCell[][] = [];
  let deterministicLinks = 0;

  for (let i = 0; i < nIn; i++) {
    const row: LinkabilityCell[] = [];
    const rowTotal = linkCounts[i].reduce((s, v) => s + v, 0);

    for (let j = 0; j < nOut; j++) {
      const prob = rowTotal > 0 ? linkCounts[i][j] / rowTotal : 0;
      const isDeterministic = prob > 0.99;

      if (isDeterministic) deterministicLinks++;

      row.push({
        inputIndex: i,
        outputIndex: j,
        probability: roundTo(prob),
        deterministic: isDeterministic,
      });
    }
    matrix.push(row);
  }

  // Average ambiguity: 1 - avg(max probability per row)
  // If every input maps to exactly 1 output (prob=1), ambiguity = 0
  // If every input maps equally to all outputs, ambiguity approaches 1
  const maxProbs = matrix.map((row) =>
    Math.max(...row.map((c) => c.probability)),
  );
  const avgMaxProb = maxProbs.reduce((s, v) => s + v, 0) / maxProbs.length;
  const averageAmbiguity = Math.round((1 - avgMaxProb) * 100) / 100;

  // Generate findings
  const isCJ = isCoinJoinTx(tx);

  if (deterministicLinks > 0) {
    findings.push({
      id: "linkability-deterministic",
      severity: deterministicLinks >= nIn ? "critical" : "high",
      confidence: "high",
      title: `${deterministicLinks} deterministic input-output link${deterministicLinks > 1 ? "s" : ""} found`,
      description:
        `Linkability analysis found ${deterministicLinks} input-output pair(s) with near-certain ` +
        "connections. An analyst can determine with high confidence which input funded " +
        "which output, breaking transaction privacy.",
      recommendation: isCJ
        ? "Despite the CoinJoin structure, some links remain deterministic. This may indicate a sub-optimal mix or change outputs that reduce anonymity."
        : "Use CoinJoin to break deterministic links. Transactions with equal outputs " +
          "(Whirlpool, WabiSabi) create maximum ambiguity in the linkability matrix.",
      scoreImpact: -3 * Math.min(deterministicLinks, 3),
      params: { deterministicLinks, totalPairs: nIn * nOut },
    });
  } else if (averageAmbiguity >= 0.6) {
    findings.push({
      id: "linkability-ambiguous",
      severity: "good",
      confidence: "medium",
      title: `High ambiguity: ${Math.round(averageAmbiguity * 100)}% average uncertainty`,
      description:
        `The linkability matrix shows ${Math.round(averageAmbiguity * 100)}% average ambiguity ` +
        "across all input-output pairs. This means an analyst has significant uncertainty " +
        "about which input funded which output.",
      recommendation: isCJ
        ? "Excellent CoinJoin privacy. The linkability matrix confirms high ambiguity across all input-output pairs."
        : "Good transaction privacy. For even stronger ambiguity, use CoinJoin or increase " +
          "the number of inputs and outputs.",
      scoreImpact: 2,
      params: { ambiguity: averageAmbiguity },
    });
  }

  // Equal-output subset analysis: if there are groups of 3+ equal outputs
  // but some non-equal outputs have deterministic links, flag the contradiction
  if (deterministicLinks > 0) {
    const equalGroups = findEqualOutputGroups(outputValues);
    if (equalGroups.length > 0) {
      // Find deterministic links on non-equal outputs
      const equalIndices = new Set(equalGroups.flat());
      const deterministicNonEqual: Array<{ input: number; output: number }> = [];

      for (let i = 0; i < nIn; i++) {
        for (let j = 0; j < nOut; j++) {
          if (!equalIndices.has(j) && matrix[i][j].deterministic) {
            deterministicNonEqual.push({ input: i, output: j });
          }
        }
      }

      if (deterministicNonEqual.length > 0) {
        const pairDesc = deterministicNonEqual
          .map((p) => `input[${p.input}] -> output[${p.output}]`)
          .join(", ");
        const equalCount = equalGroups.reduce((s, g) => s + g.length, 0);
        findings.push({
          id: "linkability-equal-subset",
          severity: "medium",
          confidence: "high",
          title: `Equal-output ambiguity undermined by ${deterministicNonEqual.length} deterministic non-equal link(s)`,
          description:
            `Despite ${equalCount} equal-value outputs providing ambiguity, ` +
            `${deterministicNonEqual.length} non-equal output(s) are deterministically linked: ${pairDesc}. ` +
            "An analyst can identify these specific connections with high confidence.",
          recommendation:
            "Use CoinJoin with all equal outputs (Whirlpool, WabiSabi) to prevent any deterministic links. " +
            "When equal outputs are mixed with unique-value outputs, the unique ones become easy targets.",
          scoreImpact: -2 * Math.min(deterministicNonEqual.length, 3),
          params: {
            equalOutputCount: equalCount,
            deterministicNonEqualCount: deterministicNonEqual.length,
          },
        });
      }
    }
  }

  return { matrix, deterministicLinks, averageAmbiguity, totalInterpretations, findings };
}

/**
 * Find groups of 3+ outputs with equal values.
 * Returns arrays of output indices that share the same value.
 */
function findEqualOutputGroups(values: number[]): number[][] {
  const byValue = new Map<number, number[]>();
  for (let i = 0; i < values.length; i++) {
    const arr = byValue.get(values[i]) ?? [];
    arr.push(i);
    byValue.set(values[i], arr);
  }
  return [...byValue.values()].filter((group) => group.length >= 3);
}
