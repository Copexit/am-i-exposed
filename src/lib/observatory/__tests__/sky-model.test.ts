import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import flow1dEnv from "./fixtures/wabisator/flow-map-1d.json";
import statusEnv from "./fixtures/wabisator/coordinators-status.json";
import { buildScene, layoutStars, particleBudget, replayProgress, replayTime, type SkyEvent, type Star } from "../sky-model";
import { KNOWN_COORDINATORS, coordinatorColorToken, coordinatorColorVar } from "../coordinator-palette";
import type { CoordinatorsStatus, FlowMap } from "../wabisator-types";

const flow1d = flow1dEnv.result as unknown as FlowMap;
const status = statusEnv.result as unknown as CoordinatorsStatus;
const byKey = (stars: Star[]) => (k: string) => stars.find((s) => s.key === k)!;

describe("coordinator palette", () => {
  it("maps known keys to their token and unknown ones to other", () => {
    expect(coordinatorColorVar("kruw")).toBe("var(--coord-kruw)");
    expect(coordinatorColorToken("nope")).toBe("--coord-other");
    expect(KNOWN_COORDINATORS).toHaveLength(7);
  });
  it("declares every token in both themes", () => {
    const css = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");
    for (const k of [...KNOWN_COORDINATORS, "other"]) expect(css.match(new RegExp(`--coord-${k}: #[0-9a-f]{6};`, "g"))).toHaveLength(2);
  });
});

describe("buildScene", () => {
  const scene = buildScene(flow1d, status);
  it("has one star per coordinator in the union", () => {
    const union = new Set([...flow1d.Coordinators.map((c) => c.Key), ...status.Coordinators.map((c) => c.Key)]);
    expect(scene.stars.map((s) => s.key).sort()).toEqual([...union].sort());
  });
  it("sorts events by time", () => {
    expect(scene.events).toHaveLength(flow1d.Coinjoins.length);
    for (let i = 1; i < scene.events.length; i++) expect(scene.events[i]!.t).toBeGreaterThanOrEqual(scene.events[i - 1]!.t);
  });
  it("bins sum to the period volume", () => {
    expect(Math.abs(scene.bins.reduce((s, b) => s + b.volume, 0) - flow1d.Totals.Volume)).toBeLessThan(1e-6);
    expect(scene.bins.reduce((s, b) => s + b.count, 0)).toBe(flow1d.Coinjoins.length);
  });
  it("flows mirror Links", () => {
    expect(scene.flows.map((f) => ({ From: f.from, To: f.to, Btc: f.btc, Coins: f.coins }))).toEqual(flow1d.Links);
    expect(scene.flows.filter((f) => f.internal).every((f) => f.from === f.to)).toBe(true);
    expect(scene.empty).toBe(false);
  });
  it("uses status for online state and scales radius by volume", () => {
    const by = byKey(scene.stars);
    expect(by("swisscoordinator").online).toBe(false);
    expect(by("kruw").online).toBe(true);
    expect(by("kruw").r).toBeGreaterThan(by("opencoordinator").r);
    expect(by("opencoordinator").r).toBeGreaterThan(by("coinjoiner").r);
    expect(by("kruw").colorToken).toBe("--coord-kruw");
  });
  it("renders a coordinator only in status, and one only in flow-map", () => {
    const flow: FlowMap = { ...flow1d, Coordinators: [...flow1d.Coordinators.filter((c) => c.Key !== "openwasabi"), { ...flow1d.Coordinators[0]!, Key: "newcoord", Name: "New", Volume: 1 }] };
    const st: CoordinatorsStatus = { ...status, Coordinators: status.Coordinators.filter((c) => c.Key !== "kruw") };
    const by = byKey(buildScene(flow, st).stars);
    expect(by("openwasabi").volume).toBe(0);
    expect(by("openwasabi").name).toBe("openwasabi");
    expect(by("newcoord").colorToken).toBe("--coord-other");
    expect(by("kruw").online).toBe(true); // falls back to flow-map status
  });
  it("handles an empty period", () => {
    const empty: FlowMap = { ...flow1d, Coordinators: [], Coinjoins: [], Links: [], Totals: { Volume: 0, Coinjoins: 0, FreshBtc: 0, CrossRemixBtc: 0, InternalRemixBtc: 0 } };
    const s = buildScene(empty, status);
    expect(s.empty).toBe(true);
    expect(s.stars).toHaveLength(status.Coordinators.length);
    expect(s.stars.every((x) => Number.isFinite(x.r) && x.volume === 0)).toBe(true);
    expect(s.bins.every((b) => b.volume === 0)).toBe(true);
  });
  it("maps replay progress to time and back", () => {
    expect(replayTime(0, scene)).toBe(scene.since);
    expect(replayTime(1, scene)).toBe(scene.until);
    expect(replayTime(2, scene)).toBe(scene.until);
    expect(replayProgress(replayTime(0.37, scene), scene)).toBeCloseTo(0.37, 9);
  });
});

describe("layoutStars", () => {
  const keys = [...KNOWN_COORDINATORS, "alpha.example", "zz-coord", "x"];
  const vols = Object.fromEntries(keys.map((k, i) => [k, i * 10]));
  it("is deterministic and order-independent", () => {
    expect(layoutStars(keys, vols)).toEqual(layoutStars(keys, vols));
    expect(layoutStars([...keys].reverse(), vols)).toEqual(layoutStars(keys, vols));
    expect(layoutStars(keys, {})).toEqual(layoutStars(keys, vols)); // stable across periods
  });
  it.each([[KNOWN_COORDINATORS as string[]], [keys], [["a", "b"]], [["solo"]]])("keeps stars apart and inside the frame (%#)", (ks) => {
    const pos = Object.values(layoutStars(ks, vols));
    expect(pos).toHaveLength(ks.length);
    for (const p of pos) for (const v of [p.x, p.y]) { expect(v).toBeGreaterThanOrEqual(0.08); expect(v).toBeLessThanOrEqual(0.92); }
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) expect(Math.hypot(pos[i]!.x - pos[j]!.x, pos[i]!.y - pos[j]!.y)).toBeGreaterThanOrEqual(0.18);
  });
});

describe("particleBudget", () => {
  it("respects the cap on a huge input", () => {
    const events: SkyEvent[] = Array.from({ length: 5000 }, (_, i) => ({ txid: `t${i}`, t: i, star: "kruw", volume: (i % 50) * 3.7, inputs: 1, outputs: 1, anonset: 1, feeRate: 1, freshBtc: 0, remixes: [] }));
    const b = particleBudget(events, 900);
    expect(b.size).toBe(5000);
    expect([...b.values()].reduce((s, n) => s + n, 0)).toBeLessThanOrEqual(900);
    expect([...b.values()].every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
  });
  it("gives bigger CoinJoins more particles when under the cap", () => {
    const b = particleBudget(buildScene(flow1d, status).events, 2200);
    const ev = buildScene(flow1d, status).events;
    const big = ev.reduce((a, e) => (e.volume > a.volume ? e : a));
    const small = ev.reduce((a, e) => (e.volume < a.volume ? e : a));
    expect(b.get(big.txid)!).toBeGreaterThan(b.get(small.txid)!);
    expect(b.get(small.txid)!).toBeGreaterThanOrEqual(1);
  });
});
