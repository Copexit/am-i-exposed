// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGraphExplorerState, activePositionOverrides } from "../useGraphExplorerState";
import { layoutGraph } from "../layout";
import type { SavedGraph } from "@/lib/graph/saved-graph-types";
import type { GraphNode } from "@/lib/graph/graph-reducer";
import { makeTx, makeVin } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

const ALL = { showCoinJoin: true, showEntity: true, showStandard: true };
const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);

function node(txid: string, height: number, depth: number, ...funders: string[]): GraphNode {
  const tx = makeTx({
    txid,
    vin: funders.length ? funders.map((f) => makeVin({ txid: f, vout: 0 })) : [makeVin()],
    status: { confirmed: true, block_height: height, block_time: 1_700_000_000 + height },
  });
  return { txid, tx, depth };
}
// Depth order A, B, C; chronological order C, A, B
const nodes = new Map([node(A, 200, 0), node(B, 300, 1, A), node(C, 100, 2)].map((n) => [n.txid, n]));

// A graph saved before this branch: no layoutMode, hops positions (seeds or drags)
const SAVED: SavedGraph = {
  id: "g", name: "g", savedAt: 0, network: "mainnet", rootTxid: A, rootTxids: [A],
  nodes: [{ txid: A, depth: 0 }, { txid: B, depth: 1 }, { txid: C, depth: 2 }],
  nodePositions: { [B]: { x: 900, y: 500 }, [C]: { x: 10, y: 700 } },
};

function setup() {
  const hook = renderHook(() => useGraphExplorerState());
  act(() => hook.result.current.restoreSavedGraph(SAVED));
  const lay = () => {
    const s = hook.result.current.state;
    return layoutGraph(nodes, A, ALL, undefined, null, false, activePositionOverrides(s), s.layoutMode);
  };
  const xOf = (txid: string) => lay().nodePositions.get(txid)!.x;
  return { ...hook, lay, xOf };
}

describe("per-mode position overrides", () => {
  it("a graph saved with overrides (no layoutMode) opens in hops at its saved positions", () => {
    const { result, lay } = setup();
    expect(result.current.state.layoutMode).toBe("hops");
    const pos = lay().nodePositions;
    expect(pos.get(B)).toMatchObject({ x: 900, y: 500 });
    expect(pos.get(C)).toMatchObject({ x: 10, y: 700 });
  });

  it("switching that graph to time puts every node in its time column", () => {
    const { result, lay, xOf } = setup();
    act(() => result.current.dispatch({ type: "TOGGLE_LAYOUT_MODE" }));
    const cols = lay().timeColumns!;
    expect(cols.map((c) => c.height)).toEqual([100, 200, 300]);
    expect([xOf(C), xOf(A), xOf(B)]).toEqual(cols.map((c) => c.x));
    // Back in hops, the saved positions are untouched
    act(() => result.current.dispatch({ type: "TOGGLE_LAYOUT_MODE" }));
    expect(xOf(B)).toBe(900);
  });

  it("a time-mode drag stays in time mode, is dropped on switching to hops, and is never saved", () => {
    const { result, xOf } = setup();
    act(() => result.current.dispatch({ type: "TOGGLE_LAYOUT_MODE" }));
    act(() => result.current.handleNodePositionChange(A, 1234, 56));
    expect(xOf(A)).toBe(1234);
    // The saved (hops) map, which the toolbar serializes, never sees it
    expect(result.current.state.nodePositionOverrides.has(A)).toBe(false);

    act(() => result.current.dispatch({ type: "TOGGLE_LAYOUT_MODE" }));
    expect(result.current.state.layoutMode).toBe("hops");
    expect(activePositionOverrides(result.current.state).has(A)).toBe(false);
    act(() => result.current.dispatch({ type: "TOGGLE_LAYOUT_MODE" }));
    expect(activePositionOverrides(result.current.state).size).toBe(0);
  });

  it("a hops drag goes to the saved map", () => {
    const { result } = setup();
    act(() => result.current.handleNodePositionChange(A, 5, 6));
    expect(result.current.state.nodePositionOverrides.get(A)).toEqual({ x: 5, y: 6 });
  });

  it("reset clears both maps and the bundle toggles", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({ type: "TOGGLE_BUNDLE", key: "a->b" });
      result.current.dispatch({ type: "TOGGLE_LAYOUT_MODE" });
      result.current.handleNodePositionChange(A, 1, 1);
      result.current.dispatch({ type: "RESET_VIEW" });
    });
    const s = result.current.state;
    expect([s.nodePositionOverrides.size, s.timePositionOverrides.size, s.unbundledPairs.size]).toEqual([0, 0, 0]);
  });

  it("restores layoutMode from a saved graph, defaulting to hops, and clears bundle toggles", () => {
    const { result } = setup();
    act(() => result.current.dispatch({ type: "TOGGLE_BUNDLE", key: "a->b" }));
    act(() => result.current.restoreSavedGraph({ ...SAVED, id: "t", layoutMode: "time" }));
    expect(result.current.state.layoutMode).toBe("time");
    expect(result.current.state.unbundledPairs.size).toBe(0);
    act(() => result.current.restoreSavedGraph({ ...SAVED, id: "h" }));
    expect(result.current.state.layoutMode).toBe("hops");
  });
});

describe("selection follows visibility", () => {
  it("drops selected nodes the layout left out, keeping the state when nothing changes", () => {
    const { result } = setup();
    act(() => { for (const t of [A, B, C]) result.current.dispatch({ type: "TOGGLE_SELECTED", txid: t }); });
    // C is isolated away (any exclusion: filters, hides and isolate all reach the layout this way)
    const { nodePositions } = layoutGraph(nodes, A, ALL, undefined, null, false, undefined, "hops", new Set([C]));
    act(() => result.current.dispatch({ type: "PRUNE_SELECTION", visible: nodePositions }));
    expect([...result.current.state.selection].sort()).toEqual([A, B].sort());
    const before = result.current.state;
    act(() => result.current.dispatch({ type: "PRUNE_SELECTION", visible: nodePositions }));
    expect(result.current.state).toBe(before);
  });

  it("loading a saved graph clears the selection", () => {
    const { result } = setup();
    act(() => result.current.dispatch({ type: "TOGGLE_SELECTED", txid: B }));
    act(() => result.current.restoreSavedGraph({ ...SAVED, id: "other" }));
    expect(result.current.state.selection.size).toBe(0);
  });
});
