import { describe, it, expect } from "vitest";
import { encodeGraphToUrl, decodeGraphFromUrl } from "../graph-url-codec";
import type { SavedGraph } from "../saved-graph-types";

const A = "ab".repeat(32);
const B = "0f".repeat(31) + "e1";

function graph(txids: [string, ...string[]]): SavedGraph {
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

  it("rejects a well-formed header with zero nodes (no root)", () => {
    // version 1, nodeCount 0, rootIndex 0, multiRootCount 0, network 0
    const bytes = Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0]);
    const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeGraphFromUrl(encoded)).toBeNull();
  });

  it("rejects truncated input", () => {
    const encoded = encodeGraphToUrl(graph([A, B]));
    expect(encoded).not.toBeNull();
    expect(decodeGraphFromUrl(encoded!.slice(0, Math.floor(encoded!.length / 2)))).toBeNull();
  });
});

const toBytes = (encoded: string) =>
  Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const toUrl = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("graph-url-codec extensions", () => {
  const C = "cd".repeat(32);

  function rich(): SavedGraph {
    return {
      id: "g",
      name: "g",
      savedAt: 0,
      network: "testnet3",
      rootTxid: B,
      rootTxids: [B, C, "ee".repeat(32)],
      nodes: [
        { txid: A, depth: -1, childEdge: { toTxid: B, inputIndex: 3 } },
        { txid: B, depth: 0 },
        { txid: C, depth: 1, parentEdge: { fromTxid: B, outputIndex: 2 } },
      ],
      nodePositions: { [A]: { x: 1.5, y: -2 }, ["ff".repeat(32)]: { x: 9, y: 9 } },
      nodeLabels: { [C]: "exchange hot wallet 123456", [A]: "" },
      annotations: [
        { id: "1", type: "rect", x: 10, y: 20, width: 30, height: 40, title: "box", body: "dropped" },
        { id: "2", type: "circle", x: 0, y: 0, radius: 25, title: "ring", body: "" },
        { id: "3", type: "note", x: 5, y: 5, title: "", body: "" },
      ],
      edgeLabels: { [`${B}->${C}`]: "payment", [`${A}->nope`]: "x", bad: "y" },
    };
  }

  it("round-trips roots, edges, positions, labels, annotations and edge labels", () => {
    const decoded = decodeGraphFromUrl(encodeGraphToUrl(rich()) ?? "");
    expect(decoded).toMatchObject({
      network: "testnet3",
      rootTxid: B,
      rootTxids: [B, C],
      nodes: [
        { txid: A, depth: -1, childEdge: { toTxid: B, inputIndex: 3 } },
        { txid: B, depth: 0 },
        { txid: C, depth: 1, parentEdge: { fromTxid: B, outputIndex: 2 } },
      ],
      // labels and titles are capped at 20 chars; empty labels are skipped
      nodeLabels: { [C]: "exchange hot wallet " },
      edgeLabels: { [`${B}->${C}`]: "payment" },
    });
    expect(decoded?.nodePositions).toEqual({ [A]: { x: 1.5, y: -2 } });
    expect(decoded?.annotations?.map(({ type, x, y, width, height, radius, title, body }) =>
      ({ type, x, y, width, height, radius, title, body }))).toEqual([
      { type: "rect", x: 10, y: 20, width: 30, height: 40, radius: undefined, title: "box", body: "" },
      { type: "circle", x: 0, y: 0, width: undefined, height: undefined, radius: 25, title: "ring", body: "" },
      { type: "note", x: 5, y: 5, width: 180, height: 100, radius: undefined, title: "", body: "" },
    ]);
  });

  it("keeps a node's parent edge without inventing a child edge when both are set", () => {
    const g = graph([A, B, C]);
    g.nodes[1] = {
      txid: B,
      depth: 0,
      parentEdge: { fromTxid: A, outputIndex: 1 },
      childEdge: { toTxid: C, inputIndex: 0 },
    };
    const node = decodeGraphFromUrl(encodeGraphToUrl(g) ?? "")?.nodes[1];
    expect(node?.parentEdge).toEqual({ fromTxid: A, outputIndex: 1 });
    expect(node?.childEdge).toBeUndefined();
  });

  it("drops edges to txids outside the graph and falls back to the first root", () => {
    const g = graph([A, B]);
    g.rootTxid = C;
    g.rootTxids = [];
    g.nodes[1] = { txid: B, depth: 1, parentEdge: { fromTxid: C, outputIndex: 0 } };
    const decoded = decodeGraphFromUrl(encodeGraphToUrl(g) ?? "");
    expect(decoded?.rootTxid).toBe(A);
    expect(decoded?.rootTxids).toEqual([A]);
    expect(decoded?.nodes[1]?.parentEdge).toBeUndefined();
    expect(decoded?.nodePositions).toBeUndefined();
    expect(decoded?.annotations).toBeUndefined();
  });

  it("returns null for an empty graph or one too large for a URL", () => {
    expect(encodeGraphToUrl({ ...graph([A]), nodes: [] })).toBeNull();
    const big = Array.from({ length: 200 }, (_, i) => i.toString(16).padStart(64, "0")) as [string, ...string[]];
    expect(encodeGraphToUrl(graph(big))).toBeNull();
  });

  // Encoded by the v2 encoder (uint8 edge index) before v3 existed; must keep decoding.
  const V2_FIXTURE =
    "AgADAAEAAgABAAIDq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6v_AgABAw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw_hAAD__wDNzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3NzQEBAAHIAAEAAD_AAADAAAAAAAEAAghleGNoYW5nZQAAAAEAAQACB3BheW1lbnQ";

  it("decodes a v2 link unchanged", () => {
    expect(decodeGraphFromUrl(V2_FIXTURE)).toMatchObject({
      network: "testnet3",
      rootTxid: B,
      rootTxids: [B, C],
      nodes: [
        { txid: A, depth: -1, childEdge: { toTxid: B, inputIndex: 3 } },
        { txid: B, depth: 0 },
        { txid: C, depth: 1, parentEdge: { fromTxid: B, outputIndex: 200 } },
      ],
      nodePositions: { [A]: { x: 1.5, y: -2 } },
      nodeLabels: { [C]: "exchange" },
      edgeLabels: { [`${B}->${C}`]: "payment" },
    });
  });

  it("encodes v3 and round-trips edge indices above 255", () => {
    const g = graph([A, B, C]);
    g.nodes[1] = { txid: B, depth: 1, parentEdge: { fromTxid: A, outputIndex: 300 } };
    g.nodes[2] = { txid: C, depth: -1, childEdge: { toTxid: A, inputIndex: 65_535 } };
    const encoded = encodeGraphToUrl(g) ?? "";
    expect(toBytes(encoded)[0]).toBe(3);
    const decoded = decodeGraphFromUrl(encoded);
    expect(decoded?.nodes[1]?.parentEdge).toEqual({ fromTxid: A, outputIndex: 300 });
    expect(decoded?.nodes[2]?.childEdge).toEqual({ toTxid: A, inputIndex: 65_535 });
  });

  it("rejects unknown versions and decodes v1 without extensions", () => {
    const bytes = toBytes(V2_FIXTURE);
    expect(decodeGraphFromUrl(toUrl(Uint8Array.from([9, ...bytes.slice(1)])))).toBeNull();
    const v1 = decodeGraphFromUrl(toUrl(Uint8Array.from([1, ...bytes.slice(1)])));
    expect(v1?.nodes).toHaveLength(3);
    expect(v1?.nodeLabels).toBeUndefined();
    expect(v1?.edgeLabels).toBeUndefined();
  });

  it("tolerates a truncated extension section", () => {
    const g = graph([A]);
    g.nodeLabels = { [A]: "label" };
    const bytes = toBytes(encodeGraphToUrl(g) ?? "");
    // header 5 + multi-root 4 + network 1 + node 38 + positions 2 + label count 2 + idx 2 + len 1 + 2 of 5 bytes
    const decoded = decodeGraphFromUrl(toUrl(bytes.slice(0, 5 + 4 + 1 + 38 + 2 + 2 + 2 + 3)));
    expect(decoded?.rootTxid).toBe(A);
    expect(decoded?.nodeLabels).toEqual({ [A]: "" });
  });
});
