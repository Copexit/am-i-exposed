// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSavedGraphs } from "../useSavedGraphs";
import { useBookmarks } from "../useBookmarks";
import { createLocalStorageStore } from "../createLocalStorageStore";
import type { SavedGraph } from "@/lib/graph/saved-graph-types";

const TXID = "a".repeat(64);
const graph: Omit<SavedGraph, "id" | "savedAt"> = {
  name: "g",
  network: "mainnet",
  rootTxid: TXID,
  rootTxids: [TXID],
  nodes: [{ txid: TXID, depth: 0 }],
};

function failWrites() {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("createLocalStorageStore.set", () => {
  it("returns false and keeps the previous value when the write fails", () => {
    const store = createLocalStorageStore<number[]>("t", []);
    expect(store.set([1])).toBe(true);
    failWrites();
    expect(store.set([1, 2])).toBe(false);
    expect(store.getSnapshot()).toEqual([1]);
  });
});

describe("useSavedGraphs", () => {
  it("saveGraph returns '' when storage is full", () => {
    const { result } = renderHook(() => useSavedGraphs());
    failWrites();
    let id = "x";
    act(() => { id = result.current.saveGraph(graph); });
    expect(id).toBe("");
    expect(result.current.graphs).toHaveLength(0);
  });

  it("drops corrupt stored entries instead of returning them", () => {
    localStorage.setItem("ami-saved-graphs", JSON.stringify([{ id: "bad" }, { ...graph, id: "ok", savedAt: 1 }]));
    const { result } = renderHook(() => useSavedGraphs());
    expect(result.current.graphs.map((g) => g.id)).toEqual(["ok"]);
  });
});

describe("useBookmarks import", () => {
  it("reports storage_full when the merged bookmarks cannot be written", () => {
    const { result } = renderHook(() => useBookmarks());
    failWrites();
    let res: { imported: number; error?: string } = { imported: 0 };
    act(() => {
      res = result.current.importBookmarks(JSON.stringify([{ input: "tx1", type: "txid", grade: "A", score: 90, savedAt: 1 }]));
    });
    expect(res).toEqual({ imported: 0, error: "storage_full" });
  });
});
