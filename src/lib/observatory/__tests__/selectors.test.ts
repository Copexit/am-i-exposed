import { describe, it, expect } from "vitest";
import {
  activeCoordinators,
  downsampleSeries,
  inactiveCoordinators,
  liquiSabiFreshInputSparkline,
  projectCoordinators,
  sumRecentFreshInputs,
  toCycleRows,
  unpaidCoordinators,
  whirlpool30dDelta,
  whirlpoolLifetimeCycles,
  whirlpoolLifetimeEntered,
  whirlpoolSparkline,
  whirlpoolTotalUnspent,
} from "../selectors";
import chartsFixture from "./fixtures/whirlpool-charts.json";
import summaryFixture from "./fixtures/whirlpool-summary.json";
import txsFixture from "./fixtures/whirlpool-txs.json";
import dashboardFixture from "./fixtures/liquisabi-dashboard.json";
import type {
  CoordinatorView,
  LiquiSabiDashboard,
  WhirlpoolCharts,
  WhirlpoolSummary,
  WhirlpoolTxsPage,
} from "../types";

const charts = chartsFixture as WhirlpoolCharts;
const summary = summaryFixture as WhirlpoolSummary;
const txs = txsFixture as WhirlpoolTxsPage;
const dashboard = dashboardFixture as unknown as LiquiSabiDashboard;

function view(overrides: Partial<CoordinatorView>): CoordinatorView {
  return {
    endpoint: "https://example.test/",
    name: "Example",
    readMore: "",
    description: "",
    freshInputPercent: 0,
    roundCount: 0,
    isPaid: false,
    ...overrides,
  };
}

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
  it("returns sparkline points for a known pool key from the capacity series", () => {
    const points = whirlpoolSparkline(charts, "0.025_BTC_Pool");
    expect(points.length).toBe(charts.capacity.blocks.length);
    expect(points.at(-1)?.y).toBe(13.65);
  });

  it("returns [] for an unknown pool key", () => {
    expect(whirlpoolSparkline(charts, "unknown_pool")).toEqual([]);
  });
});

describe("whirlpool30dDelta", () => {
  it("returns null if the series is shorter than 30 days of blocks", () => {
    const short: WhirlpoolCharts = {
      capacity: { blocks: [900000, 900100, 900200], series: { p: [10, 11, 12] } },
      entered: { blocks: [], series: {} },
      entered_utxos: { blocks: [], total_utxos: [] },
      utxos: { blocks: [], total_utxos: [] },
    };
    expect(whirlpool30dDelta(short, "p")).toBeNull();
  });

  it("returns the net change in capacity across the recent window", () => {
    const blocks = [900000, 947000, 951952];
    const synth: WhirlpoolCharts = {
      capacity: { blocks, series: { p: [5, 10, 22.95] } },
      entered: { blocks: [], series: {} },
      entered_utxos: { blocks: [], total_utxos: [] },
      utxos: { blocks: [], total_utxos: [] },
    };
    expect(whirlpool30dDelta(synth, "p")).toBeCloseTo(12.95, 1);
  });
});

describe("whirlpool summary aggregates", () => {
  it("sums lifetime entered across pools", () => {
    expect(whirlpoolLifetimeEntered(summary)).toBeCloseTo(27.15 + 100.0);
  });

  it("sums lifetime cycles across pools", () => {
    expect(whirlpoolLifetimeCycles(summary)).toBe(521 + 183);
  });

  it("sums currently-unspent BTC across pools", () => {
    expect(whirlpoolTotalUnspent(summary)).toBeCloseTo(13.65 + 62.75);
  });

});

describe("toCycleRows", () => {
  it("maps txs items to rows with same-origin scan links", () => {
    const rows = toCycleRows(txs);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.txid).toBe(txs.items[0]?.txid);
    expect(rows[0]?.scanHref).toBe(`/#tx=${txs.items[0]?.txid}`);
    expect(rows[0]?.blockHeight).toBe(957584);
    expect(rows[0]?.poolLabel).toBe("0.025 BTC Pool");
    expect(rows[0]?.tx0Count).toBe(2);
  });

  it("returns [] for a null page", () => {
    expect(toCycleRows(null)).toEqual([]);
  });
});

describe("liquiSabiFreshInputSparkline", () => {
  it("treats null Averages entries as zero", () => {
    const points = liquiSabiFreshInputSparkline(dashboard.Graph);
    expect(points).toHaveLength(3);
    expect(points[1]?.y).toBe(0);
    expect(points[0]?.y).toBeCloseTo(5.5);
    expect(points[2]?.y).toBeCloseTo(7.2);
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
    expect(views[0]?.name).toBe("Kruw.io");
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

describe("activeCoordinators / inactiveCoordinators", () => {
  const views = [
    view({ name: "Live", roundCount: 42 }),
    view({ name: "Idle", roundCount: 0 }),
    view({ name: "AlsoLive", roundCount: 1 }),
  ];

  it("keeps only coordinators with rounds in the last 30 days", () => {
    expect(activeCoordinators(views).map((v) => v.name)).toEqual([
      "Live",
      "AlsoLive",
    ]);
  });

  it("keeps only coordinators idle for 30+ days", () => {
    expect(inactiveCoordinators(views).map((v) => v.name)).toEqual(["Idle"]);
  });

  it("partitions the fixture coordinators (all active) with none idle", () => {
    const projected = projectCoordinators(dashboard);
    expect(activeCoordinators(projected)).toHaveLength(3);
    expect(inactiveCoordinators(projected)).toHaveLength(0);
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
