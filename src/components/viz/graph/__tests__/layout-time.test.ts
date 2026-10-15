import { describe, it, expect } from "vitest";
import { layoutGraph } from "../layout";
import type { GraphNode } from "@/lib/graph/graph-reducer";
import { makeTx, makeVin } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

const ALL = { showCoinJoin: true, showEntity: true, showStandard: true };

/** A tx at `height` (null = unconfirmed) spending output 0 of each funder. */
function node(txid: string, height: number | null, depth: number, ...funders: string[]): GraphNode {
  const tx = makeTx({
    txid,
    vin: funders.length ? funders.map((f) => makeVin({ txid: f, vout: 0 })) : [makeVin()],
    status: height === null ? { confirmed: false } : { confirmed: true, block_height: height, block_time: 1_700_000_000 + height },
  });
  return { txid, tx, depth };
}

const graphOf = (...nodes: GraphNode[]) => new Map(nodes.map((n) => [n.txid, n]));

/** txids per column, left to right. */
function columns(graph: Map<string, GraphNode>, root: string, opts: { filter?: typeof ALL; roots?: Set<string> } = {}) {
  const { layoutNodes, timeColumns } = layoutGraph(graph, root, opts.filter ?? ALL, opts.roots, null, false, undefined, "time");
  const xs = [...new Set(layoutNodes.map((n) => n.x))].sort((a, b) => a - b);
  return { cols: xs.map((x) => layoutNodes.filter((n) => n.x === x).map((n) => n.txid).sort()), timeColumns: timeColumns! };
}

describe("layoutGraph time mode", () => {
  it("orders columns by block height, not by hop depth", () => {
    // Depths say A, B, C; heights say C, A, B
    const g = graphOf(node("A", 200, 0), node("B", 300, 1), node("C", 100, 2));
    const { cols, timeColumns } = columns(g, "A");
    expect(cols).toEqual([["C"], ["A"], ["B"]]);
    expect(timeColumns.map((c) => c.height)).toEqual([100, 200, 300]);
    expect(timeColumns.map((c) => c.gap)).toEqual([0, 100, 100]);
  });

  it("keeps depth as data: only x positions change", () => {
    const g = graphOf(node("A", 200, 0), node("C", 100, 2));
    const { layoutNodes } = layoutGraph(g, "A", ALL, undefined, null, false, undefined, "time");
    expect(Object.fromEntries(layoutNodes.map((n) => [n.txid, n.depth]))).toEqual({ A: 0, C: 2 });
  });

  it("puts a same-block parent in a column before its child", () => {
    const g = graphOf(node("CHILD", 500, 0, "PARENT"), node("PARENT", 500, -1), node("OTHER", 500, 1));
    const { cols, timeColumns } = columns(g, "CHILD");
    expect(cols).toEqual([["OTHER", "PARENT"], ["CHILD"]]);
    expect(timeColumns.map((c) => c.height)).toEqual([500, 500]);
    expect(timeColumns[1]!.gap).toBe(0);
  });

  it("puts unconfirmed txs last, ordered by their parent chain", () => {
    const g = graphOf(
      node("U2", null, 2, "U1"),
      node("U1", null, 1, "A"),
      node("A", 700, 0),
    );
    const { cols, timeColumns } = columns(g, "A");
    expect(cols).toEqual([["A"], ["U1"], ["U2"]]);
    expect(timeColumns.map((c) => c.height)).toEqual([700, null, null]);
    expect(timeColumns.every((c) => c.gap === 0 || c.height !== null)).toBe(true);
  });

  it("lays out a multi-root graph by height across roots", () => {
    const g = graphOf(node("R1", 900, 0), node("R2", 100, 0), node("P", 50, -1));
    const { cols } = columns(g, "R1", { roots: new Set(["R1", "R2"]) });
    expect(cols).toEqual([["P"], ["R2"], ["R1"]]);
  });

  it("applies filter exclusions and leaves no empty column for a hidden block", () => {
    const g = graphOf(node("ROOT", 300, 0), node("HIDDEN", 200, -1), node("LATER", 400, 1));
    const { cols, timeColumns } = columns(g, "ROOT", { filter: { ...ALL, showStandard: false } });
    expect(cols).toEqual([["ROOT"]]);
    expect(timeColumns.map((c) => c.height)).toEqual([300]);
  });

  it("still draws the extra in-graph vin edges", () => {
    // No parentEdge/childEdge set: every edge comes from the in-graph vin pass
    const g = graphOf(node("A", 100, 0), node("B", 101, 1, "A"), node("C", 102, 2, "A", "B"));
    const { edges } = layoutGraph(g, "A", ALL, undefined, null, false, undefined, "time");
    expect(edges.map((e) => `${e.fromTxid}->${e.toTxid}`).sort()).toEqual(["A->B", "A->C", "B->C"]);
  });

  it("hops mode is the default and returns no time columns", () => {
    const g = graphOf(node("A", 200, 0), node("C", 100, 2));
    expect(layoutGraph(g, "A", ALL).timeColumns).toBeUndefined();
  });
});
