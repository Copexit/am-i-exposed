import { describe, it, expect } from "vitest";
import { resolveEdgePaths } from "../edge-utils";
import type { LayoutEdge, PortPositionMap } from "../types";

const A = "A", B = "B";

/** Edge A->B where B spends `vouts` of A, with A expanded and its output ports laid out. */
function setup(vouts: number[]) {
  const edge: LayoutEdge = {
    fromTxid: A, toTxid: B, x1: 300, y1: 100, x2: 500, y2: 100,
    isBackward: false, consolidationCount: vouts.length, outputIndices: vouts,
  };
  const ports: PortPositionMap = new Map(vouts.map((o) => [`${A}:output:${o}`, { x: 300, y: 50 + o * 30 }]));
  const nodes = new Map([[B, { tx: { vin: vouts.map((vout) => ({ txid: A, vout })) } }]]);
  return { edge, ports, nodes };
}

describe("parallel output bundling in port mode", () => {
  it("draws 3+ parallel outputs as one path from the port-group midpoint, with a badge", () => {
    const { edge, ports, nodes } = setup([0, 1, 2]);
    const r = resolveEdgePaths(edge, A, ports, nodes);
    expect(r.extraConsolidation).toEqual([]);
    expect(r.bundle).toMatchObject({ key: "A->B", vouts: [0, 1, 2], expanded: false });
    // Ports at y 50/80/110: the bundle starts at their midpoint
    expect(r.primary.startsWith("M300,80 ")).toBe(true);
  });

  it("keeps 2 parallel outputs as separate beziers without a badge", () => {
    const { edge, ports, nodes } = setup([0, 1]);
    const r = resolveEdgePaths(edge, A, ports, nodes);
    expect(r.bundle).toBeUndefined();
    expect(r.extraConsolidation).toHaveLength(1);
  });

  it("the toggle splits a bundle back into one bezier per port, keeping the badge", () => {
    const { edge, ports, nodes } = setup([0, 1, 2]);
    const r = resolveEdgePaths(edge, A, ports, nodes, new Set(["A->B"]));
    expect(r.bundle?.expanded).toBe(true);
    expect([r.primary, ...r.extraConsolidation]).toHaveLength(3);
  });

  it("does not bundle when no node shows ports", () => {
    const { edge, ports, nodes } = setup([0, 1, 2]);
    expect(resolveEdgePaths(edge, null, ports, nodes).bundle).toBeUndefined();
  });
});
