import { describe, it, expect, beforeEach } from "vitest";
import { analyzeForward } from "../forward";
import type { MempoolTransaction } from "@/lib/api/types";
import { makeTx, makeVin, makeVout, makeOutspend, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

const TX0_ID = "0e".repeat(32);
const OTHER = (n: number) => n.toString(16).padStart(64, "f");

/** Whirlpool tx0: 3 x 1M premix outputs (idx 0-2), 50k coordinator fee (idx 3), 448.5k toxic change (idx 4). */
function makeTx0(): MempoolTransaction {
  return makeTx({
    txid: TX0_ID,
    vin: [makeVin({ txid: OTHER(1) })],
    vout: [
      makeVout({ value: 1_000_000 }),
      makeVout({ value: 1_000_000 }),
      makeVout({ value: 1_000_000 }),
      makeVout({ value: 50_000 }),
      makeVout({ value: 448_500 }),
    ],
  });
}

function spentBy(childTxid: string, n: number, spentIdx: number[]) {
  return Array.from({ length: n }, (_, i) =>
    spentIdx.includes(i) ? makeOutspend({ spent: true, txid: childTxid, vin: 0 }) : makeOutspend(),
  );
}

describe("analyzeForward - toxic change merge", () => {
  it("flags toxic change spent together with inputs from other transactions", () => {
    const tx0 = makeTx0();
    const child = makeTx({
      txid: OTHER(2),
      vin: [makeVin({ txid: TX0_ID, vout: 4 }), makeVin({ txid: OTHER(3), vout: 0 })],
      vout: [makeVout({ value: 1_400_000 })],
    });
    const res = analyzeForward(tx0, spentBy(child.txid, 5, [4]), new Map([[4, child]]));
    expect(res.toxicMergeOutputs).toEqual([4]);
    const f = res.findings.find((x) => x.id === "chain-toxic-merge");
    expect(f?.severity).toBe("critical");
    expect(f?.scoreImpact).toBe(-20);
    expect(f?.params?.mergeCount).toBe(1);
  });

  it("does not flag premix outputs that enter a Whirlpool mix (normal remix flow)", () => {
    const tx0 = makeTx0();
    // Whirlpool mix: 5 inputs of 1M from 5 different tx0s, 5 equal outputs
    const mix = makeTx({
      txid: OTHER(4),
      vin: [makeVin({ txid: TX0_ID, vout: 0 }), ...[5, 6, 7, 8].map((n) => makeVin({ txid: OTHER(n), vout: 0 }))],
      vout: Array.from({ length: 5 }, () => makeVout({ value: 1_000_000 })),
    });
    const res = analyzeForward(tx0, spentBy(mix.txid, 5, [0]), new Map([[0, mix]]));
    expect(res.toxicMergeOutputs).toEqual([]);
    expect(res.findings.some((x) => x.id === "chain-toxic-merge")).toBe(false);
  });

  it("does not flag toxic change spent alone", () => {
    const tx0 = makeTx0();
    const child = makeTx({ txid: OTHER(9), vin: [makeVin({ txid: TX0_ID, vout: 4 })], vout: [makeVout()] });
    const res = analyzeForward(tx0, spentBy(child.txid, 5, [4]), new Map([[4, child]]));
    expect(res.toxicMergeOutputs).toEqual([]);
  });

  it("does not run toxic merge detection for non-tx0 parents", () => {
    const tx = makeTx({ txid: OTHER(10) });
    const child = makeTx({
      txid: OTHER(11),
      vin: [makeVin({ txid: tx.txid, vout: 0 }), makeVin({ txid: OTHER(12) })],
      vout: [makeVout()],
    });
    const res = analyzeForward(tx, spentBy(child.txid, 2, [0]), new Map([[0, child]]));
    expect(res.toxicMergeOutputs).toEqual([]);
  });
});

describe("analyzeForward - peel chain edges", () => {
  function peelChild(values: [number, number]) {
    return makeTx({ txid: OTHER(20), vin: [makeVin()], vout: values.map((value) => makeVout({ value })) });
  }

  it("flags a 1-in/2-out child with ratio below 0.3", () => {
    const tx = makeTx({ txid: OTHER(21) });
    const res = analyzeForward(tx, spentBy(OTHER(20), 2, [1]), new Map([[1, peelChild([10_000, 90_000])]]));
    expect(res.peelChainOutputs).toEqual([1]);
    const f = res.findings.find((x) => x.id === "chain-forward-peel");
    expect(f?.scoreImpact).toBe(-5);
    expect(f?.params?.peelCount).toBe(1);
  });

  it("does not flag a balanced 1-in/2-out child (ratio >= 0.3)", () => {
    const tx = makeTx({ txid: OTHER(21) });
    const res = analyzeForward(tx, spentBy(OTHER(20), 2, [1]), new Map([[1, peelChild([30_000, 100_000])]]));
    expect(res.peelChainOutputs).toEqual([]);
  });

  it("does not flag a zero-value output split (ratio 0)", () => {
    const tx = makeTx({ txid: OTHER(21) });
    const res = analyzeForward(tx, spentBy(OTHER(20), 2, [1]), new Map([[1, peelChild([0, 90_000])]]));
    expect(res.peelChainOutputs).toEqual([]);
  });

  it("skips peel detection when the parent is a CoinJoin", () => {
    const cj = makeTx({
      txid: OTHER(22),
      vin: Array.from({ length: 5 }, (_, i) => makeVin({ txid: OTHER(30 + i) })),
      vout: Array.from({ length: 5 }, () => makeVout({ value: 100_000 })),
    });
    const res = analyzeForward(cj, spentBy(OTHER(20), 5, [0]), new Map([[0, peelChild([10_000, 89_000])]]));
    expect(res.peelChainOutputs).toEqual([]);
  });

  it("ignores children whose outspend is not marked spent", () => {
    const tx = makeTx({ txid: OTHER(21) });
    const res = analyzeForward(tx, [makeOutspend(), makeOutspend()], new Map([[1, peelChild([10_000, 90_000])]]));
    expect(res.findings).toEqual([]);
  });
});

describe("analyzeForward - consolidation params", () => {
  it("serializes consolidation groups with values and child txid", () => {
    const cjId = OTHER(40);
    const cj = makeTx({
      txid: cjId,
      vin: Array.from({ length: 5 }, (_, i) => makeVin({ txid: OTHER(50 + i) })),
      vout: Array.from({ length: 5 }, () => makeVout({ value: 100_000 })),
    });
    const childId = OTHER(41);
    const child = makeTx({
      txid: childId,
      vin: [makeVin({ txid: cjId, vout: 1 }), makeVin({ txid: cjId, vout: 3 })],
      vout: [makeVout({ value: 199_000 })],
    });
    const outspends = spentBy(childId, 5, [1, 3]);
    const res = analyzeForward(cj, outspends, new Map([[1, child], [3, child]]));
    expect(res.consolidatedCoinJoinOutputs).toEqual([1, 3]);
    const f = res.findings.find((x) => x.id === "chain-post-coinjoin-consolidation");
    expect(f?.params?.consolidatedIndices).toBe("1,3");
    expect(f?.params?.childTxid).toBe(childId);
    expect(JSON.parse(String(f?.params?._consolidationGroups))).toEqual([
      { childTxid: childId, outputs: [{ index: 1, value: 100_000 }, { index: 3, value: 100_000 }] },
    ]);
    expect(f?.description).toContain("#1 (100,000 sats), #3 (100,000 sats)");
  });
});
