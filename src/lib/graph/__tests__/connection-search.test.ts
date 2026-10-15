import { describe, it, expect } from "vitest";
import { makeTx, makeVin, makeVout, makeCoinbaseVin } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";
import type { MempoolOutspend, MempoolTransaction } from "@/lib/api/types";
import {
  findConnections,
  DEFAULT_CONNECTION_OPTIONS,
  type ConnectionPath,
  type ConnectionSearchOptions,
} from "../connection-search";

/** A tx spec: the outputs it spends (`parentId:vout`) and how many outputs it has. No inputs = coinbase. */
type Spec = Record<string, { ins?: string[]; outs?: number }>;

/** In-memory chain plus a fetcher that counts calls and tracks in-flight requests. */
function chain(spec: Spec, onTxCall?: (txid: string, calls: number) => void) {
  const txs = new Map<string, MempoolTransaction>();
  for (const [txid, s] of Object.entries(spec)) {
    const vin = s.ins?.length
      ? s.ins.map((ref) => {
          const [parent, vout] = ref.split(":");
          return makeVin({ txid: parent, vout: Number(vout) });
        })
      : [makeCoinbaseVin()];
    txs.set(txid, makeTx({ txid, vin, vout: Array.from({ length: s.outs ?? 1 }, () => makeVout()) }));
  }
  const outspends = new Map<string, MempoolOutspend[]>();
  for (const tx of txs.values()) outspends.set(tx.txid, tx.vout.map(() => ({ spent: false })));
  for (const tx of txs.values()) {
    tx.vin.forEach((v, i) => {
      const o = outspends.get(v.txid);
      if (o?.[v.vout]) o[v.vout] = { spent: true, txid: tx.txid, vin: i };
    });
  }
  const stats = { txCalls: 0, outspendCalls: 0, inFlight: 0, maxInFlight: 0, outspendIds: [] as string[] };
  async function track<T>(get: () => T | undefined, what: string): Promise<T> {
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await new Promise((r) => setTimeout(r, 0));
    stats.inFlight--;
    const v = get();
    if (v === undefined) throw new Error(`not found ${what}`);
    return v;
  }
  const fetcher = {
    getTransaction(txid: string) {
      stats.txCalls++;
      onTxCall?.(txid, stats.txCalls);
      return track(() => txs.get(txid), txid);
    },
    getTxOutspends(txid: string) {
      stats.outspendCalls++;
      stats.outspendIds.push(txid);
      return track(() => outspends.get(txid), txid);
    },
  };
  return { fetcher, stats };
}

async function run(
  spec: Spec,
  from: string[],
  to: string[],
  opts: Partial<ConnectionSearchOptions> = {},
  coinJoins: string[] = [],
  matchTo?: string[],
) {
  const { fetcher, stats } = chain(spec);
  const results: ConnectionPath[] = [];
  const summary = await findConnections(from, to, fetcher, { ...DEFAULT_CONNECTION_OPTIONS, ...opts }, {
    onResult: (p) => results.push(p),
    isCoinJoin: (tx) => coinJoins.includes(tx.txid),
    matchTo: matchTo && ((tx) => matchTo.includes(tx.txid)),
  });
  return { results, summary, stats };
}

const ids = (p: ConnectionPath) => p.hops.map((h) => h.txid);

/** A tree rooted at `root`: every tx has `fanout` outputs, each spent by a child, `levels` deep. */
function wideTree(root: string, fanout: number, levels: number): Spec {
  const spec: Spec = { [root]: { outs: fanout } };
  let layer = [root];
  for (let l = 1; l <= levels; l++) {
    const next: string[] = [];
    for (const p of layer) {
      for (let v = 0; v < fanout; v++) {
        const c = `${p}.${v}`;
        spec[c] = { ins: [`${p}:${v}`], outs: fanout };
        next.push(c);
      }
    }
    layer = next;
  }
  return spec;
}

