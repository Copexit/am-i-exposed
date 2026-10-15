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

  it("drops the extra root again on UNDO", () => {
    const state = withRoot("root");
    const next = graphReducer(state, { type: "ADD_NODES", nodes: [{ txid: "r2", tx: makeTx({ txid: "r2" }), depth: 0 }], root: "r2" });
    expect([...graphReducer(next, { type: "UNDO" }).rootTxids]).toEqual(["root"]);
  });
});

describe("graphReducer REMOVE_NODES", () => {
  const node = (txid: string, from: string) =>
    ({ txid, tx: makeTx({ txid }), depth: 1, parentEdge: { fromTxid: from, outputIndex: 0 } });
  const built = () => graphReducer(withRoot("root"), {
    type: "ADD_NODES",
    nodes: [node("a", "root"), node("b", "a"), node("c", "root"), node("d", "root")],
  });

  it("never removes a root and cascades unreachable nodes", () => {
    const next = graphReducer(built(), { type: "REMOVE_NODES", txids: ["root", "a", "c"] });
    expect([...next.nodes.keys()]).toEqual(["root", "d"]);
  });

  it("is one undo step that restores every removed node", () => {
    const state = built();
    const next = graphReducer(state, { type: "REMOVE_NODES", txids: ["a", "c"] });
    expect(next.undoStack).toHaveLength(state.undoStack.length + 1);
    expect([...graphReducer(next, { type: "UNDO" }).nodes.keys()]).toEqual(["root", "a", "b", "c", "d"]);
  });

  it("is a no-op when only roots or unknown txids are given", () => {
    const state = built();
    expect(graphReducer(state, { type: "REMOVE_NODES", txids: ["root", "zzz"] })).toBe(state);
  });
});
