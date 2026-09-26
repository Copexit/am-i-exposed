import { describe, it, expect, vi, beforeEach } from "vitest";
import { expandInputOp, expandOutputOp, type ExpansionContext } from "../graph-expansion-ops";
import type { GraphAction, GraphExpansionFetcher, GraphNode } from "../graph-reducer";
import type { MempoolOutspend, MempoolTransaction } from "@/lib/api/types";
import {
  makeTx, makeVin, makeVout, makeCoinbaseVin, makeOutspend, resetAddrCounter,
} from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

const id = (c: string) => c.repeat(64);
const ROOT = id("0");

function setup(opts: {
  root?: MempoolTransaction;
  txs?: MempoolTransaction[];
  outspends?: MempoolOutspend[] | Error;
  addressTxs?: Record<string, MempoolTransaction[]>;
  maxNodes?: number;
  extraNodes?: GraphNode[];
  noFetcher?: boolean;
}) {
  const root = opts.root ?? makeTx({ txid: ROOT });
  const nodes = new Map<string, GraphNode>([[ROOT, { txid: ROOT, tx: root, depth: 0 }]]);
  for (const n of opts.extraNodes ?? []) nodes.set(n.txid, n);
  const byId = new Map((opts.txs ?? []).map((t) => [t.txid, t]));
  const fetcher: GraphExpansionFetcher = {
    getTransaction: vi.fn((txid: string) => {
      const t = byId.get(txid);
      return t ? Promise.resolve(t) : Promise.reject(new Error(`no ${txid}`));
    }),
    getTxOutspends: vi.fn(() =>
      opts.outspends instanceof Error ? Promise.reject(opts.outspends) : Promise.resolve(opts.outspends ?? []),
    ),
    ...(opts.addressTxs
      ? { getAddressTxs: vi.fn((a: string) => Promise.resolve(opts.addressTxs?.[a] ?? [])) }
      : {}),
  };
  const actions: GraphAction[] = [];
  const ctx: ExpansionContext = {
    dispatch: (a) => actions.push(a),
    getNodes: () => nodes,
    getMaxNodes: () => opts.maxNodes ?? 50,
    getFetcher: () => (opts.noFetcher ? null : fetcher),
  };
  const errors = () => actions.filter((a) => a.type === "SET_ERROR");
  const added = () => actions.flatMap((a) => (a.type === "ADD_NODE" ? [a.node] : []));
  return { ctx, fetcher, actions, errors, added };
}

beforeEach(() => resetAddrCounter());

describe("expandInputOp", () => {
  it("adds the parent one level back with a child edge, wrapped in loading", async () => {
    const root = makeTx({ txid: ROOT, vin: [makeVin(), makeVin({ txid: id("p") })] });
    const s = setup({ root, txs: [makeTx({ txid: id("p") })] });
    await expandInputOp(s.ctx, ROOT, 1);
    expect(s.added()).toEqual([
      expect.objectContaining({ txid: id("p"), depth: -1, childEdge: { toTxid: ROOT, inputIndex: 1 } }),
    ]);
    expect(s.actions[0]).toEqual({ type: "SET_LOADING", txid: id("p"), loading: true });
    expect(s.actions.at(-1)).toEqual({ type: "SET_LOADING", txid: id("p"), loading: false });
  });

  it("reports missing client, unknown node and max nodes", async () => {
    const root = makeTx({ txid: ROOT, vin: [makeVin({ txid: id("p") })] });
    const a = setup({ root, noFetcher: true });
    await expandInputOp(a.ctx, ROOT, 0);
    const b = setup({ root });
    await expandInputOp(b.ctx, id("9"), 0);
    const c = setup({ root, maxNodes: 1 });
    await expandInputOp(c.ctx, ROOT, 0);
    expect([a, b, c].map((s) => s.errors().map((e) => e.type === "SET_ERROR" && e.error))).toEqual([
      ["No API client available"],
      ["Transaction not found in graph"],
      ["Maximum nodes reached"],
    ]);
  });

  it("is a no-op for coinbase inputs, bad indexes and parents already in the graph", async () => {
    const root = makeTx({ txid: ROOT, vin: [makeCoinbaseVin(), makeVin({ txid: id("p") })] });
    const s = setup({ root, extraNodes: [{ txid: id("p"), tx: makeTx({ txid: id("p") }), depth: -1 }] });
    await expandInputOp(s.ctx, ROOT, 0);
    await expandInputOp(s.ctx, ROOT, 5);
    await expandInputOp(s.ctx, ROOT, 1);
    expect(s.actions).toEqual([]);
  });

  it("dispatches the fetch error against the parent txid", async () => {
    const root = makeTx({ txid: ROOT, vin: [makeVin({ txid: id("p") })] });
    const s = setup({ root });
    await expandInputOp(s.ctx, ROOT, 0);
    expect(s.errors()).toEqual([{ type: "SET_ERROR", txid: id("p"), error: `no ${id("p")}` }]);
  });
});

