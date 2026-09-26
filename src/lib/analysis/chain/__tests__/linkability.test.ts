import { describe, it, expect, beforeEach } from "vitest";
import { buildLinkabilityMatrix } from "../linkability";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";
import type { MempoolVin } from "@/lib/api/types";

beforeEach(() => resetAddrCounter());

function tx(inputs: number[], outputs: number[]) {
  return makeTx({
    vin: inputs.map((value, i) => {
      const vin = makeVin({ txid: i.toString(16).padStart(64, "0") });
      return { ...vin, prevout: { ...vin.prevout!, value } };
    }),
    vout: outputs.map((value) => makeVout({ value })),
    fee: inputs.reduce((s, v) => s + v, 0) - outputs.reduce((s, v) => s + v, 0),
  });
}

/** Link counts per [output][input] (Boltzmann mat_lnk orientation). */
function linkCounts(inputs: number[], outputs: number[]) {
  const r = buildLinkabilityMatrix(tx(inputs, outputs))!;
  return {
    n: r.totalInterpretations,
    mat: outputs.map((_, o) => inputs.map((_, i) => Math.round(r.matrix[i]![o]!.probability * r.totalInterpretations))),
  };
}

describe("buildLinkabilityMatrix - Boltzmann LPM (boltzmann-rs/tests/known_txs.rs vectors)", () => {
  it("equal-value swap 2x2: 2 interpretations", () => {
    expect(linkCounts([4_900_000_000, 100_000_000], [4_900_000_000, 100_000_000]))
      .toEqual({ n: 2, mat: [[2, 1], [1, 2]] });
  });

  it("DarkWallet CoinJoin 2x4 (fee 60k): 3 interpretations", () => {
    // Rust sorts outputs by value; here outputs keep tx order
    expect(linkCounts([10_000_000, 1_380_000], [100_000, 9_850_000, 100_000, 1_270_000]))
      .toEqual({ n: 3, mat: [[2, 2], [3, 1], [2, 2], [1, 3]] });
  });

  it("testCaseB 2x4: 5 interpretations", () => {
    expect(linkCounts([10, 10], [8, 2, 2, 8])).toEqual({ n: 5, mat: [[3, 3], [3, 3], [3, 3], [3, 3]] });
  });

  it("perfect CoinJoin 3x3 and 4x4: 16 and 131 interpretations", () => {
    expect(linkCounts([5, 5, 5], [5, 5, 5])).toEqual({ n: 16, mat: [[8, 8, 8], [8, 8, 8], [8, 8, 8]] });
    expect(linkCounts([5, 5, 5, 5], [5, 5, 5, 5]).n).toBe(131);
    expect(linkCounts([5, 5, 5, 5], [5, 5, 5, 5]).mat[0]).toEqual([53, 53, 53, 53]);
  });

  it("P3 with fees and P3b: 28 and 9 interpretations", () => {
    expect(linkCounts([5, 5, 5], [5, 3, 2]).n).toBe(28);
    expect(linkCounts([5, 5, 10], [5, 5, 10]).n).toBe(9);
  });

  it("trivial 1-in/2-out: 1 interpretation, every link deterministic", () => {
    const r = buildLinkabilityMatrix(tx([200_000], [100_000, 90_000]))!;
    expect(r.totalInterpretations).toBe(1);
    expect(r.deterministicLinks).toBe(2);
  });
});

