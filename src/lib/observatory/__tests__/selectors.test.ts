import { describe, it, expect } from "vitest";
import {
  downsampleSeries,
  liquiSabiFreshInputSparkline,
  projectCoordinators,
  sumRecentFreshInputs,
  sumRecentRoundCount,
  unpaidCoordinators,
  whirlpool30dDelta,
  whirlpoolCurrentCapacity,
  whirlpoolSparkline,
  whirlpoolTotalCurrentCapacity,
} from "../selectors";
import chartsFixture from "./fixtures/whirlpool-charts.json";
import dashboardFixture from "./fixtures/liquisabi-dashboard.json";
import type { LiquiSabiDashboard, WhirlpoolCharts } from "../types";

const charts = chartsFixture as WhirlpoolCharts;
const dashboard = dashboardFixture as unknown as LiquiSabiDashboard;

describe("downsampleSeries", () => {
  it("returns the original points when below the max", () => {
    const out = downsampleSeries([1, 2, 3], [10, 20, 30], 60);
    expect(out).toEqual([
      { x: 1, y: 10 },
      { x: 2, y: 20 },
      { x: 3, y: 30 },
    ]);
  });

  it("returns empty for mismatched lengths", () => {
    expect(downsampleSeries([1, 2], [10], 60)).toEqual([]);
  });

  it("buckets large inputs down to maxPoints", () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i);
    const ys = Array.from({ length: 1000 }, () => 1);
    const out = downsampleSeries(xs, ys, 50);
    expect(out).toHaveLength(50);
    for (const point of out) {
      expect(point.y).toBeCloseTo(1, 5);
    }
  });

  it("returns [] for empty input", () => {
    expect(downsampleSeries([], [], 60)).toEqual([]);
  });
});

describe("whirlpoolSparkline", () => {
  it("returns sparkline points for a known pool key from the cumulative series", () => {
    const points = whirlpoolSparkline(charts, "0.025_BTC_Pool");
    expect(points.length).toBe(charts.blocks.length);
    expect(points[points.length - 1].y).toBe(22.95);
  });

  it("returns [] for an unknown pool key", () => {
    expect(whirlpoolSparkline(charts, "unknown_pool")).toEqual([]);
  });
});

describe("whirlpoolCurrentCapacity", () => {
  it("returns the last sample of a pool series", () => {
    expect(whirlpoolCurrentCapacity(charts, "0.025_BTC_Pool")).toBe(22.95);
    expect(whirlpoolCurrentCapacity(charts, "0.25_BTC_Pool")).toBe(95.5);
  });

  it("returns null for an unknown pool", () => {
    expect(whirlpoolCurrentCapacity(charts, "0.5_BTC_Pool")).toBeNull();
  });
});

describe("whirlpoolTotalCurrentCapacity", () => {
  it("sums the last sample across all pools", () => {
    expect(whirlpoolTotalCurrentCapacity(charts)).toBeCloseTo(22.95 + 95.5);
  });
});

describe("whirlpool30dDelta", () => {
  it("returns null if the series is shorter than 30 days of blocks", () => {
    const short = {
      blocks: [900000, 900100, 900200],
      capacity_btc: { p: [10, 11, 12] },
    };
    expect(whirlpool30dDelta(short, "p")).toBeNull();
  });

  it("returns the net change in capacity across the recent window", () => {
    // Synthesize a series where the last block is current and 4320 blocks
    // ago capacity was 10 BTC, current is 22.95 BTC.
    const blocks = [900000, 947000, 951952];
    const series = { blocks, capacity_btc: { p: [5, 10, 22.95] } };
    const delta = whirlpool30dDelta(series, "p");
    expect(delta).toBeCloseTo(12.95, 1);
  });
});

describe("liquiSabiFreshInputSparkline", () => {
  it("treats null Averages entries as zero", () => {
    const points = liquiSabiFreshInputSparkline(dashboard.Graph);
    expect(points).toHaveLength(3);
    expect(points[1].y).toBe(0);
    expect(points[0].y).toBeCloseTo(5.5);
    expect(points[2].y).toBeCloseTo(7.2);
  });

  it("returns [] for an empty graph", () => {
    expect(liquiSabiFreshInputSparkline([])).toEqual([]);
  });
});

describe("projectCoordinators", () => {
  it("flags coordinators with a positive coordination fee as paid", () => {
    const views = projectCoordinators(dashboard);
    expect(views).toHaveLength(3);
    const kruw = views.find((v) => v.name === "Kruw.io");
    const ginger = views.find((v) => v.name === "Gingerwallet");
    expect(kruw?.isPaid).toBe(false);
    expect(ginger?.isPaid).toBe(true);
  });

  it("sorts by fresh-input share descending", () => {
    const views = projectCoordinators(dashboard);
    expect(views[0].name).toBe("Kruw.io");
    expect(views.at(-1)?.name).toBe("Gingerwallet");
  });
});

describe("unpaidCoordinators", () => {
  it("filters paid coordinators out", () => {
    const views = projectCoordinators(dashboard);
    const free = unpaidCoordinators(views);
    expect(free.map((v) => v.name)).toEqual(["Kruw.io", "OpenCoordinator"]);
  });
});

describe("sumRecentFreshInputs", () => {
  it("sums fresh inputs across the recent window, skipping null entries", () => {
    expect(sumRecentFreshInputs(dashboard.Graph, 3)).toBeCloseTo(12.7);
  });

  it("returns 0 for an empty graph", () => {
    expect(sumRecentFreshInputs([], 7)).toBe(0);
  });
});

describe("sumRecentRoundCount", () => {
  it("sums numeric RoundId fields (LiquiSabi overloads it as a count)", () => {
    expect(sumRecentRoundCount(dashboard.Graph, 3)).toBe(32);
  });
});