describe("expandOutputOp", () => {
  const root = () => makeTx({ txid: ROOT, vout: [makeVout(), makeVout(), makeVout()] });

  it("follows the requested output, wrapping to the next spent one", async () => {
    const s = setup({
      root: root(),
      txs: [makeTx({ txid: id("c") })],
      outspends: [makeOutspend({ spent: true, txid: id("c"), vin: 0 }), makeOutspend(), makeOutspend()],
    });
    await expandOutputOp(s.ctx, ROOT, 1);
    expect(s.added()).toEqual([
      expect.objectContaining({ txid: id("c"), depth: 1, parentEdge: { fromTxid: ROOT, outputIndex: 0 } }),
    ]);
    expect(s.actions.at(-1)).toEqual({ type: "SET_LOADING", txid: `${ROOT}:out`, loading: false });
  });

  it("distinguishes unspent outputs from children already in the graph", async () => {
    const unspent = setup({ root: root(), outspends: [makeOutspend(), makeOutspend(), makeOutspend()] });
    await expandOutputOp(unspent.ctx, ROOT, 0);
    expect(unspent.errors()).toEqual([{ type: "SET_ERROR", txid: `${ROOT}:out`, error: "Output not yet spent" }]);

    const known = setup({
      root: root(),
      outspends: [makeOutspend({ spent: true, txid: id("c") }), makeOutspend(), makeOutspend()],
      extraNodes: [{ txid: id("c"), tx: makeTx({ txid: id("c") }), depth: 1 }],
    });
    await expandOutputOp(known.ctx, ROOT, 0);
    expect(known.errors()[0]).toMatchObject({ error: "All spent outputs already in graph" });
  });

  it("falls back to address history when outspends fail", async () => {
    const r = root();
    const addr = r.vout[2]?.scriptpubkey_address ?? "";
    const child = makeTx({ txid: id("c"), vin: [makeVin({ txid: ROOT, vout: 2 })] });
    const decoy = makeTx({ txid: id("d"), vin: [makeVin({ txid: ROOT, vout: 0 })] });
    const s = setup({ root: r, outspends: new Error("404"), addressTxs: { [addr]: [r, decoy, child] } });
    await expandOutputOp(s.ctx, ROOT, 2);
    expect(s.added()).toEqual([
      expect.objectContaining({ txid: id("c"), parentEdge: { fromTxid: ROOT, outputIndex: 2 } }),
    ]);
  });

  it("uses the fallback when a spent outspend lacks a txid, skipping zero-value outputs", async () => {
    const r = makeTx({ txid: ROOT, vout: [makeVout({ value: 0 }), makeVout()] });
    const s = setup({
      root: r,
      outspends: [makeOutspend({ spent: true }), makeOutspend()],
      addressTxs: {},
    });
    await expandOutputOp(s.ctx, ROOT, 0);
    expect(s.fetcher.getAddressTxs).toHaveBeenCalledTimes(1);
    expect(s.fetcher.getAddressTxs).toHaveBeenCalledWith(r.vout[1]?.scriptpubkey_address);
    expect(s.errors()[0]).toMatchObject({ error: "Output not yet spent" });
  });

  it("explains a failed lookup without an address fallback", async () => {
    const s = setup({ root: root(), outspends: new Error("down") });
    await expandOutputOp(s.ctx, ROOT, 0);
    expect(s.errors()[0]).toMatchObject({ error: "Output not yet spent or address has no other transactions" });
  });

  it("reports a child fetch error and the max-nodes guard", async () => {
    const s = setup({ root: root(), outspends: [makeOutspend({ spent: true, txid: id("c") })] });
    await expandOutputOp(s.ctx, ROOT, 0);
    expect(s.errors()[0]).toMatchObject({ error: `no ${id("c")}` });

    const full = setup({ root: root(), maxNodes: 1 });
    await expandOutputOp(full.ctx, ROOT, 0);
    expect(full.actions).toEqual([{ type: "SET_ERROR", txid: `${ROOT}:out`, error: "Maximum nodes reached" }]);
  });
});
