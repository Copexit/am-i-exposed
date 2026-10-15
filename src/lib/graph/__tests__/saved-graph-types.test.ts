import { describe, it, expect } from "vitest";
import { serializeGraph, validateSavedGraph, savedHiddenTxids } from "../saved-graph-types";
import type { GraphState } from "../graph-reducer";

const txid = "c".repeat(64);
const state = {
  nodes: new Map([[txid, { txid, depth: 0 }]]),
  rootTxid: txid, rootTxids: new Set([txid]),
} as unknown as GraphState;
const base = () => serializeGraph(state, "g", "mainnet");

describe("SavedGraph layoutMode", () => {
  it("a graph without layoutMode (older saves) is valid", () => {
    const g = base();
    expect(g.layoutMode).toBeUndefined();
    expect(validateSavedGraph(g)).toBe(true);
  });

  it("accepts hops and time", () => {
    expect(validateSavedGraph({ ...base(), layoutMode: "hops" })).toBe(true);
    expect(validateSavedGraph({ ...base(), layoutMode: "time" })).toBe(true);
  });

  it("accepts an unknown layoutMode (a newer build); it opens in hops", () => {
    expect(validateSavedGraph({ ...base(), layoutMode: "chrono" })).toBe(true);
    expect(validateSavedGraph({ ...base(), layoutMode: 1 })).toBe(true);
  });

  it("serializes time mode and omits the hops default", () => {
    const args = [undefined, undefined, undefined, undefined, undefined, undefined] as const;
    expect(serializeGraph(state, "g", "mainnet", ...args, "time").layoutMode).toBe("time");
    expect(serializeGraph(state, "g", "mainnet", ...args, "hops").layoutMode).toBeUndefined();
  });
});

describe("SavedGraph hiddenTxids", () => {
  const args = [undefined, undefined, undefined, undefined, undefined, undefined, undefined] as const;

  it("round trips the hidden txids still in the graph", () => {
    const saved = serializeGraph(state, "g", "mainnet", ...args, new Set([txid, "d".repeat(64)]));
    expect(saved.hiddenTxids).toEqual([txid]);
    const back: unknown = JSON.parse(JSON.stringify(saved));
    expect(validateSavedGraph(back)).toBe(true);
    if (validateSavedGraph(back)) expect(savedHiddenTxids(back)).toEqual([txid]);
  });

  it("omits an empty set; older graphs without it load with none hidden", () => {
    expect(serializeGraph(state, "g", "mainnet", ...args, new Set()).hiddenTxids).toBeUndefined();
    expect(savedHiddenTxids(base())).toEqual([]);
  });

  it("drops malformed entries without rejecting the graph", () => {
    const g = { ...base(), hiddenTxids: [txid, "nope", 7, null] };
    expect(validateSavedGraph(g)).toBe(true);
    expect(savedHiddenTxids(g as never)).toEqual([txid]);
    expect(savedHiddenTxids({ ...base(), hiddenTxids: "x" } as never)).toEqual([]);
  });
});
