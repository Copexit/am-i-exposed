import { describe, it, expect } from "vitest";
import { graphReducer, makeInitialState, type GraphState } from "../graph-reducer";
import { makeTx } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

function withRoot(txid: string): GraphState {
  return graphReducer(makeInitialState(200), { type: "SET_ROOT", tx: makeTx({ txid }) });
}

describe("graphReducer ADD_NODE", () => {
  it("rejects a forward node whose parent is not in the graph", () => {
    const state = withRoot("root");
    const next = graphReducer(state, {
      type: "ADD_NODE",
      node: { txid: "orphan", tx: makeTx({ txid: "orphan" }), depth: 1, parentEdge: { fromTxid: "gone", outputIndex: 0 } },
    });
    expect(next).toBe(state);
  });

  it("rejects a backward node whose child is not in the graph", () => {
    const state = withRoot("root");
    const next = graphReducer(state, {
      type: "ADD_NODE",
      node: { txid: "orphan", tx: makeTx({ txid: "orphan" }), depth: -1, childEdge: { toTxid: "gone", inputIndex: 0 } },
    });
    expect(next).toBe(state);
  });

  it("accepts a node attached to an existing node", () => {
    const state = withRoot("root");
    const next = graphReducer(state, {
      type: "ADD_NODE",
      node: { txid: "kid", tx: makeTx({ txid: "kid" }), depth: 1, parentEdge: { fromTxid: "root", outputIndex: 0 } },
    });
    expect(next.nodes.has("kid")).toBe(true);
  });
});

describe("graphReducer ADD_NODES", () => {
  const node = (txid: string, from: string) =>
    ({ txid, tx: makeTx({ txid }), depth: 1, parentEdge: { fromTxid: from, outputIndex: 0 } });

  it("adds a chain as one undo step, skipping nodes already present", () => {
    const state = withRoot("root");
    const next = graphReducer(state, { type: "ADD_NODES", nodes: [node("root", "x"), node("a", "root"), node("b", "a")] });
    expect([...next.nodes.keys()]).toEqual(["root", "a", "b"]);
    expect(next.nodes.get("root")).toBe(state.nodes.get("root"));
    expect(next.undoStack).toHaveLength(1);
    expect(graphReducer(next, { type: "UNDO" }).nodes.size).toBe(1);
  });

  it("stops at maxNodes and skips nodes cut off from the graph", () => {
    const state = graphReducer(makeInitialState(2), { type: "SET_ROOT", tx: makeTx({ txid: "root" }) });
    const next = graphReducer(state, { type: "ADD_NODES", nodes: [node("a", "root"), node("b", "a")] });
    expect([...next.nodes.keys()]).toEqual(["root", "a"]);
    const orphan = graphReducer(state, { type: "ADD_NODES", nodes: [node("b", "a")] });
    expect(orphan).toBe(state);
  });

  it("registers an extra root", () => {
    const state = withRoot("root");
    const next = graphReducer(state, { type: "ADD_NODES", nodes: [{ txid: "r2", tx: makeTx({ txid: "r2" }), depth: 0 }], root: "r2" });
    expect([...next.rootTxids]).toEqual(["root", "r2"]);
  });
});
