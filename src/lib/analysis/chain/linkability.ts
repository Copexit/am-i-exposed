import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { isCoinbase, getSpendableOutputs } from "../heuristics/tx-utils";
import { isCoinJoinTx } from "../heuristics/coinjoin";
import { roundTo } from "@/lib/format";
import { mergeByAddress } from "../heuristics/entropy-math";

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
 * UTXOs sharing an address are merged first (Boltzmann MERGE_INPUTS /
 * MERGE_OUTPUTS, as H5 applies it): one owner's coins are one party. The
 * returned matrix keeps one row per vin and one column per spendable output,
 * each carrying its address group's links.
 *
 * Exact enumeration is limited to <= 4 merged inputs and <= 4 merged outputs
 * (Bell(4)^2 partition pairs x 4! matchings); larger txs are left to the WASM
 * Boltzmann.
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
    for (const [b, mask] of blocks.entries()) {
      blocks[b] = mask | (1 << i);
      rec(i + 1);
      blocks[b] = mask;
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
  for (const [i, v] of values.entries()) if (mask & (1 << i)) s += v;
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
  if (tx.vin.length < 1) return null;
  if (tx.vin.some((v) => v.prevout == null)) return null;

  const spendable = getSpendableOutputs(tx.vout);
  const { values: inputValues, groupOf: inGroup } =
    mergeByAddress(tx.vin.map((v) => ({ address: v.prevout!.scriptpubkey_address, value: v.prevout!.value })));
  const { values: outputValues, groupOf: outGroup } =
    mergeByAddress(spendable.map((o) => ({ address: o.scriptpubkey_address, value: o.value })));
  const nIn = inputValues.length;
  const nOut = outputValues.length;
  if (nIn > MAX_EXACT || nOut < 1 || nOut > MAX_EXACT) return null;

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
      const pairs: Array<[inMask: number, outMask: number]> = [];
      const match = (k: number, used: number) => {
        const inBlock = inBlocks[k];
        if (!inBlock) {
          // Every input block is paired: one interpretation
          totalInterpretations++;
          for (const [inMask, outMask] of pairs) {
            for (const [i, row] of linkCounts.entries()) {
              if (!(inMask & (1 << i))) continue;
              for (const o of row.keys()) {
                if (outMask & (1 << o)) row[o]!++;
              }
            }
          }
          return;
        }
        for (const [j, outBlock] of outBlocks.entries()) {
          if (used & (1 << j) || inBlock.sum < outBlock.sum) continue;
          pairs.push([inBlock.mask, outBlock.mask]);
          match(k + 1, used | (1 << j));
          pairs.pop();
        }
      };
      match(0, 0);
    }
  }

  // Outputs exceed inputs (bad data): no valid interpretation
  if (totalInterpretations === 0) return null;

  // Links are counted per address group; the matrix spreads them back per vin/vout
  let deterministicLinks = 0;
  for (const row of linkCounts) for (const count of row) if (count === totalInterpretations) deterministicLinks++;
  const matrix: LinkabilityCell[][] = inGroup.map((gi, i) =>
    outGroup.map((go, j) => {
      const count = linkCounts[gi]![go]!;
      return {
        inputIndex: i,
        outputIndex: j,
        probability: roundTo(count / totalInterpretations),
        deterministic: count === totalInterpretations,
      };
    }),
  );

  // Nothing to report when there is no link to hide: N === 1 (every 1-in tx,
  // all inputs on one address, and any tx only valid as one merged transfer)
  // is zero entropy that H5 already scores; a single output is funded by all
  // inputs even when a dust input can be a fee-only block (N = 2). Ambiguity
  // (N > 1) is H5's entropy reward, so only links that stay deterministic
  // despite other interpretations are reported.
  if (totalInterpretations === 1 || nOut === 1) {
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

      for (const [gi, row] of linkCounts.entries()) {
        for (const [go, count] of row.entries()) {
          if (!equalIndices.has(go) && count === totalInterpretations) {
            deterministicNonEqual.push({ input: gi, output: go });
          }
        }
      }

      if (deterministicNonEqual.length > 0) {
        // Name each address group by its original vin/vout indices
        const members = (groupOf: number[], g: number, label: string) =>
          groupOf.flatMap((x, k) => (x === g ? [`${label}[${k}]`] : [])).join("+");
        const pairDesc = deterministicNonEqual
          .map((p) => `${members(inGroup, p.input, "input")} -> ${members(outGroup, p.output, "output")}`)
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
  for (const [i, value] of values.entries()) {
    const arr = byValue.get(value) ?? [];
    arr.push(i);
    byValue.set(value, arr);
  }
  return [...byValue.values()].filter((group) => group.length >= 3);
}
