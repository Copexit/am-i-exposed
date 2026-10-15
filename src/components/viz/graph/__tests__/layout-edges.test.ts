import { describe, it, expect } from "vitest";
import { layoutGraph } from "../layout";
import { planPathNodes } from "@/lib/graph/path-to-graph";
import type { ConnectionPath } from "@/lib/graph/connection-search";
import type { GraphNode } from "@/lib/graph/graph-reducer";
import { makeTx, makeVin } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

const FILTER = { showCoinJoin: true, showEntity: true, showStandard: true };
const tx = (txid: string, ...funders: string[]) =>
  makeTx({ txid, vin: funders.length ? funders.map((f, i) => makeVin({ txid: f, vout: i })) : [makeVin()] });

/** Add a bent path [A, pivot, B] to a graph holding only A and B, then lay it out. */
function addPivot(kind: ConnectionPath["kind"], A: GraphNode, B: GraphNode, pivotTx: ReturnType<typeof tx>) {
  const graph = new Map([[A.txid, A], [B.txid, B]]);
  const path: ConnectionPath = { kind, hops: [{ txid: A.txid }, { txid: pivotTx.txid }, { txid: B.txid }], meetTxid: pivotTx.txid, pivot: 1 };
  const plan = planPathNodes(path, new Map([[pivotTx.txid, pivotTx]]), graph);
  for (const n of plan.nodes) graph.set(n.txid, n);
  const roots = new Set([A.txid, B.txid]);
  return { plan, edges: layoutGraph(graph, A.txid, FILTER, roots).edges.map((e) => `${e.fromTxid}->${e.toTxid}`) };
}

describe("a new pivot with both neighbours in the graph", () => {
  it("shared descendant: D is drawn spending both A and B", () => {
    const A = { txid: "A", tx: tx("A"), depth: 0 };
    const B = { txid: "B", tx: tx("B"), depth: 0 };
    const { plan, edges } = addPivot("shared-descendant", A, B, tx("D", "A", "B"));
    expect(plan.nodes.map((n) => [n.txid, n.depth])).toEqual([["D", 1]]);
    expect(edges.sort()).toEqual(["A->D", "B->D"]);
  });

  it("shared ancestor: P is drawn funding both A and B", () => {
    const A = { txid: "A", tx: tx("A", "P"), depth: 0 };
    const B = { txid: "B", tx: tx("B", "P"), depth: 0 };
    const { plan, edges } = addPivot("shared-ancestor", A, B, tx("P"));
    expect(plan.nodes.map((n) => [n.txid, n.depth])).toEqual([["P", -1]]);
    expect(edges.sort()).toEqual(["P->A", "P->B"]);
  });
});
