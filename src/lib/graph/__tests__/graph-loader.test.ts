import { describe, it, expect, vi } from "vitest";
import { loadSavedGraph } from "../graph-loader";
import type { GraphExpansionFetcher } from "../graph-reducer";
import type { SavedGraphNode } from "../saved-graph-types";
import { makeTx } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

const id = (c: string) => c.repeat(64);

function fetcher(fail: Set<string> = new Set()): GraphExpansionFetcher {
  return {
    getTransaction: vi.fn((txid: string) =>
      fail.has(txid) ? Promise.reject(new Error("404")) : Promise.resolve(makeTx({ txid })),
    ),
    getTxOutspends: vi.fn(() => Promise.resolve([])),
  };
}

// a <- root -> b  (a is a parent, b a child)
const chain: SavedGraphNode[] = [
  { txid: id("0"), depth: 0 },
  { txid: id("a"), depth: -1, childEdge: { toTxid: id("0"), inputIndex: 0 } },
  { txid: id("b"), depth: 1, parentEdge: { fromTxid: id("0"), outputIndex: 1 } },
];

describe("loadSavedGraph", () => {
  it("hydrates every node with its tx, depth and copied edges", async () => {
    const onProgress = vi.fn();
    const r = await loadSavedGraph({ nodes: chain, rootTxid: id("0"), rootTxids: [id("0")] }, fetcher(), onProgress);
    expect([...r.nodes.keys()]).toEqual([id("0"), id("a"), id("b")]);
    expect(r.nodes.get(id("b"))).toMatchObject({ depth: 1, parentEdge: { fromTxid: id("0"), outputIndex: 1 } });
    expect(r.nodes.get(id("a"))?.tx.txid).toBe(id("a"));
    expect(r.nodes.get(id("b"))?.parentEdge).not.toBe(chain[2]?.parentEdge);
    expect(r.failedTxids).toEqual([]);
    expect([...r.rootTxids]).toEqual([id("0")]);
    expect(onProgress).toHaveBeenLastCalledWith(3, 3);
  });

  it("fetches in batches of five", async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ txid: id(i.toString(16)), depth: i }));
    const fx = fetcher();
    const onProgress = vi.fn();
    const r = await loadSavedGraph({ nodes, rootTxid: id("0"), rootTxids: [] }, fx, onProgress);
    expect(r.nodes.size).toBe(12);
    expect(fx.getTransaction).toHaveBeenCalledTimes(12);
    expect(onProgress.mock.calls.map((c) => c[0] as number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // empty rootTxids falls back to the root
    expect([...r.rootTxids]).toEqual([id("0")]);
  });

  it("drops failed nodes, clears dangling edges and re-picks the root", async () => {
    const r = await loadSavedGraph(
      { nodes: chain, rootTxid: id("0"), rootTxids: [id("0"), id("b")] },
      fetcher(new Set([id("0")])),
    );
    expect(r.failedTxids).toEqual([id("0")]);
    expect(r.nodes.get(id("a"))?.childEdge).toBeUndefined();
    expect(r.nodes.get(id("b"))?.parentEdge).toBeUndefined();
    expect(r.rootTxid).toBe(id("a"));
    expect([...r.rootTxids]).toEqual([id("b")]);
  });

  it("returns an empty result when everything fails", async () => {
    const r = await loadSavedGraph(
      { nodes: chain, rootTxid: id("0"), rootTxids: [id("0")] },
      fetcher(new Set(chain.map((n) => n.txid))),
    );
    expect(r.nodes.size).toBe(0);
    expect(r.rootTxid).toBe("");
    expect(r.rootTxids.size).toBe(0);
    expect(r.failedTxids).toHaveLength(3);
  });

  it("stops fetching once aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const fx = fetcher();
    const r = await loadSavedGraph({ nodes: chain, rootTxid: id("0"), rootTxids: [] }, fx, undefined, ac.signal);
    expect(fx.getTransaction).not.toHaveBeenCalled();
    expect(r.nodes.size).toBe(0);
  });
});
