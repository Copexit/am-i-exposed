import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MempoolTransaction } from "@/lib/api/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { ConnectionPath } from "../connection-search";
import { scorePath } from "../path-scoring";
import { makeTx, makeVin, makeVout } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

const mocks = vi.hoisted(() => ({
  change: vi.fn(),
  coinJoin: vi.fn(),
}));
vi.mock("@/lib/analysis/heuristics/change-detection", () => ({ analyzeChangeDetection: mocks.change }));
vi.mock("@/lib/analysis/heuristics/coinjoin", () => ({ isCoinJoinTx: mocks.coinJoin }));

beforeEach(() => {
  mocks.change.mockReset().mockReturnValue({ findings: [] });
  mocks.coinJoin.mockReset().mockReturnValue(false);
});

function tx(txid: string, nIn: number, nOut: number, values?: { in?: number[]; out?: number[] }): MempoolTransaction {
  const t = makeTx({
    txid,
    vin: Array.from({ length: nIn }, (_, i) => makeVin({ vout: i })),
    vout: Array.from({ length: nOut }, (_, i) => makeVout({ value: values?.out?.[i] ?? 10_000 })),
  });
  return t;
}
const map = (...ts: MempoolTransaction[]) => new Map(ts.map((t) => [t.txid, t]));
const none = new Map<string, BoltzmannWorkerResult>();
const linear = (...hops: ConnectionPath["hops"]): ConnectionPath => ({ kind: "a-funds-b", hops, meetTxid: "", });
const mat = (m: number[][]) => new Map([["m", { matLnkProbabilities: m } as BoltzmannWorkerResult]]);

