import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/analysis/entity-filter/entity-match", () => ({ matchEntitySync: vi.fn<(a: string) => EntityMatch | null>(() => null) }));
vi.mock("@/lib/graph/autoTrace", () => ({ identifyChangeOutput: vi.fn(() => ({ changeOutputIndex: null })) }));

import type { EntityMatch } from "@/lib/analysis/entity-filter/types";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { identifyChangeOutput } from "@/lib/graph/autoTrace";

import { addLayersToNodes, cascadeRemoveUnreachable } from "../graph-helpers";
import type { GraphNode } from "../graph-reducer";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import type { MempoolTransaction } from "@/lib/api/types";
import {
  makeTx, makeVin, makeVout, makeOutspend, resetAddrCounter,
} from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

const id = (c: string) => c.repeat(64);
const ROOT = id("0");

const layer = (depth: number, ...txs: MempoolTransaction[]): TraceLayer => ({
  depth,
  txs: new Map(txs.map((t) => [t.txid, t])),
});
const two = () => [makeVout(), makeVout()];

const match = vi.mocked(matchEntitySync);
const changeIdx = vi.mocked(identifyChangeOutput);

beforeEach(() => {
  resetAddrCounter();
  match.mockReset();
  match.mockReturnValue(null);
  changeIdx.mockReset();
  changeIdx.mockReturnValue({ changeOutputIndex: null, reason: "no-spendable", confidence: "none" });
});

describe("addLayersToNodes", () => {
  // root spends p1 (input 1); p1 spends p2; c1 spends root:1; c2 spends c1:0
  const build = () => {
    const root = makeTx({ txid: ROOT, vin: [makeVin(), makeVin({ txid: id("1") })], vout: two() });
    const p1 = makeTx({ txid: id("1"), vin: [makeVin(), makeVin({ txid: id("2") })], vout: two() });
    const p2 = makeTx({ txid: id("2"), vin: [makeVin(), makeVin()], vout: two() });
    const stray = makeTx({ txid: id("s"), vin: [makeVin(), makeVin()], vout: two() });
    const c1 = makeTx({ txid: id("c"), vin: [makeVin({ txid: ROOT, vout: 1 }), makeVin()], vout: two() });
    const c2 = makeTx({ txid: id("d"), vin: [makeVin({ txid: id("c"), vout: 0 }), makeVin()], vout: two() });
    const nodes = new Map<string, GraphNode>([[ROOT, { txid: ROOT, tx: root, depth: 0 }]]);
    const outspends = [makeOutspend(), makeOutspend({ spent: true, txid: id("c") })];
    return { root, p1, p2, stray, c1, c2, nodes, outspends };
  };

  it("links two layers each way when smart filtering is off", () => {
    const g = build();
    addLayersToNodes(
      g.nodes, ROOT, g.root, 0, 50,
      [layer(1, g.p1, g.stray), layer(2, g.p2)],
      [layer(1, g.c1), layer(2, g.c2)],
      g.outspends, false,
    );
    expect(g.nodes.get(id("1"))).toMatchObject({ depth: -1, childEdge: { toTxid: ROOT, inputIndex: 1 } });
    expect(g.nodes.get(id("2"))).toMatchObject({ depth: -2, childEdge: { toTxid: id("1"), inputIndex: 1 } });
    expect(g.nodes.get(id("c"))).toMatchObject({ depth: 1, parentEdge: { fromTxid: ROOT, outputIndex: 1 } });
    expect(g.nodes.get(id("d"))).toMatchObject({ depth: 2, parentEdge: { fromTxid: id("c"), outputIndex: 0 } });
    // unconnected tx is skipped; no relevance data without smart filtering
    expect(g.nodes.has(id("s"))).toBe(false);
    expect(g.nodes.get(id("1"))?.relevanceScore).toBeUndefined();
  });

  it("links forward txs by their inputs without outspends and drops ones that do not connect", () => {
    const g = build();
    addLayersToNodes(g.nodes, ROOT, g.root, 0, 50, undefined, [layer(1, g.c1, g.stray), layer(2, g.p2)], undefined, false);
    expect([...g.nodes.keys()]).toEqual([ROOT, id("c")]);
  });

  it("falls back to outspends for a forward layer-0 tx", () => {
    const g = build();
    // stray does not reference root in its inputs, but outspends say it spends root:1
    addLayersToNodes(g.nodes, ROOT, g.root, 0, 50, undefined, [layer(1, g.stray)],
      [makeOutspend(), makeOutspend({ spent: true, txid: id("s") })], false);
    expect(g.nodes.get(id("s"))?.parentEdge).toEqual({ fromTxid: ROOT, outputIndex: 1 });
  });

  it("stops at maxNodes", () => {
    const g = build();
    addLayersToNodes(g.nodes, ROOT, g.root, 0, 2, [layer(1, g.p1), layer(2, g.p2)], [layer(1, g.c1)], g.outspends, false);
    expect([...g.nodes.keys()]).toEqual([ROOT, id("1")]);
  });

  it("offsets depths from baseDepth", () => {
    const g = build();
    g.nodes.set(ROOT, { txid: ROOT, tx: g.root, depth: 3 });
    addLayersToNodes(g.nodes, ROOT, g.root, 3, 50, [layer(1, g.p1)], undefined, undefined, false);
    expect(g.nodes.get(id("1"))?.depth).toBe(2);
  });

  it("smart filtering keeps only relevant nodes and records why", () => {
    const g = build();
    // single-input sweep parent: 20 (sweep) + 15 (single-input) = relevant
    const sweep = makeTx({ txid: id("1"), vin: [makeVin()], vout: [makeVout()] });
    addLayersToNodes(g.nodes, ROOT, g.root, 0, 50, [layer(1, sweep)], [layer(1, g.c1)], g.outspends);
    expect(g.nodes.get(id("1"))).toMatchObject({ relevanceScore: 35, relevanceReasons: ["Sweep", "Single-input parent"] });
    // plain 2-in/2-out child scores below the threshold
    expect(g.nodes.has(id("c"))).toBe(false);
  });
});

