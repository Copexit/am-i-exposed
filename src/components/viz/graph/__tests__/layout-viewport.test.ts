import { describe, it, expect } from "vitest";
import { findFreeY, computeFitView, computeCompactView } from "../layout";
import type { LayoutNode } from "../types";

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
  const node = (x: number, y: number) => ({ x, y, width: 100, height: 50 }) as LayoutNode;

  it("returns null for an empty graph", () => {
    expect(computeFitView([], { width: 800, height: 600 })).toBeNull();
  });

  it("caps the zoom-in scale at 1.5 and centers the nodes", () => {
    expect(computeFitView([node(0, 0)], { width: 800, height: 600 })).toEqual({ x: 325, y: 262.5, scale: 1.5 });
  });
});

describe("computeCompactView", () => {
  const node = (x: number, y: number, isRoot = false) => ({ x, y, width: 100, height: 50, isRoot }) as LayoutNode;

  it("never zooms in and centers a graph that fits", () => {
    expect(computeCompactView([node(0, 0, true)], { width: 800, height: 300 })).toEqual({ x: 350, y: 125, scale: 1 });
  });

  it("fits a slightly too wide graph by scaling down", () => {
    const vt = computeCompactView([node(0, 0), node(900, 0, true)], { width: 800, height: 300 });
    expect(vt?.scale).toBe(0.8);
    expect(vt?.x).toBe(0);
  });

  it("keeps the minimum scale and centers the root when fitting would be unreadable", () => {
    const vt = computeCompactView([node(0, 0), node(1000, 0, true), node(2000, 0)], { width: 300, height: 300 });
    expect(vt).toEqual({ x: 150 - 1050 * 0.75, y: 150 - 25 * 0.75, scale: 0.75 });
  });
});
