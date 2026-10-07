import { describe, it, expect } from "vitest";
import flowEnv from "@/lib/observatory/__tests__/fixtures/wabisator/flow-map-1d.json";
import { buildScene, type Scene } from "@/lib/observatory/sky-model";
import type { FlowMap } from "@/lib/observatory/wabisator-types";
import {
  SkyClock, createDynamics, curveControl, edgeEntry, layoutSky, placeLabels, quadPoint, resolveColor, resolvePalette, step,
  type LabelItem, type Rect,
} from "../sky-renderer";

const scene: Scene = buildScene(flowEnv.result as unknown as FlowMap, null);
const measure = (text: string) => text.length * 6;
const bounds: Rect = { x0: 0, y0: 0, x1: 400, y1: 300 };
const metrics = { nameH: 12, volH: 10, gap: 3, pad: 6 };
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const item = (key: string, x: number, y: number, weight = 1): LabelItem => ({ key, x, y, r: 8, name: key, vol: "1.00 BTC", nameW: key.length * 6, volW: 48, weight });

describe("placeLabels", () => {
  it("puts a lone star's label below it, centered", () => {
    const [l] = placeLabels([item("kruw", 200, 100)], bounds, metrics);
    expect(l!.side).toBe("below");
    expect(l!.showVolume).toBe(true);
    expect(l!.x + l!.w / 2).toBeCloseTo(200);
    expect(l!.y).toBeGreaterThan(108);
  });

  it("flips above near the bottom edge and stays in bounds", () => {
    const [l] = placeLabels([item("kruw", 200, 290)], bounds, metrics);
    expect(l!.side).toBe("above");
    expect(l!.y + l!.h).toBeLessThanOrEqual(282);
  });

  it("never overlaps two labels of stacked stars", () => {
    const ls = placeLabels([item("a", 200, 100, 2), item("b", 200, 140, 1)], bounds, metrics);
    expect(overlap(ls[0]!, ls[1]!)).toBe(false);
  });

  it("hides volumes before letting names collide when crowded", () => {
    const items = [item("alpha", 100, 40, 5), item("bravo", 100, 72, 4), item("charlie", 100, 104, 3), item("delta", 60, 72, 2), item("echo", 140, 72, 1)];
    const ls = placeLabels(items, bounds, metrics);
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) expect(overlap(ls[i]!, ls[j]!)).toBe(false);
    expect(ls.some((l) => !l.showVolume)).toBe(true);
    for (const l of ls) {
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.x + l.w).toBeLessThanOrEqual(400);
    }
  });
});

describe("geometry", () => {
  it("enters from the nearest edge, just outside the canvas", () => {
    expect(edgeEntry(20, 150, 400, 300, 0.5)).toEqual({ x: -8, y: 150 });
    expect(edgeEntry(390, 150, 400, 300, 0.5).x).toBe(408);
    expect(edgeEntry(200, 10, 400, 300, 0.5).y).toBe(-8);
    expect(edgeEntry(200, 295, 400, 300, 0.5).y).toBe(308);
    const j = edgeEntry(20, 150, 400, 300, 0);
    expect(j.x).toBe(-8);
    expect(j.y).toBeGreaterThanOrEqual(0);
    expect(j.y).toBeLessThan(150);
  });

  it("bends the curve perpendicular to the chord, by distance", () => {
    const c = curveControl(0, 0, 100, 0, 0.2);
    expect(c).toEqual({ x: 50, y: 20 });
    expect(curveControl(100, 0, 0, 0, 0.2)).toEqual({ x: 50, y: -20 });
    expect(quadPoint(0, 0, 50, 20, 100, 0, 0.5)).toEqual({ x: 50, y: 10 });
  });
});

describe("colours", () => {
  it("accepts #rrggbb and #rgb, falls back otherwise", () => {
    expect(resolveColor(" #E8AF4F ", "#000000")).toBe("#e8af4f");
    expect(resolveColor("#abc", "#000000")).toBe("#aabbcc");
    expect(resolveColor("", "#123456")).toBe("#123456");
    expect(resolveColor("rgb(1, 2, 3)", "#123456")).toBe("#123456");
    expect(resolveColor(undefined, "#123456")).toBe("#123456");
  });

  it("resolves star tokens through --coord-other and the sky foreground", () => {
    const vars: Record<string, string> = { "--obs-sky": "#060709", "--obs-sky-fg": "#e6e9f0", "--coord-kruw": "#e8af4f" };
    const p = resolvePalette((n) => vars[n] ?? "", ["--coord-kruw", "--coord-other"]);
    expect(p.sky).toBe("#060709");
    expect(p.tone("--coord-kruw")).toBe("#e8af4f");
    expect(p.tone("--coord-other")).toBe("#e6e9f0");
    expect(p.tone("--coord-missing")).toBe("#e6e9f0");
  });
});

describe("clock", () => {
  it("advances at 1 / replay seconds and stops at live", () => {
    const c = new SkyClock(60, 0.5, 1000);
    expect(c.progress(1000 + 6000)).toBeCloseTo(0.6);
    expect(c.progress(1000 + 600_000)).toBe(1);
    c.toggle(1000 + 6000);
    expect(c.playing).toBe(false);
    expect(c.progress(1000 + 60_000)).toBeCloseTo(0.6);
    c.jump(0.25, 9000);
    expect(c.epoch).toBe(1);
    expect(c.progress(20_000)).toBe(0.25);
    c.toggle(20_000);
    expect(c.progress(26_000)).toBeCloseTo(0.35);
  });
});

describe("step", () => {
  const layout = layoutSky(scene, { w: 800, h: 500, inset: { top: 20, right: 20, bottom: 100, left: 20 }, mobile: false }, { sans: "x", mono: "y" }, () => "1 BTC", measure);

  it("spawns pulses as the clock passes events and respects the live particle cap", () => {
    const dyn = createDynamics();
    step(dyn, layout, scene, scene.since - 1, 0.016, 50, 0);
    expect(dyn.pulses).toHaveLength(0);
    step(dyn, layout, scene, scene.until, 0.016, 50, 0);
    expect(dyn.pulses.length).toBeGreaterThan(0);
    expect(dyn.particles.length).toBeLessThanOrEqual(50);
  });

  it("does not replay the past on a jump: a new epoch starts after the clock", () => {
    const dyn = createDynamics();
    step(dyn, layout, scene, scene.until, 0.016, 2200, 1);
    expect(dyn.pulses).toHaveLength(0);
    expect(dyn.particles).toHaveLength(0);
  });
});
