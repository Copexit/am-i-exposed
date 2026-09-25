import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/analysis/entity-filter/entity-match", () => ({ matchEntitySync: vi.fn(() => null) }));

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

beforeEach(() => resetAddrCounter());

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
});
