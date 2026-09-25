import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { isCoinbase, getSpendableOutputs } from "../heuristics/tx-utils";
import { isCoinJoinTx } from "../heuristics/coinjoin";
import { roundTo } from "@/lib/format";

/**
 * Boltzmann Link Probability Matrix (LaurentMT), exact for small txs.
 *
 * An interpretation pairs a partition of the inputs with a partition of the
 * outputs (same number of blocks; one input block may fund no output and only
 * pay fee) such that every input block funds its output block
 * (sum(in) >= sum(out); the differences add up to the fee).
 * LPM[i][o] = interpretations in which input i and output o share a block,
 * divided by the number of interpretations N. A link is deterministic when
 * it holds in every interpretation. See docs/research-boltzmann-entropy.md.
 *
 * Exact enumeration is limited to <= 4 inputs and <= 4 outputs (Bell(4)^2
 * partition pairs x 4! matchings); larger txs are left to the WASM Boltzmann.
 */

interface LinkabilityCell {
  inputIndex: number;
  outputIndex: number;
  /** 0-1 probability of link */
  probability: number;
  /** Whether this link holds in every interpretation */
  deterministic: boolean;
}

interface LinkabilityResult {
  /** [input][output] */
  matrix: LinkabilityCell[][];
  /** Number of deterministic links found */
  deterministicLinks: number;
  /** Number of valid interpretations (Boltzmann N) */
  totalInterpretations: number;
  findings: Finding[];
}

const MAX_EXACT = 4;

/** All set partitions of {0..n-1}, each as an array of block bitmasks. */
function setPartitions(n: number): number[][] {
  const out: number[][] = [];
  const blocks: number[] = [];
  const rec = (i: number) => {
    if (i === n) { out.push([...blocks]); return; }
    for (let b = 0; b < blocks.length; b++) {
      blocks[b] |= 1 << i;
      rec(i + 1);
      blocks[b] &= ~(1 << i);
    }
    blocks.push(1 << i);
    rec(i + 1);
    blocks.pop();
  };
  rec(0);
  return out;
}

function maskSum(mask: number, values: number[]): number {
  let s = 0;
  for (let i = 0; i < values.length; i++) if (mask & (1 << i)) s += values[i];
  return s;
}

/**
 * Build the Boltzmann linkability matrix for a transaction.
 *
 * Returns null for coinbase, missing prevout values, or txs above the
 * exact-enumeration limit.
 */
export function buildLinkabilityMatrix(
  tx: MempoolTransaction,
): LinkabilityResult | null {
  const findings: Finding[] = [];

  if (isCoinbase(tx)) return null;
  if (tx.vin.length < 1 || tx.vin.length > MAX_EXACT) return null;
  if (tx.vin.some((v) => v.prevout == null)) return null;

  const spendable = getSpendableOutputs(tx.vout);
  if (spendable.length < 1 || spendable.length > MAX_EXACT) return null;

  const inputValues = tx.vin.map((v) => v.prevout!.value);
  const outputValues = spendable.map((o) => o.value);
  const nIn = inputValues.length;
  const nOut = outputValues.length;

  const linkCounts: number[][] = Array.from({ length: nIn }, () => new Array(nOut).fill(0));
  let totalInterpretations = 0;

  // Each output partition also comes with one empty block: an input block
  // that funds no output and only pays fee (Boltzmann's empty aggregate).
  const outPartitions = setPartitions(nOut).flatMap((p) => {
    const blocks = p.map((m) => ({ mask: m, sum: maskSum(m, outputValues) }));
    return [blocks, [...blocks, { mask: 0, sum: 0 }]];
  });
  for (const inPart of setPartitions(nIn)) {
    const inBlocks = inPart.map((m) => ({ mask: m, sum: maskSum(m, inputValues) }));
    for (const outBlocks of outPartitions) {
      if (outBlocks.length !== inBlocks.length) continue;
      // Every bijection input block -> output block where the input block funds it
      const pairing: number[] = [];
      const match = (k: number, used: number) => {
        if (k === inBlocks.length) {
          totalInterpretations++;
          for (let b = 0; b < k; b++) {
            for (let i = 0; i < nIn; i++) {
              if (!(inBlocks[b].mask & (1 << i))) continue;
              for (let o = 0; o < nOut; o++) {
                if (outBlocks[pairing[b]].mask & (1 << o)) linkCounts[i][o]++;
              }
            }
          }
          return;
        }
        for (let j = 0; j < outBlocks.length; j++) {
          if (used & (1 << j) || inBlocks[k].sum < outBlocks[j].sum) continue;
          pairing[k] = j;
          match(k + 1, used | (1 << j));
        }
      };
      match(0, 0);
    }
  }

  // Outputs exceed inputs (bad data): no valid interpretation
  if (totalInterpretations === 0) return null;

  const matrix: LinkabilityCell[][] = [];
  let deterministicLinks = 0;
  for (let i = 0; i < nIn; i++) {
    const row: LinkabilityCell[] = [];
    for (let j = 0; j < nOut; j++) {
      const isDeterministic = linkCounts[i][j] === totalInterpretations;
      if (isDeterministic) deterministicLinks++;
      row.push({
        inputIndex: i,
        outputIndex: j,
        probability: roundTo(linkCounts[i][j] / totalInterpretations),
        deterministic: isDeterministic,
      });
    }
    matrix.push(row);
  }

  // Nothing to report when there is no link to hide: N === 1 (every 1-in tx,
  // and any tx only valid as one merged transfer) is zero entropy that H5
  // already scores; a single output is funded by all inputs even when a dust
  // input can be a fee-only block (N = 2); inputs sharing one address are one
  // owner (Boltzmann MERGE_INPUTS, as H5 applies it). Ambiguity (N > 1) is
  // H5's entropy reward, so only links that stay deterministic despite other
  // interpretations are reported.
  const firstAddr = tx.vin[0].prevout!.scriptpubkey_address;
  const singleOwner = !!firstAddr && tx.vin.every((v) => v.prevout!.scriptpubkey_address === firstAddr);
  if (totalInterpretations === 1 || nOut === 1 || singleOwner) {
    return { matrix, deterministicLinks, totalInterpretations, findings };
  }

  const isCJ = isCoinJoinTx(tx);

  if (deterministicLinks > 0) {
    findings.push({
      id: "linkability-deterministic",
      severity: deterministicLinks >= nIn ? "critical" : "high",
      confidence: "high",
      title: `${deterministicLinks} deterministic input-output link${deterministicLinks > 1 ? "s" : ""} found`,
      description:
        `Linkability analysis found ${deterministicLinks} input-output link(s) that hold in all ` +
        `${totalInterpretations} valid interpretations of this transaction. An analyst can ` +
        "determine which input funded which output, breaking transaction privacy.",
      recommendation: isCJ
        ? "Despite the CoinJoin structure, some links remain deterministic. This may indicate a sub-optimal mix or change outputs that reduce anonymity."
        : "Use CoinJoin to break deterministic links. Transactions with equal outputs " +
          "(Whirlpool, WabiSabi) create maximum ambiguity in the linkability matrix.",
      scoreImpact: -3 * Math.min(deterministicLinks, 3),
      params: {
        deterministicLinks,
        totalPairs: nIn * nOut,
        interpretations: totalInterpretations,
        ...(isCJ ? { context: "coinjoin" } : {}),
      },
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
            pairs: pairDesc,
          },
        });
      }
    }
  }

  return { matrix, deterministicLinks, totalInterpretations, findings };
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
