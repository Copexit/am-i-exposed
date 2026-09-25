import { describe, it, expect } from "vitest";
import { findFreeY, computeFitView } from "../layout";
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
