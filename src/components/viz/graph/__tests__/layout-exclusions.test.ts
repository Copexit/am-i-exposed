import { describe, it, expect } from "vitest";
import { layoutGraph } from "../layout";
import { nodesWithinHops } from "@/lib/graph/isolate";
import type { GraphNode } from "@/lib/graph/graph-reducer";
import { makeTx, makeVin } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

const ALL = { showCoinJoin: true, showEntity: true, showStandard: true };

/** A chain node funded by output 0 of each funder. */
function node(txid: string, depth: number, ...funders: string[]): GraphNode {
  const tx = makeTx({ txid, vin: funders.length ? funders.map((f) => makeVin({ txid: f, vout: 0 })) : [makeVin()] });
  return { txid, tx, depth };
}
// R -> A -> B -> C, and D funded by R
const g = new Map([node("R", 0), node("A", 1, "R"), node("B", 2, "A"), node("C", 3, "B"), node("D", 1, "R")].map((n) => [n.txid, n]));
const shown = (excluded: Set<string>, expanded: string | null = null, mode: "hops" | "time" = "hops") =>
  layoutGraph(g, "R", ALL, undefined, expanded, false, undefined, mode, excluded).layoutNodes.map((n) => n.txid).sort();

describe("layoutGraph exclusions", () => {
  it("leaves hidden nodes out in both layouts, with no edges to them", () => {
    expect(shown(new Set(["B"]))).toEqual(["A", "C", "D", "R"]);
    expect(shown(new Set(["B"]), null, "time")).toEqual(["A", "C", "D", "R"]);
    const { edges } = layoutGraph(g, "R", ALL, undefined, null, false, undefined, "hops", new Set(["B"]));
    expect(edges.some((e) => e.fromTxid === "B" || e.toTxid === "B")).toBe(false);
  });

  it("never hides the root or the expanded node", () => {
    expect(shown(new Set(["R", "A", "B"]), "A")).toEqual(["A", "C", "D", "R"]);
  });
});

describe("nodesWithinHops", () => {
  it("walks in-graph funding links both ways", () => {
    expect([...nodesWithinHops(g, ["A"], 1)].sort()).toEqual(["A", "B", "R"]);
    expect([...nodesWithinHops(g, ["A"], 2)].sort()).toEqual(["A", "B", "C", "D", "R"]);
    expect([...nodesWithinHops(g, ["C", "D"], 1)].sort()).toEqual(["B", "C", "D", "R"]);
  });

  it("ignores seeds not in the graph", () => {
    expect([...nodesWithinHops(g, ["zz"], 2)]).toEqual([]);
  });
});
