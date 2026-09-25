import { describe, it, expect } from "vitest";
import { encodeGraphToUrl, decodeGraphFromUrl } from "../graph-url-codec";
import type { SavedGraph } from "../saved-graph-types";

const A = "ab".repeat(32);
const B = "0f".repeat(31) + "e1";

function graph(txids: string[]): SavedGraph {
  return {
    id: "g",
    name: "g",
    savedAt: 0,
    network: "signet",
    rootTxid: txids[0],
    rootTxids: [txids[0]],
    nodes: txids.map((txid, i) => ({ txid, depth: i })),
  };
}

describe("graph-url-codec", () => {
  it("round-trips txids, depths and network", () => {
    const encoded = encodeGraphToUrl(graph([A, B]));
    expect(encoded).not.toBeNull();
    const decoded = decodeGraphFromUrl(encoded!);
    expect(decoded?.network).toBe("signet");
    expect(decoded?.rootTxid).toBe(A);
    expect(decoded?.nodes.map((n) => [n.txid, n.depth])).toEqual([[A, 0], [B, 1]]);
  });

  it("throws on a non-hex txid instead of encoding zero bytes", () => {
    expect(() => encodeGraphToUrl(graph(["zz".repeat(32)]))).toThrow();
  });

  it("throws on a txid that is not 32 bytes", () => {
    expect(() => encodeGraphToUrl(graph(["abcd"]))).toThrow();
  });
});
