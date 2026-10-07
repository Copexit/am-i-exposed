import { describe, it, expect } from "vitest";
import flow1dEnv from "./fixtures/wabisator/flow-map-1d.json";
import flow7dEnv from "./fixtures/wabisator/flow-map-7d.json";
import historyEnv from "./fixtures/wabisator/volume-history.json";
import { coordinatorKpis, largestCoinjoins, remixPartners, volumeSeries } from "../coordinator-page";
import type { FlowMap, VolumeHistory } from "../wabisator-types";

const flow1d = flow1dEnv.result as unknown as FlowMap;
const flow7d = flow7dEnv.result as unknown as FlowMap;
const history = historyEnv.result as unknown as VolumeHistory;
const kruwHistory = history.Coordinators.kruw!;

describe("coordinatorKpis", () => {
  it("reads kruw from flow-map and history", () => {
    const k = coordinatorKpis("kruw", flow1d, history);
    const c = flow1d.Coordinators.find((x) => x.Key === "kruw")!;
    expect(k.volume).toBe(c.Volume);
    expect(k.coinjoins).toBe(c.Coinjoins);
    expect(k.remixIn).toBe(c.RemixInBtc);
    const cjs = flow1d.Coinjoins.filter((x) => x.Coordinator === "kruw");
    const expected = cjs.reduce((s, x) => s + x.Anonset * x.Volume, 0) / cjs.reduce((s, x) => s + x.Volume, 0);
    expect(k.avgAnonset).toBeCloseTo(expected, 9);
    expect(k.allTimeVolume).toBe(kruwHistory.TotalVolume);
    expect(k.ath).toEqual({ date: kruwHistory.Ath.Date, volume: kruwHistory.Ath.Volume });
  });
  it("returns zeros and nulls for an idle or unknown coordinator", () => {
    expect(coordinatorKpis("coinjoin_nl", flow1d, null)).toMatchObject({ volume: 0, avgAnonset: null, allTimeVolume: null, ath: null });
    expect(coordinatorKpis("nope", flow1d, history)).toMatchObject({ volume: 0, coinjoins: 0, avgAnonset: null, ath: null });
  });
});

describe("largestCoinjoins", () => {
  it("sorts by volume and limits", () => {
    const top = largestCoinjoins("kruw", flow7d);
    expect(top).toHaveLength(10);
    expect(top.every((c) => c.Coordinator === "kruw")).toBe(true);
    for (let i = 1; i < top.length; i++) expect(top[i - 1]!.Volume).toBeGreaterThanOrEqual(top[i]!.Volume);
    expect(top[0]!.Volume).toBe(Math.max(...flow7d.Coinjoins.filter((c) => c.Coordinator === "kruw").map((c) => c.Volume)));
    expect(largestCoinjoins("gingerwallet", flow1d, 2)).toHaveLength(2);
  });
});

describe("remixPartners", () => {
  it("excludes internal flows", () => {
    const { into, from } = remixPartners("kruw", flow1d);
    expect(into).toEqual([{ from: "opencoordinator", to: "kruw", btc: 17.21987682, coins: 287, internal: false }]);
    expect(from).toEqual([{ from: "kruw", to: "opencoordinator", btc: 0.06377292, coins: 2, internal: false }]);
  });
});

describe("volumeSeries", () => {
  it("returns the requested window", () => {
    const today = "2026-10-07";
    const d30 = volumeSeries("kruw", history, "30d", today);
    expect(d30[0]!.date >= "2026-09-08").toBe(true);
    expect(d30.at(-1)!.date).toBe(today);
    expect(d30.length).toBeLessThanOrEqual(30);
    expect(d30.length).toBeGreaterThan(25);
    const y1 = volumeSeries("kruw", history, "1y", today);
    expect(y1[0]!.date >= "2025-10-08").toBe(true);
    expect(volumeSeries("kruw", history, "90d", today).length).toBeLessThanOrEqual(90);
    expect(volumeSeries("kruw", history, "all", today)).toHaveLength(kruwHistory.Daily.length);
    expect(volumeSeries("nope", history, "all", today)).toEqual([]);
  });
});
