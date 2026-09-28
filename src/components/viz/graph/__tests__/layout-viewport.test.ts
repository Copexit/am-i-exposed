import { describe, it, expect } from "vitest";
import { findFreeY, computeFitView, computeAutoFitView } from "../layout";
import { MIN_ZOOM } from "../constants";

describe("findFreeY", () => {
  it("returns the target y when the column is free", () => {
    expect(findFreeY(0, 100, [new Map([["far", { x: 1000, y: 100 }]])])).toBe(100);
  });

  it("nudges down one slot (NODE_H + ROW_GAP) per nearby collision, across all sources", () => {
    const laidOut = new Map([["a", { x: 10, y: 100 }]]);
    const overrides = new Map([["b", { x: -10, y: 180 }]]);
    expect(findFreeY(0, 100, [laidOut, overrides])).toBe(260);
  });

  it("ignores the excluded txid", () => {
    expect(findFreeY(0, 100, [new Map([["self", { x: 0, y: 100 }]])], "self")).toBe(100);
  });
});

describe("computeFitView", () => {
  const box = (x: number, y: number) => ({ x, y, w: 100, h: 50 });

  it("returns null for an empty graph", () => {
    expect(computeFitView([], { width: 800, height: 600 })).toBeNull();
  });

  it("caps the zoom-in scale at 1.5 and centers the nodes", () => {
    expect(computeFitView([box(0, 0)], { width: 800, height: 600 })).toEqual({ x: 325, y: 262.5, scale: 1.5 });
  });

  it("keeps every box inside the viewport with padding on a phone-width canvas", () => {
    const boxes = [box(-280, 40), box(0, 0), box(280, 120)];
    const dims = { width: 358, height: 600 };
    const vt = computeFitView(boxes, dims)!;
    for (const b of boxes) {
      expect(b.x * vt.scale + vt.x).toBeGreaterThanOrEqual(24);
      expect((b.x + b.w) * vt.scale + vt.x).toBeLessThanOrEqual(dims.width - 24);
      expect(b.y * vt.scale + vt.y).toBeGreaterThanOrEqual(0);
      expect((b.y + b.h) * vt.scale + vt.y).toBeLessThanOrEqual(dims.height);
    }
  });

  it("left-aligns a graph that overflows even at the minimum zoom", () => {
    const vt = computeFitView([box(0, 0), box(100_000, 0)], { width: 400, height: 400 })!;
    expect(vt.scale).toBe(MIN_ZOOM);
    expect(vt.x).toBe(28);
  });
});

describe("computeAutoFitView", () => {
  const box = (x: number, y: number) => ({ x, y, w: 180, h: 56 });

  it("fits everything without zooming in past 1:1", () => {
    expect(computeAutoFitView([box(0, 0)], [box(0, 0)], { width: 800, height: 300 })?.scale).toBe(1);
  });

  it("frames only the focus boxes when fitting everything would be unreadable", () => {
    const all = Array.from({ length: 10 }, (_, i) => box(i * 280, 0));
    const focus = [all[4]!, all[5]!];
    const vt = computeAutoFitView(all, focus, { width: 358, height: 400 })!;
    expect(vt).toEqual(computeFitView(focus, { width: 358, height: 400 }, 1));
  });
});
