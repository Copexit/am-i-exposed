// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGraphExplorerState } from "../useGraphExplorerState";
import type { SavedGraph } from "@/lib/graph/saved-graph-types";

describe("useGraphExplorerState layout mode", () => {
  it("a layout switch drops expansion seeds but keeps drags", () => {
    const { result } = renderHook(() => useGraphExplorerState());
    act(() => {
      result.current.dispatch({ type: "SET_NODE_POSITION", txid: "seed", x: 1, y: 1, seeded: true });
      result.current.dispatch({ type: "SET_NODE_POSITION", txid: "drag", x: 2, y: 2 });
      // A seeded node the user then drags counts as a drag
      result.current.dispatch({ type: "SET_NODE_POSITION", txid: "both", x: 3, y: 3, seeded: true });
      result.current.dispatch({ type: "SET_NODE_POSITION", txid: "both", x: 4, y: 4 });
      result.current.dispatch({ type: "TOGGLE_LAYOUT_MODE" });
    });
    expect(result.current.state.layoutMode).toBe("time");
    expect([...result.current.state.nodePositionOverrides.keys()].sort()).toEqual(["both", "drag"]);
  });

  it("restores layoutMode from a saved graph, defaulting to hops", () => {
    const { result } = renderHook(() => useGraphExplorerState());
    const graph: SavedGraph = { id: "g", name: "g", savedAt: 0, network: "mainnet", rootTxid: "r", rootTxids: [], nodes: [] };
    act(() => result.current.restoreSavedGraph({ ...graph, layoutMode: "time" }));
    expect(result.current.state.layoutMode).toBe("time");
    act(() => result.current.restoreSavedGraph({ ...graph }));
    expect(result.current.state.layoutMode).toBe("hops");
  });

  it("bundle toggles flip a pair and clear together", () => {
    const { result } = renderHook(() => useGraphExplorerState());
    act(() => result.current.dispatch({ type: "TOGGLE_BUNDLE", key: "a->b" }));
    expect(result.current.state.unbundledPairs.has("a->b")).toBe(true);
    act(() => result.current.dispatch({ type: "CLEAR_BUNDLES" }));
    expect(result.current.state.unbundledPairs.size).toBe(0);
  });
});
