import { describe, it, expect } from "vitest";
import { planPathNodes } from "../path-to-graph";
import type { ConnectionPath } from "../connection-search";
import type { GraphNode } from "../graph-reducer";
import type { MempoolTransaction } from "@/lib/api/types";
import { makeTx, makeVin } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

/** A tx spending output `vout` of each funder. */
const tx = (txid: string, ...funders: string[]) =>
  makeTx({ txid, vin: funders.length ? funders.map((f) => makeVin({ txid: f, vout: 1 })) : [makeVin()] });

const path = (kind: ConnectionPath["kind"], ids: string[], pivot?: number): ConnectionPath =>
  ({ kind, hops: ids.map((txid) => ({ txid })), meetTxid: ids[pivot ?? 0]!, pivot });

const txMap = (...list: MempoolTransaction[]) => new Map(list.map((t) => [t.txid, t]));
const graphOf = (...list: GraphNode[]) => new Map(list.map((n) => [n.txid, n]));

describe("planPathNodes", () => {
  // R funds M funds C
  const R = tx("R"), M = tx("M", "R"), C = tx("C", "M");
  const txs = txMap(R, M, C);

  it("extends forward from the anchor with parent edges and growing depth", () => {
    const plan = planPathNodes(path("a-funds-b", ["R", "M", "C"]), txs, graphOf({ txid: "R", tx: R, depth: 0 }));
    expect(plan.root).toBeUndefined();
    expect(plan.nodes.map((n) => [n.txid, n.depth, n.parentEdge])).toEqual([
      ["M", 1, { fromTxid: "R", outputIndex: 1 }],
      ["C", 2, { fromTxid: "M", outputIndex: 1 }],
    ]);
  });

  it("extends backward from an anchor at the end with child edges", () => {
    const plan = planPathNodes(path("a-funds-b", ["R", "M", "C"]), txs, graphOf({ txid: "C", tx: C, depth: 3 }));
    expect(plan.nodes.map((n) => [n.txid, n.depth, n.childEdge])).toEqual([
      ["M", 2, { toTxid: "C", inputIndex: 0 }],
      ["R", 1, { toTxid: "M", inputIndex: 0 }],
    ]);
  });

  it("keeps an existing middle hop and connects both branches from it", () => {
    // Shared ancestor: A <- P -> B, with P already in the graph
    const P = tx("P"), A = tx("A", "P"), B = tx("B", "P");
    const graph = graphOf({ txid: "P", tx: P, depth: -2 });
    const plan = planPathNodes(path("shared-ancestor", ["A", "P", "B"], 1), txMap(P, A, B), graph);
    expect(plan.nodes.map((n) => [n.txid, n.depth, n.parentEdge?.fromTxid])).toEqual([
      ["B", -1, "P"],
      ["A", -1, "P"],
    ]);
  });

  it("fills a gap between two present hops and links the closing edge", () => {
    const graph = graphOf({ txid: "R", tx: R, depth: 0 }, { txid: "C", tx: C, depth: 2, parentEdge: { fromTxid: "R", outputIndex: 0 } });
    const plan = planPathNodes(path("a-funds-b", ["R", "M", "C"]), txs, graph);
    expect(plan.nodes).toHaveLength(1);
    expect(plan.nodes[0]).toMatchObject({ txid: "M", depth: 1, parentEdge: { fromTxid: "R" }, childEdge: { toTxid: "C", inputIndex: 0 } });
  });

  it("makes the first hop an extra root when no hop is in the graph", () => {
    // Shared descendant: A -> D <- B
    const A = tx("A"), B = tx("B"), D = tx("D", "A", "B");
    const plan = planPathNodes(path("shared-descendant", ["A", "D", "B"], 1), txMap(A, B, D), new Map());
    expect(plan.root).toBe("A");
    expect(plan.nodes.map((n) => [n.txid, n.depth])).toEqual([["A", 0], ["D", 1], ["B", 0]]);
    expect(plan.nodes[2]!.childEdge).toEqual({ toTxid: "D", inputIndex: 1 });
  });
});
