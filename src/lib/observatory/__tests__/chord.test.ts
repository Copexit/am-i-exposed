import { describe, it, expect } from "vitest";
import flow7d from "./fixtures/wabisator/flow-map-7d.json";
import type { FlowMap } from "../wabisator-types";
import { buildScene, type Flow } from "../sky-model";
import { allocate, arcPath, chordLayout, rankFlows, ribbonPath } from "../chord";

const scene = buildScene(flow7d.result as unknown as FlowMap, null);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const f = (from: string, to: string, btc: number, coins = 1): Flow => ({ from, to, btc, coins, internal: from === to });

describe("allocate", () => {
  it("splits proportionally, floors small parts at min, and always sums to the total", () => {
    const out = allocate([1000, 10, 1], 100, 5);
    expect(sum(out)).toBeCloseTo(100, 9);
    expect(out[1]).toBe(5);
    expect(out[2]).toBe(5);
    expect(out[0]).toBeCloseTo(90, 9);
    expect(allocate([3, 1], 8, 1)).toEqual([6, 2]);
  });

  it("splits evenly when the floor cannot fit, and handles empty input", () => {
    expect(allocate([5, 1, 1], 2, 1)).toEqual([2 / 3, 2 / 3, 2 / 3]);
    expect(allocate([], 10, 1)).toEqual([]);
  });
});

describe("chordLayout", () => {
  const gap = 0.04;
  const { groups, ribbons } = chordLayout(scene.flows, { gap });

  it("arc angles sum to 2 pi minus the gaps, largest coordinator first, no overlap", () => {
    expect(sum(groups.map((g) => g.a1 - g.a0))).toBeCloseTo(2 * Math.PI - groups.length * gap, 9);
    expect(groups[0]!.key).toBe("kruw");
    for (let i = 1; i < groups.length; i++) expect(groups[i]!.a0).toBeCloseTo(groups[i - 1]!.a1 + gap, 9);
    expect(groups.at(-1)!.a1).toBeLessThanOrEqual(2 * Math.PI);
    // Zero-BTC self-flows (coinjoiner) make no arc.
    expect(groups.map((g) => g.key)).not.toContain("swisscoordinator");
  });

  it("totals per coordinator: internal, in and out, with coins", () => {
    const oc = groups.find((g) => g.key === "opencoordinator")!;
    expect(oc.internalBtc).toBeCloseTo(122.2, 1);
    expect(oc.outBtc).toBeCloseTo(23.71, 2);
    expect(oc.inBtc).toBeCloseTo(2.84, 2);
    expect(oc.total).toBeCloseTo(oc.internalBtc + oc.inBtc + oc.outBtc, 9);
    expect(oc.outCoins).toBe(777);
  });

  it("internal remix is an inner span of the arc, never a ribbon; ends share one BTC scale and fit the arc", () => {
    expect(ribbons.every((r) => r.from !== r.to)).toBe(true);
    expect(ribbons).toHaveLength(scene.flows.filter((x) => !x.internal && x.btc > 0).length);
    for (const g of groups) {
      const own = ribbons.flatMap((r) => [r.from === g.key ? r.source : null, r.to === g.key ? r.target : null]).filter((s) => s !== null);
      const parts = [...own, ...(g.internal ? [g.internal] : [])];
      for (const s of parts) {
        expect(s.a0).toBeGreaterThanOrEqual(g.a0 - 1e-9);
        expect(s.a1).toBeLessThanOrEqual(g.a1 + 1e-9);
      }
      expect(sum(parts.map((s) => s.a1 - s.a0))).toBeLessThanOrEqual(g.a1 - g.a0 + 1e-9);
    }
    // Same BTC, same width at both ends, also at a floored (padded) coordinator.
    const big = ribbons.find((r) => r.from === "opencoordinator" && r.to === "kruw")!;
    expect(big.source.a1 - big.source.a0).toBeCloseTo(big.target.a1 - big.target.a0, 9);
    const tiny = ribbons.find((r) => r.from === "kruw" && r.to === "coinjoiner")!;
    expect(tiny.target.a1 - tiny.target.a0).toBeCloseTo(0.012, 9);
    const kruw = groups[0]!;
    expect(kruw.internal!.a1 - kruw.internal!.a0).toBeGreaterThan(0.9 * (kruw.a1 - kruw.a0));
  });

  it("keeps a tiny coordinator visible with the minimum arc", () => {
    const small = chordLayout([f("a", "a", 1000), f("b", "a", 0.001)], { gap: 0, minGroup: 0.2 });
    expect(small.groups.find((g) => g.key === "b")!.a1 - small.groups.find((g) => g.key === "b")!.a0).toBeCloseTo(0.2, 9);
  });

  it("is empty without flows", () => {
    expect(chordLayout([])).toEqual({ groups: [], ribbons: [] });
  });
});

describe("paths", () => {
  it("draws closed SVG paths, with the large-arc flag for spans over pi", () => {
    expect(arcPath(10, 12, { a0: 0, a1: Math.PI / 2 })).toMatch(/^M0\.00 -12\.00A12 12 0 0 1 12\.00 -0\.00L10\.00 -0\.00A10 10 0 0 0 .*Z$/);
    expect(arcPath(10, 12, { a0: 0, a1: 4 })).toContain("A12 12 0 1 1");
    expect(ribbonPath(10, { a0: 0, a1: 0.1 }, { a0: 3, a1: 3.1 })).toMatch(/^M.*Q.*Q.*Z$/);
    // Opposite ends curve through the centre; near neighbours bow out toward the rim.
    expect(ribbonPath(10, { a0: 0, a1: 0 }, { a0: Math.PI, a1: Math.PI })).toContain("Q0.00 0.00");
    expect(ribbonPath(10, { a0: 0, a1: 0 }, { a0: 0.2, a1: 0.2 })).toMatch(/Q0\.6\d -6\.\d\d/);
  });
});

describe("rankFlows", () => {
  it("ranks cross flows by BTC, then internal remix, dropping zero flows", () => {
    const { cross, internal } = rankFlows(scene.flows);
    expect(cross.map((x) => `${x.from}>${x.to}`).slice(0, 2)).toEqual(["opencoordinator>kruw", "kruw>opencoordinator"]);
    expect(cross.every((x, i) => i === 0 || cross[i - 1]!.btc >= x.btc)).toBe(true);
    expect(internal[0]!.from).toBe("kruw");
    expect(internal.every((x) => x.internal && x.btc > 0)).toBe(true);
  });
});