describe("findConnections", () => {
  it("finds a direct spend in chain order, whichever side spends", async () => {
    const spec: Spec = { A: { outs: 2 }, B: { ins: ["A:1"] } };
    const ab = await run(spec, ["A"], ["B"]);
    expect(ab.results).toEqual([
      { kind: "direct", hops: [{ txid: "A", outIndex: 1 }, { txid: "B", inIndex: 0 }], meetTxid: expect.any(String) },
    ]);
    const ba = await run(spec, ["B"], ["A"]);
    expect(ba.results.map((r) => [r.kind, ...ids(r)])).toEqual([["direct", "A", "B"]]);
    expect(ba.summary.stoppedBy).toBe("done");
  });

  it("finds a 3-hop path where A funds B, with in/out indices", async () => {
    const spec: Spec = { A: { outs: 2 }, X: { ins: ["A:1"], outs: 2 }, Y: { ins: ["X:0"] }, B: { ins: ["Y:0"] } };
    const { results } = await run(spec, ["A"], ["B"]);
    expect(results).toEqual([{
      kind: "a-funds-b",
      hops: [
        { txid: "A", outIndex: 1 },
        { txid: "X", inIndex: 0, outIndex: 0 },
        { txid: "Y", inIndex: 0, outIndex: 0 },
        { txid: "B", inIndex: 0 },
      ],
      meetTxid: expect.any(String),
    }]);
  });

  it("finds B through matchTo alone when B has no seeds (an address without history)", async () => {
    const fwd: Spec = { A: { outs: 2 }, X: { ins: ["A:1"] }, Y: { ins: ["X:0"] }, P: { ins: ["Y:0"] } };
    const ahead = await run(fwd, ["A"], [], {}, [], ["P"]);
    expect(ahead.results.map((r) => [r.kind, ...ids(r)])).toEqual([["a-funds-b", "A", "X", "Y", "P"]]);
    const back: Spec = { P: {}, X: { ins: ["P:0"] }, A: { ins: ["X:0"] } };
    const behind = await run(back, ["A"], [], {}, [], ["P"]);
    expect(behind.results.map((r) => [r.kind, ...ids(r)])).toEqual([["b-funds-a", "P", "X", "A"]]);
  });

  it("keeps B's own links when a matched tx is also on B's chain", async () => {
    const spec: Spec = { A: { outs: 1 }, X: { ins: ["A:0"] }, Y: { ins: ["X:0"] }, B: { ins: ["Y:0"] } };
    const { results } = await run(spec, ["A"], ["B"], {}, [], ["X"]);
    expect(results.map((r) => [r.kind, ...ids(r)])).toEqual(
      expect.arrayContaining([["direct", "A", "X"], ["a-funds-b", "A", "X", "Y", "B"]]),
    );
  });

  it("finds a path where B funds A, ordered from B to A", async () => {
    const spec: Spec = { B: {}, X: { ins: ["B:0"] }, A: { ins: ["X:0"] } };
    const { results } = await run(spec, ["A"], ["B"]);
    expect(results.map((r) => [r.kind, ...ids(r)])).toEqual([["b-funds-a", "B", "X", "A"]]);
  });

  it("finds a shared ancestor, bending at the pivot", async () => {
    const spec: Spec = { P: { outs: 2 }, A: { ins: ["P:0"] }, B: { ins: ["P:1"] } };
    const { results } = await run(spec, ["A"], ["B"]);
    expect(results).toEqual([
      {
        kind: "shared-ancestor",
        hops: [{ txid: "A", inIndex: 0 }, { txid: "P", outIndex: 0 }, { txid: "B", inIndex: 0 }],
        meetTxid: "P",
        pivot: 1,
        pivotLink: { outIndex: 1 },
      },
    ]);
  });

  it("finds a shared descendant", async () => {
    const spec: Spec = { A: {}, B: {}, M: { ins: ["B:0", "A:0"] } };
    const { results } = await run(spec, ["A"], ["B"]);
    expect(results).toEqual([
      {
        kind: "shared-descendant",
        hops: [{ txid: "A", outIndex: 0 }, { txid: "M", inIndex: 1 }, { txid: "B", outIndex: 0 }],
        meetTxid: "M",
        pivot: 1,
        pivotLink: { inIndex: 0 },
      },
    ]);
  });

  it("reports no path within maxHops, and done when the chain runs out", async () => {
    const spec: Spec = {
      A: {}, X1: { ins: ["A:0"] }, X2: { ins: ["X1:0"] }, X3: { ins: ["X2:0"] }, B: { ins: ["X3:0"] },
    };
    const short = await run(spec, ["A"], ["B"], { maxHops: 1 });
    expect(short.results).toEqual([]);
    expect(short.summary.stoppedBy).toBe("hops");

    const unrelated = await run({ A: {}, B: {} }, ["A"], ["B"]);
    expect(unrelated.results).toEqual([]);
    expect(unrelated.summary.stoppedBy).toBe("done");
  });

  it("never fetches more transactions than the budget", async () => {
    const spec = { ...wideTree("A", 6, 4), B: {} };
    const { summary, stats } = await run(spec, ["A"], ["B"], { maxTxs: 20 });
    expect(summary.stoppedBy).toBe("budget");
    expect(stats.txCalls).toBeLessThanOrEqual(20);
    expect(summary.txsFetched).toBe(stats.txCalls);
  });

  it("does not traverse a CoinJoin when stopAtCoinJoins, but does when off", async () => {
    const spec: Spec = {
      A: {}, CJ: { ins: ["A:0"], outs: 2 }, X: { ins: ["CJ:1"] }, B: { ins: ["X:0"] },
    };
    const stop = await run(spec, ["A"], ["B"], {}, ["CJ"]);
    expect(stop.results).toEqual([]);
    expect(stop.summary.coinJoinStops).toBeGreaterThan(0);

    const through = await run(spec, ["A"], ["B"], { stopAtCoinJoins: false }, ["CJ"]);
    expect(through.results.map(ids)).toEqual([["A", "CJ", "X", "B"]]);
    expect(through.summary.coinJoinStops).toBe(0);
  });

  it("flags a path whose meet tx could not be checked for CoinJoin, without fetching past the budget", async () => {
    const spec: Spec = { A: {}, CJ: { ins: ["A:0"] }, B: { ins: ["CJ:0"] } };
    const { results, summary, stats } = await run(spec, ["A"], ["B"], { maxTxs: 2 }, ["CJ"]);
    expect(stats.txCalls).toBeLessThanOrEqual(2);
    expect(results.map((r) => [ids(r), r.unverified])).toEqual([[["A", "CJ", "B"], true]]);
    expect(summary.stoppedBy).toBe("budget");

    const checked = await run(spec, ["A"], ["B"], {}, ["CJ"]);
    expect(checked.results).toEqual([]);
  });

  it("counts failed transaction and outspends fetches", async () => {
    // B spends an output of Z, which the fetcher cannot find; A's outspends call fails
    const { fetcher } = chain({ A: {}, B: { ins: ["Z:0"] } });
    const summary = await findConnections(["A"], ["B"], {
      getTransaction: (txid) => fetcher.getTransaction(txid),
      getTxOutspends: (txid) => (txid === "A" ? Promise.reject(new Error("429")) : fetcher.getTxOutspends(txid)),
    }, DEFAULT_CONNECTION_OPTIONS, { onResult: () => {}, isCoinJoin: () => false });
    expect(summary.fetchErrors).toBe(2);
    expect(summary.stoppedBy).toBe("done");
  });

  it("does not expand transactions wider than branchCap", async () => {
    const spec: Spec = { A: { outs: 5 }, B: {} };
    for (let v = 0; v < 5; v++) spec[`C${v}`] = { ins: [`A:${v}`] };
    const capped = await run(spec, ["A"], ["B"], { branchCap: 4 });
    expect(capped.summary.branchLimited).toBe(1);
    expect(capped.stats.outspendIds).not.toContain("A");

    const open = await run(spec, ["A"], ["B"], { branchCap: 5 });
    expect(open.summary.branchLimited).toBe(0);
    expect(open.stats.outspendIds).toContain("A");
  });

  it("stops fetching once aborted and resolves as aborted", async () => {
    const controller = new AbortController();
    let callsAtAbort = 0;
    const { fetcher, stats } = chain({ ...wideTree("A", 5, 4), B: {} }, (_id, calls) => {
      if (calls === 6) {
        controller.abort();
        callsAtAbort = stats.txCalls + stats.outspendCalls;
      }
    });
    const summary = await findConnections(["A"], ["B"], fetcher, { ...DEFAULT_CONNECTION_OPTIONS, maxTxs: 600 }, {
      onResult: () => {},
      isCoinJoin: () => false,
    }, controller.signal);
    expect(summary.stoppedBy).toBe("aborted");
    expect(stats.txCalls + stats.outspendCalls).toBe(callsAtAbort);
  });

  it("stops at the time limit using the injected clock", async () => {
    let t = 0;
    const { summary } = await run({ ...wideTree("A", 5, 4), B: {} }, ["A"], ["B"], {
      timeoutMs: 10_000,
      now: () => (t += 1000),
    });
    expect(summary.stoppedBy).toBe("time");
  });

  it("deduplicates one path seen through several meeting points", async () => {
    const spec: Spec = {
      A: {}, X1: { ins: ["A:0"] }, X2: { ins: ["X1:0"] }, X3: { ins: ["X2:0"] }, B: { ins: ["X3:0"] },
    };
    const { results } = await run(spec, ["A"], ["B"]);
    expect(results.map(ids)).toEqual([["A", "X1", "X2", "X3", "B"]]);
  });

  it("emits the shortest paths first, at most 5 per kind", async () => {
    // A's output i reaches B's input i through i+1 intermediate txs, for i = 0..6
    const spec: Spec = { A: { outs: 7 }, B: { ins: [] } };
    const bIns: string[] = [];
    for (let i = 0; i < 7; i++) {
      let prev = `A:${i}`;
      for (let k = 0; k <= i; k++) {
        const txid = `P${i}_${k}`;
        spec[txid] = { ins: [prev] };
        prev = `${txid}:0`;
      }
      bIns.push(prev);
    }
    spec.B = { ins: bIns };
    const { results } = await run(spec, ["A"], ["B"], { maxTxs: 600 });
    expect(results.every((r) => r.kind === "a-funds-b")).toBe(true);
    expect(results.map((r) => r.hops.length)).toEqual([3, 4, 5, 6, 7]);
  });

  it("emits nothing for a txid that is both a from and a to endpoint", async () => {
    const spec: Spec = { P: { outs: 2 }, A: { ins: ["P:0"] }, X: { ins: ["P:1"] } };
    const { results, summary } = await run(spec, ["A"], ["A"]);
    expect(results).toEqual([]);
    expect(summary.stoppedBy).toBe("done");
  });

  it("never runs more than 3 fetches at once", async () => {
    const { stats } = await run({ ...wideTree("A", 4, 3), ...wideTree("B", 4, 3) }, ["A"], ["B"], { maxTxs: 600 });
    expect(stats.maxInFlight).toBeGreaterThan(1);
    expect(stats.maxInFlight).toBeLessThanOrEqual(3);
  });
});