describe("cascadeRemoveUnreachable", () => {
  const n = (txid: string, extra: Partial<GraphNode> = {}): [string, GraphNode] => [
    txid,
    { txid, tx: makeTx({ txid }), depth: 0, ...extra },
  ];

  it("keeps nodes reachable from any root through either edge direction", () => {
    const nodes = new Map<string, GraphNode>([
      n(ROOT),
      n(id("1"), { childEdge: { toTxid: ROOT, inputIndex: 0 } }),
      n(id("2"), { childEdge: { toTxid: id("1"), inputIndex: 0 } }),
      n(id("c"), { parentEdge: { fromTxid: ROOT, outputIndex: 0 } }),
      n(id("r")),
      n(id("x"), { parentEdge: { fromTxid: id("r"), outputIndex: 0 } }),
      n(id("o"), { parentEdge: { fromTxid: id("gone"), outputIndex: 0 } }),
    ]);
    cascadeRemoveUnreachable(nodes, new Set([ROOT, id("r"), id("missing")]));
    expect([...nodes.keys()].sort()).toEqual([ROOT, id("1"), id("2"), id("c"), id("r"), id("x")].sort());
  });

  it("removes everything when no root is present", () => {
    const nodes = new Map<string, GraphNode>([n(id("1")), n(id("2"))]);
    cascadeRemoveUnreachable(nodes, new Set([ROOT]));
    expect(nodes.size).toBe(0);
  });

  describe("smart start ranking", () => {
    const hex = (n: number) => n.toString(16).padStart(64, "0");
    const sweepParent = (n: number) => makeTx({ txid: hex(n), vin: [makeVin()], vout: [makeVout()] });
    const rootNodes = (root: MempoolTransaction) => new Map<string, GraphNode>([[ROOT, { txid: ROOT, tx: root, depth: 0 }]]);
    const kept = (nodes: Map<string, GraphNode>, depth: number) =>
      [...nodes.values()].filter((n) => n.depth === depth).map((n) => n.txid);

    it("keeps the 3 best of 10 scoring parents, ties broken by value", () => {
      const parents = Array.from({ length: 10 }, (_, i) => sweepParent(i + 1));
      const root = makeTx({
        txid: ROOT,
        vin: parents.map((p, i) => makeVin({ txid: p.txid, prevout: { ...makeVin().prevout!, value: 1000 * (i + 1) } })),
        vout: two(),
      });
      const nodes = rootNodes(root);
      addLayersToNodes(nodes, ROOT, root, 0, 50, [layer(1, ...parents)], undefined);
      expect(kept(nodes, -1)).toEqual([hex(10), hex(9), hex(8)]);
    });

    it("the child spending the root's change always wins a slot", () => {
      const root = makeTx({ txid: ROOT, vin: [makeVin(), makeVin()], vout: Array.from({ length: 5 }, () => makeVout()) });
      changeIdx.mockReturnValue({ changeOutputIndex: 4, reason: "single-spendable", confidence: "high" });
      // four consolidating payment children (25 + 15 = 40) outscore the plain change child (35)
      const kids = Array.from({ length: 5 }, (_, i) => makeTx({
        txid: hex(100 + i),
        vin: [makeVin({ txid: ROOT, vout: i }), ...Array.from({ length: 4 }, () => makeVin())],
        vout: two(),
      }));
      const change = makeTx({ txid: hex(100 + 4), vin: [makeVin({ txid: ROOT, vout: 4 }), makeVin()], vout: two() });
      kids[4] = change;
      const nodes = rootNodes(root);
      addLayersToNodes(nodes, ROOT, root, 0, 50, undefined, [layer(1, ...kids)]);
      const fw = kept(nodes, 1);
      expect(fw).toHaveLength(3);
      expect(fw).toContain(change.txid);
      expect(nodes.get(change.txid)?.parentEdge).toEqual({ fromTxid: ROOT, outputIndex: 4 });
    });

    it("an entity neighbour always wins a slot", () => {
      const root = makeTx({ txid: ROOT, vin: [], vout: two() });
      // consolidation (25) paying to the root's input address (20) = 45 > plain entity parent (40)
      const strong = Array.from({ length: 4 }, (_, i) => {
        const addrVin = makeVin();
        return {
          parent: makeTx({
            txid: hex(200 + i),
            vin: Array.from({ length: 5 }, () => makeVin()),
            vout: [makeVout({ scriptpubkey_address: addrVin.prevout!.scriptpubkey_address })],
          }),
          vin: makeVin({ txid: hex(200 + i), prevout: addrVin.prevout }),
        };
      });
      const entityParent = makeTx({ txid: hex(299), vin: [makeVin(), makeVin()], vout: two() });
      const entityAddr = entityParent.vout[0]!.scriptpubkey_address!;
      match.mockImplementation((a) => (a === entityAddr
        ? { address: a, entityName: "Acme", category: "exchange", ofac: false, confidence: "high" }
        : null));
      root.vin = [...strong.map((s) => s.vin), makeVin({ txid: entityParent.txid })];
      const nodes = rootNodes(root);
      addLayersToNodes(nodes, ROOT, root, 0, 50, [layer(1, ...strong.map((s) => s.parent), entityParent)], undefined);
      const bw = kept(nodes, -1);
      expect(bw).toHaveLength(3);
      expect(bw).toContain(entityParent.txid);
    });

    it("second hop keeps at most 2 per side, only above the threshold, and stays connected", () => {
      const p = sweepParent(1);
      const grand = Array.from({ length: 4 }, (_, i) => sweepParent(300 + i)); // 20 + 15 - 10 = 25
      const weak = makeTx({ txid: hex(399), vin: [makeVin(), makeVin()], vout: two() }); // below threshold
      p.vin = [...grand, weak].map((g) => makeVin({ txid: g.txid }));
      const root = makeTx({ txid: ROOT, vin: [makeVin({ txid: p.txid })], vout: two() });
      const nodes = rootNodes(root);
      addLayersToNodes(nodes, ROOT, root, 0, 50, [layer(1, p), layer(2, weak, ...grand)], undefined);
      const g2 = kept(nodes, -2);
      expect(g2).toEqual([hex(300), hex(301)]);
      for (const t of g2) expect(nodes.get(t)?.childEdge?.toTxid).toBe(p.txid);
    });
  });
});
