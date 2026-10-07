import { describe, it, expect } from "vitest";
import {
  downsampleSeries,
  lastCycleBlocks,
  toCycleRows,
  whirlpool30dDelta,
  whirlpoolLifetimeCycles,
  whirlpoolLifetimeEntered,
  whirlpoolSparkline,
  whirlpoolTotalUnspent,
} from "../selectors";
import chartsFixture from "./fixtures/whirlpool-charts.json";
import summaryFixture from "./fixtures/whirlpool-summary.json";
import txsFixture from "./fixtures/whirlpool-txs.json";
import type {
  WhirlpoolCharts,
  WhirlpoolSummary,
  WhirlpoolTxsPage,
} from "../types";

const charts = chartsFixture as WhirlpoolCharts;
const summary = summaryFixture as WhirlpoolSummary;
const txs = txsFixture as WhirlpoolTxsPage;

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
    const [row] = rows;
    expect(row!.txid).toBe(txs.items[0]!.txid);
    expect(row!.scanHref).toBe(`/#tx=${txs.items[0]!.txid}`);
    expect(row!.blockHeight).toBe(957584);
    expect(row!.poolLabel).toBe("0.025 BTC Pool");
    expect(row!.tx0Count).toBe(2);
  });

  it("returns [] for a null page", () => {
    expect(toCycleRows(null)).toEqual([]);
  });
});

describe("lastCycleBlocks", () => {
  it("returns the highest block per pool", () => {
    expect(lastCycleBlocks(txs)["0.025_BTC_Pool"]).toBe(957584);
    expect(Object.keys(lastCycleBlocks(txs)).sort()).toEqual(["0.025_BTC_Pool", "0.25_BTC_Pool"]);
  });
  it("returns {} for null", () => {
    expect(lastCycleBlocks(null)).toEqual({});
  });
});
