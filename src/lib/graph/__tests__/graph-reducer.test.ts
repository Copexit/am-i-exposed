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
