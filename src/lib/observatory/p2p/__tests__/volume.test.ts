import { describe, it, expect } from "vitest";
import { sumDaily, rangeSlice, athOf, shares } from "../volume";
import { robosatsHistory } from "../normalize-robosats";
import { templeHistorical, lakeHistorical } from "./fixtures";

const temple = robosatsHistory(templeHistorical);
const lake = robosatsHistory(lakeHistorical);
const today = "2026-10-07";

describe("P2P volume", () => {
  it("sums by date over the union of dates", () => {
    const sum = sumDaily([temple, lake]);
    const d = sum.find((x) => x.date === "2026-10-06")!;
    expect(d.btc).toBeCloseTo(0.189 + 0.165, 10);
    expect(d.trades).toBe(28 + 28);
    expect(sum.length).toBe(new Set([...temple, ...lake].map((x) => x.date)).size);
  });

  it("slices ranges ending today", () => {
    const sum = sumDaily([temple, lake]);
    expect(rangeSlice(sum, "30d", today).length).toBeLessThanOrEqual(30);
    expect(rangeSlice(sum, "30d", today).every((x) => x.date >= "2026-09-08")).toBe(true);
    expect(rangeSlice(sum, "1y", today).length).toBeLessThanOrEqual(365);
    expect(rangeSlice(sum, "all", today)).toHaveLength(sum.length);
  });

  it("all-time high and shares", () => {
    const ath = athOf(temple)!;
    expect(ath.volume).toBe(Math.max(...temple.map((x) => x.btc)));
    expect(athOf([])).toBeNull();
    const s = shares({ temple, lake }, "1y", today);
    expect(s.reduce((a, x) => a + x.pct, 0)).toBeCloseTo(100, 6);
    expect(s[0]!.btc).toBeGreaterThanOrEqual(s[1]!.btc);
  });
});