describe("scorePath", () => {
  it("excludes endpoints and scores 1 for a 1-input or 1-output hop", () => {
    const s = scorePath(
      linear({ txid: "a", outIndex: 0 }, { txid: "m", inIndex: 0, outIndex: 1 }, { txid: "b", inIndex: 0 }),
      map(tx("a", 1, 2), tx("m", 1, 3), tx("b", 2, 2)), none);
    expect(s.hops).toEqual([{ txid: "m", probability: 1, basis: "deterministic" }]);
    expect(s.tier).toBe("deterministic");
    expect(s.estimated).toBe(false);
  });

  it("uses the Boltzmann cell [out][in] as delivered (submitted order, not sorted)", () => {
    // outputs ascending by value, so a value-sorted matrix would differ from the real index
    const m = tx("m", 2, 3, { out: [1_000, 2_000, 3_000] });
    const cache = mat([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]);
    const s = scorePath(linear({ txid: "a", outIndex: 0 }, { txid: "m", inIndex: 1, outIndex: 2 }, { txid: "b", inIndex: 0 }), map(m), cache);
    expect(s.hops[0]).toEqual({ txid: "m", probability: 0.6, basis: "boltzmann" });
    expect(s.estimated).toBe(false);
    expect(s.tier).toBe("likely");
  });

  it("a Boltzmann cell of exactly 1 is deterministic", () => {
    const m = tx("m", 2, 3, { out: [1_000, 2_000, 3_000] });
    const cache = mat([[0, 1], [1, 0], [0.5, 0.5]]);
    const s = scorePath(linear({ txid: "a", outIndex: 0 }, { txid: "m", inIndex: 1, outIndex: 0 }, { txid: "b", inIndex: 0 }), map(m), cache);
    expect(s.hops[0]).toEqual({ txid: "m", probability: 1, basis: "deterministic" });
    expect(s.tier).toBe("deterministic");
  });

  it.each([["high", 0.8], ["medium", 0.65], ["low", 0.55]])("maps %s change confidence to %d", (conf, p) => {
    mocks.change.mockReturnValue({ findings: [{ id: "h2-change-detected", params: { confidence: conf, changeIndex: 1 } }] });
    const path = linear({ txid: "a", outIndex: 0 }, { txid: "m", inIndex: 0, outIndex: 1 }, { txid: "b", inIndex: 0 });
    const s = scorePath(path, map(tx("m", 2, 2)), none);
    expect(s.hops[0]).toEqual({ txid: "m", probability: p, basis: "change" });
    expect(s.estimated).toBe(true);
  });

  it("ignores change flags on a different output and falls back to 1/max(in,out)", () => {
    mocks.change.mockReturnValue({ findings: [{ id: "h2-change-detected", params: { confidence: "high", changeIndex: 0 } }] });
    const path = linear({ txid: "a", outIndex: 0 }, { txid: "m", inIndex: 0, outIndex: 1 }, { txid: "b", inIndex: 0 });
    const s = scorePath(path, map(tx("m", 2, 4)), none);
    expect(s.hops[0]).toEqual({ txid: "m", probability: 0.25, basis: "estimate" });
  });

  it("multiplies hops and applies tier boundaries", () => {
    const hops = [{ txid: "a", outIndex: 0 }, { txid: "m", inIndex: 0, outIndex: 1 }, { txid: "n", inIndex: 0, outIndex: 1 }, { txid: "b", inIndex: 0 }];
    const cache = new Map([
      ["m", { matLnkProbabilities: [[0], [0.5]] } as BoltzmannWorkerResult],
      ["n", { matLnkProbabilities: [[0], [1]] } as BoltzmannWorkerResult],
    ]);
    const txs = map(tx("m", 2, 2), tx("n", 2, 2));
    expect(scorePath(linear(...hops), txs, cache)).toMatchObject({ compound: 0.5, tier: "likely" });
    cache.set("n", { matLnkProbabilities: [[0], [0.2]] } as BoltzmannWorkerResult);
    expect(scorePath(linear(...hops), txs, cache)).toMatchObject({ tier: "weak" });
    const exact = scorePath(linear(...hops), txs, new Map([
      ["m", { matLnkProbabilities: [[0], [0.5]] } as BoltzmannWorkerResult],
      ["n", { matLnkProbabilities: [[0], [0.2]] } as BoltzmannWorkerResult]]));
    expect(exact.compound).toBeCloseTo(0.1);
    const low = scorePath(linear(...hops), txs, new Map([
      ["m", { matLnkProbabilities: [[0], [0.5]] } as BoltzmannWorkerResult],
      ["n", { matLnkProbabilities: [[0], [0.19]] } as BoltzmannWorkerResult]]));
    expect(low.tier).toBe("ambiguous");
  });

  it("scores a boundary of exactly 0.5 and 0.1 via products as likely and weak", () => {
    const hops = [{ txid: "a", outIndex: 0 }, { txid: "m", inIndex: 0, outIndex: 1 }, { txid: "b", inIndex: 0 }];
    const run = (p: number) => scorePath(linear(...hops), map(tx("m", 2, 2)), new Map([["m", { matLnkProbabilities: [[0], [p]] } as BoltzmannWorkerResult]]));
    expect(run(0.5).tier).toBe("likely");
    expect(run(0.499).tier).toBe("weak");
    expect(run(0.1).tier).toBe("weak");
    expect(run(0.099).tier).toBe("ambiguous");
  });

  describe("bent paths", () => {
    it("shared-ancestor: the pivot origin is not scored; B-side hops use their own indices", () => {
      const path: ConnectionPath = {
        kind: "shared-ancestor", meetTxid: "p", pivot: 1, pivotLink: { outIndex: 1 },
        hops: [{ txid: "a", inIndex: 0 }, { txid: "p", outIndex: 0 }, { txid: "x", inIndex: 0, outIndex: 0 }, { txid: "b", inIndex: 0 }],
      };
      const s = scorePath(path, map(tx("p", 1, 3), tx("x", 1, 2)), none);
      expect(s.hops.map((h) => h.txid)).toEqual(["x"]);
    });

    it("shared-descendant: co-spent pivot is deterministic", () => {
      const path: ConnectionPath = {
        kind: "shared-descendant", meetTxid: "p", pivot: 1, pivotLink: { inIndex: 1 },
        hops: [{ txid: "a", outIndex: 0 }, { txid: "p", inIndex: 0 }, { txid: "b", outIndex: 0 }],
      };
      const s = scorePath(path, map(tx("p", 3, 2)), none);
      expect(s.hops).toEqual([{ txid: "p", probability: 1, basis: "deterministic" }]);
      expect(s.tier).toBe("deterministic");
    });

    it("shared-descendant: a CoinJoin pivot is 1/vin.length estimate", () => {
      mocks.coinJoin.mockReturnValue(true);
      const path: ConnectionPath = {
        kind: "shared-descendant", meetTxid: "p", pivot: 1, pivotLink: { inIndex: 1 },
        hops: [{ txid: "a", outIndex: 0 }, { txid: "p", inIndex: 0 }, { txid: "b", outIndex: 0 }],
      };
      const s = scorePath(path, map(tx("p", 5, 5)), none);
      expect(s.hops).toEqual([{ txid: "p", probability: 0.2, basis: "estimate" }]);
      expect(s.estimated).toBe(true);
    });

    it("an unfetched pivot is scored as an estimate", () => {
      const path: ConnectionPath = {
        kind: "shared-descendant", meetTxid: "p", pivot: 1, pivotLink: { inIndex: 1 }, unverified: true,
        hops: [{ txid: "a", outIndex: 0 }, { txid: "p", inIndex: 0 }, { txid: "b", outIndex: 0 }],
      };
      const s = scorePath(path, map(), none);
      expect(s.hops[0]).toMatchObject({ txid: "p", basis: "estimate" });
    });
  });
});