describe("buildLinkabilityMatrix - findings", () => {
  it("1-in/2-out payment: no finding (zero entropy is H5's job, never 'ambiguous')", () => {
    expect(buildLinkabilityMatrix(tx([100_000], [48_000, 50_000]))!.findings).toEqual([]);
  });

  it("3-in/1-out consolidation: no deterministic finding", () => {
    expect(buildLinkabilityMatrix(tx([100_000, 100_000, 100_000], [298_000]))!.findings).toEqual([]);
  });

  it("1-output sweep with a dust input below the fee: no finding", () => {
    // The dust input can be a fee-only block (N = 2), but a single output has no link to hide
    expect(buildLinkabilityMatrix(tx([100_000, 546], [99_000]))!.findings).toEqual([]);
    expect(buildLinkabilityMatrix(tx([100_000, 100_000, 546], [199_000]))!.findings).toEqual([]);
  });

  it("2-in/2-out where both inputs share one address: no finding (single owner, as H5 merges)", () => {
    const t = tx([100_000, 50_000], [90_000, 40_000]);
    const [first, second] = t.vin as [MempoolVin, MempoolVin];
    const addr = first.prevout!.scriptpubkey_address;
    t.vin[1] = { ...second, prevout: { ...second.prevout!, scriptpubkey_address: addr } };
    expect(buildLinkabilityMatrix(t)!.findings).toEqual([]);
  });

  it("merges inputs sharing an address: 3-in with 2 on one address matches the 2-in tx", () => {
    const three = tx([60_000, 50_000, 40_000], [90_000, 40_000]);
    const [a, , c] = three.vin as [MempoolVin, MempoolVin, MempoolVin];
    three.vin[2] = { ...c, prevout: { ...c.prevout!, scriptpubkey_address: a.prevout!.scriptpubkey_address } };
    const merged = buildLinkabilityMatrix(three)!;
    const two = buildLinkabilityMatrix(tx([100_000, 50_000], [90_000, 40_000]))!;

    expect(merged.totalInterpretations).toBe(two.totalInterpretations);
    expect(merged.deterministicLinks).toBe(two.deterministicLinks);
    expect(merged.findings).toEqual(two.findings);
    // The matrix keeps one row per vin: both coins of the shared address carry its links
    expect(merged.matrix).toHaveLength(3);
    expect(merged.matrix[2]).toEqual(merged.matrix[0]!.map((cell) => ({ ...cell, inputIndex: 2 })));
  });

  it("merges outputs sharing an address before enumeration", () => {
    const t = tx([100_000, 50_000], [60_000, 40_000, 30_000]);
    const [x, , z] = t.vout;
    t.vout[2] = { ...z!, scriptpubkey_address: x!.scriptpubkey_address };
    const merged = buildLinkabilityMatrix(t)!;
    const two = buildLinkabilityMatrix(tx([100_000, 50_000], [90_000, 40_000]))!;
    expect(merged.totalInterpretations).toBe(two.totalInterpretations);
    expect(merged.findings).toEqual(two.findings);
  });

  it("2-in/2-out where only the merged interpretation is valid: no finding", () => {
    // Neither input alone funds either output
    expect(buildLinkabilityMatrix(tx([50_000, 30_000], [40_000, 39_000]))!.findings).toEqual([]);
  });

  it("2-in/2-out with one valid split: reports the 2 deterministic links", () => {
    const r = buildLinkabilityMatrix(tx([100_000, 50_000], [90_000, 40_000]))!;
    expect(r.totalInterpretations).toBe(2);
    const f = r.findings.find((x) => x.id === "linkability-deterministic");
    expect(f).toMatchObject({ severity: "critical", scoreImpact: -6, params: { deterministicLinks: 2 } });
  });

  it("Stonewall-like 4x4: no deterministic link, and not rewarded as ambiguous", () => {
    // A: 60k + 45k, B: 55k + 40k; 2 x 50k equal outputs, changes 54k (A) and 44k (B), fee 2k
    const r = buildLinkabilityMatrix(tx([60_000, 45_000, 55_000, 40_000], [50_000, 50_000, 54_000, 44_000]))!;
    expect(r.totalInterpretations).toBeGreaterThan(1);
    expect(r.deterministicLinks).toBe(0);
    expect(r.findings).toEqual([]);
  });

  it("equal 3x3: no finding (its entropy is rewarded by H5, not a second time here)", () => {
    const r = buildLinkabilityMatrix(tx([50_000, 50_000, 50_000], [49_000, 49_000, 49_000]))!;
    expect(r.totalInterpretations).toBe(16);
    expect(r.deterministicLinks).toBe(0);
    expect(r.findings).toEqual([]);
  });

  it("equal-subset: 3 equal outputs + 1 deterministically linked unique output", () => {
    // Only input[0] (10k) can fund the 5k output on its own; the 50k inputs fund the 50k outputs
    const r = buildLinkabilityMatrix(tx([10_000, 50_000, 50_000, 50_000], [50_000, 50_000, 50_000, 5_000]))!;
    expect(r.totalInterpretations).toBeGreaterThan(1);
    expect(r.matrix[0]?.[3]?.deterministic).toBe(true);
    expect(r.findings.find((f) => f.id === "linkability-equal-subset")).toMatchObject({ severity: "medium" });
  });

  it("does NOT produce equal-subset when unique outputs are not deterministic", () => {
    const r = buildLinkabilityMatrix(tx([100_000, 100_000, 100_000], [50_000, 50_000, 50_000, 30_000]))!;
    expect(r.findings.find((f) => f.id === "linkability-equal-subset")).toBeUndefined();
  });
});

describe("buildLinkabilityMatrix - skipped txs", () => {
  it("returns null for coinbase", () => {
    const cb: MempoolVin = { txid: "0".repeat(64), vout: 0xffffffff, prevout: null, scriptsig: "", scriptsig_asm: "", is_coinbase: true, sequence: 0xffffffff };
    expect(buildLinkabilityMatrix(makeTx({ vin: [cb] }))).toBeNull();
  });

  it("returns null above the exact-enumeration limit (5 inputs)", () => {
    expect(buildLinkabilityMatrix(tx([1, 1, 1, 1, 1].map((v) => v * 10_000), [40_000]))).toBeNull();
  });

  it("returns null when a prevout value is missing", () => {
    const t = tx([100_000, 50_000], [90_000, 40_000]);
    t.vin[1] = { ...t.vin[1]!, prevout: null };
    expect(buildLinkabilityMatrix(t)).toBeNull();
  });
});
