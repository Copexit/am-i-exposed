import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeTx, makeVin, makeVout, makeOpReturnVout } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";
import type { MempoolOutspend, MempoolTransaction } from "@/lib/api/types";
import type { AutoTraceProgress } from "../auto-trace-logic";
import type { GraphAction, GraphNode } from "../graph-reducer";

const computeBoltzmann = vi.fn();
vi.mock("@/lib/analysis/boltzmann-compute", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analysis/boltzmann-compute")>()),
  computeBoltzmann: (...args: unknown[]) => computeBoltzmann(...args),
}));

const { runAutoTrace, runAutoTraceLinkability } = await import("../auto-trace-logic");
// Warm the modules the runners import lazily, so fake timers see every hop's delay
await import("@/lib/graph/autoTrace");
await import("@/lib/analysis/boltzmann-compute");

const prevout = (address: string, value: number) => ({
  scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: address, value,
});

// Start tx S; its output 0 is spent by child C (2 inputs, change back to the input address)
const start = makeTx({ txid: "s".repeat(64), vout: [makeVout({ value: 50_000, scriptpubkey_address: "bc1q_a" })] });
const child = makeTx({
  txid: "c".repeat(64),
  vin: [
    makeVin({ txid: start.txid, vout: 0, prevout: prevout("bc1q_a", 50_000) }),
    makeVin({ txid: "x".repeat(64), vout: 0, prevout: prevout("bc1q_b", 40_000) }),
  ],
  vout: [
    makeVout({ value: 30_000, scriptpubkey_address: "bc1q_payee" }),
    makeVout({ value: 59_000, scriptpubkey_address: "bc1q_a" }),
  ],
});
// 1-input child with a single addressed output: trivially 100% linked, change = output 0
const sweep = makeTx({
  txid: "d".repeat(64),
  vin: [makeVin({ txid: start.txid, vout: 0, prevout: prevout("bc1q_a", 50_000) })],
  vout: [makeVout({ value: 49_000, scriptpubkey_address: "bc1q_next" })],
});
// Child with no spendable output: identifyChangeOutput returns no change
const burn = makeTx({
  txid: "e".repeat(64),
  vin: [makeVin({ txid: start.txid, vout: 0, prevout: prevout("bc1q_a", 50_000) })],
  vout: [makeOpReturnVout()],
});

const spentBy = (txid: string): MempoolOutspend[] => [{ spent: true, txid, vin: 0, status: { confirmed: true } }];

interface Scenario {
  /** Tx spending start's output 0 (default: `child`). */
  next?: MempoolTransaction;
  /** Override the outspends served per txid; an Error is thrown. */
  outspends?: Record<string, MempoolOutspend[] | Error>;
  getTxError?: Error;
  maxNodes?: number;
  /** Called on every getTxOutspends, e.g. to abort mid-trace. */
  onOutspends?: (controller: AbortController) => void;
}

function harness(s: Scenario = {}) {
  const next = s.next ?? child;
  const outspends: Record<string, MempoolOutspend[] | Error> = {
    [start.txid]: spentBy(next.txid),
    [next.txid]: [],
    ...s.outspends,
  };
  const controller = new AbortController();
  const client = {
    getTransaction: vi.fn(async (txid: string) => {
      if (s.getTxError) throw s.getTxError;
      if (txid !== next.txid) throw new Error(`no tx fixture for ${txid}`);
      return next;
    }),
    getTxOutspends: vi.fn(async (txid: string) => {
      s.onOutspends?.(controller);
      const found = outspends[txid];
      if (!found) throw new Error(`no outspends fixture for ${txid}`);
      if (found instanceof Error) throw found;
      return found;
    }),
  };
  const progress: (AutoTraceProgress | null)[] = [];
  const actions: GraphAction[] = [];
  const tracing: boolean[] = [];
  const nodes = new Map<string, GraphNode>([[start.txid, { txid: start.txid, tx: start, depth: 0 }]]);
  const callbacks = {
    dispatch: (a: GraphAction) => actions.push(a),
    getState: () => ({ nodes, maxNodes: s.maxNodes ?? 200 }),
    onProgress: (p: AutoTraceProgress | null) => progress.push(p),
    onTracingChange: (t: boolean) => tracing.push(t),
  };
  const reasons = () =>
    progress.filter((p) => p).map((p) => (p!.percent === undefined ? p!.reason : `${p!.reason}:${p!.percent}`));
  const added = () => actions.filter((a) => a.type === "ADD_NODE");
  const errors = () => actions.flatMap((a) => (a.type === "SET_ERROR" ? [a.error] : []));
  return { client, controller, callbacks, progress, reasons, added, errors, tracing };
}

/** Run a trace to completion under fake timers. */
async function settle<T>(done: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return done;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", class {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  computeBoltzmann.mockReset();
});

describe("runAutoTraceLinkability", () => {
  const trace = (h: ReturnType<typeof harness>, opts?: Parameters<typeof runAutoTraceLinkability>[5]) =>
    settle(runAutoTraceLinkability(h.client, start.txid, 0, h.controller.signal, h.callbacks, opts));

  it("stops at a hop whose linkability is unknown (Boltzmann returned null) instead of assuming 100%", async () => {
    computeBoltzmann.mockResolvedValue(null);
    const h = harness();
    await trace(h);

    expect(computeBoltzmann).toHaveBeenCalledTimes(1);
    // Never continues past the unknown hop
    expect(h.client.getTxOutspends).toHaveBeenCalledTimes(1);
    // The hop ends as unknown, not as a 100% compound
    expect(h.reasons().at(-1)).toBe("linkability-unknown");
  });

  it("treats a throwing Boltzmann computation as unknown linkability", async () => {
    computeBoltzmann.mockRejectedValue(new Error("wasm failed"));
    const h = harness();
    await trace(h);
    expect(h.reasons().at(-1)).toBe("linkability-unknown");
  });

  it("compounds the known probability when Boltzmann returns a matrix", async () => {
    computeBoltzmann.mockResolvedValue({ matLnkProbabilities: [[0.5, 0.5], [0.5, 0.5]] });
    const h = harness();
    await trace(h);

    expect(h.reasons()).toContain("compound:50");
    // Continued to the next hop (child's outputs are unspent there)
    expect(h.client.getTxOutspends).toHaveBeenCalledTimes(2);
    expect(h.reasons().at(-1)).toBe("unspent");
  });

  it("resolves with the stop reason", async () => {
    computeBoltzmann.mockResolvedValue(null);
    expect(await trace(harness())).toBe("linkability-unknown");
    expect(await trace(harness({ outspends: { [start.txid]: [{ spent: false }] } }))).toBe("unspent");
    expect(await trace(harness({ next: burn }))).toBe("no-spendable");
  });

  it("resolves null when aborted", async () => {
    const h = harness({ onOutspends: (c) => c.abort() });
    expect(await trace(h)).toBeNull();
  });

  it("stores a freshly computed Boltzmann result in the cache", async () => {
    const result = { matLnkProbabilities: [[0.5, 0.5], [0.5, 0.5]] };
    computeBoltzmann.mockResolvedValue(result);
    const cache = new Map();
    await trace(harness(), { boltzmannCache: cache });
    expect(cache.get(child.txid)).toBe(result);
  });

  it("uses a cached Boltzmann result instead of computing", async () => {
    const cache = new Map([[child.txid, { matLnkProbabilities: [[0.5, 0.5], [0.5, 0.5]] }]]);
    const h = harness();
    await trace(h, { boltzmannCache: cache as never });
    expect(computeBoltzmann).not.toHaveBeenCalled();
    expect(h.reasons()).toContain("compound:50");
  });

  it("stops below the threshold", async () => {
    computeBoltzmann.mockResolvedValue({ matLnkProbabilities: [[0.5, 0.5], [0.01, 0.5]] });
    const h = harness();
    await trace(h);
    expect(h.reasons().slice(-2)).toEqual(["compound:1", "below-threshold:5"]);
    expect(h.client.getTxOutspends).toHaveBeenCalledTimes(1);
  });

  it("follows a single-input hop at 100% without computing Boltzmann", async () => {
    const h = harness({ next: sweep });
    await trace(h);
    expect(computeBoltzmann).not.toHaveBeenCalled();
    expect(h.reasons()).toContain("compound:100");
    expect(h.added()).toHaveLength(1);
    // Went on to the next hop, where the output is unspent
    expect(h.client.getTxOutspends).toHaveBeenCalledTimes(2);
    expect(h.reasons().at(-1)).toBe("unspent");
  });

  it("stops at a hop with no change output, reporting the terminal reason", async () => {
    const h = harness({ next: burn });
    await trace(h);
    expect(h.reasons().at(-1)).toBe("no-spendable");
    expect(h.client.getTxOutspends).toHaveBeenCalledTimes(1);
  });

  it("stops when the start output is unspent", async () => {
    const h = harness({ outspends: { [start.txid]: [{ spent: false }] } });
    await trace(h);
    expect(h.reasons().at(-1)).toBe("unspent");
    expect(h.client.getTransaction).not.toHaveBeenCalled();
    expect(h.added()).toHaveLength(0);
  });

  it("reports an error when outspends cannot be fetched", async () => {
    const h = harness({ outspends: { [start.txid]: new Error("503") } });
    expect(await trace(h)).toBe("fetch-failed");
    expect(h.errors()).toEqual(["Linkability trace: failed to fetch outspends"]);
    expect(h.client.getTransaction).not.toHaveBeenCalled();
    expect(h.added()).toHaveLength(0);
    expect(h.tracing).toEqual([true, false]);
    expect(h.progress.at(-1)).toBeNull();
  });

  it("reports an error when the child tx cannot be fetched", async () => {
    const h = harness({ getTxError: new Error("404") });
    await trace(h);
    expect(h.errors()).toEqual(["Linkability trace: 404"]);
    expect(h.added()).toHaveLength(0);
  });

  it("does not fetch anything once the graph is at max nodes", async () => {
    const h = harness({ maxNodes: 1 });
    await trace(h);
    expect(h.client.getTxOutspends).not.toHaveBeenCalled();
    expect(h.added()).toHaveLength(0);
    expect(h.tracing).toEqual([true, false]);
  });

  it("stops after maxHops", async () => {
    computeBoltzmann.mockResolvedValue({ matLnkProbabilities: [[0.5, 0.5], [0.5, 0.5]] });
    const h = harness();
    await trace(h, { maxHops: 1 });
    expect(h.client.getTxOutspends).toHaveBeenCalledTimes(1);
    expect(h.added()).toHaveLength(1);
  });

  it("stops when aborted mid-trace", async () => {
    const h = harness({ onOutspends: (c) => c.abort() });
    await trace(h);
    expect(h.client.getTxOutspends).toHaveBeenCalledTimes(1);
    expect(h.client.getTransaction).not.toHaveBeenCalled();
    expect(h.added()).toHaveLength(0);
    expect(h.tracing).toEqual([true, false]);
  });
});

describe("runAutoTrace (peel chain)", () => {
  const trace = (h: ReturnType<typeof harness>, maxHops = 10) =>
    settle(runAutoTrace(h.client, start.txid, 0, maxHops, h.controller.signal, h.callbacks));

  it("follows the change output hop by hop until an unspent output", async () => {
    const h = harness({ next: sweep });
    await trace(h);
    expect(h.added()).toHaveLength(1);
    expect(h.reasons()).toEqual(["starting", "expanding", "single-spendable", "expanding", "unspent"]);
    expect(h.tracing).toEqual([true, false]);
    expect(h.progress.at(-1)).toBeNull();
  });

  it("resolves with the stop reason", async () => {
    expect(await trace(harness({ next: sweep }))).toBe("unspent");
    expect(await trace(harness({ next: burn }))).toBe("no-spendable");
    expect(await trace(harness({ maxNodes: 1 }))).toBe("max-nodes");
  });

  it("stops at a terminal hop with no change output", async () => {
    const h = harness({ next: burn });
    await trace(h);
    expect(h.reasons().at(-1)).toBe("no-spendable");
    expect(h.client.getTxOutspends).toHaveBeenCalledTimes(1);
  });

  it("reports an error when outspends cannot be fetched", async () => {
    const h = harness({ outspends: { [start.txid]: new Error("503") } });
    await trace(h);
    expect(h.errors()).toEqual(["Auto-trace: failed to fetch outspends"]);
  });

  it("reports an error when the child tx cannot be fetched", async () => {
    const h = harness({ getTxError: new Error("boom") });
    await trace(h);
    expect(h.errors()).toEqual(["Auto-trace: boom"]);
    expect(h.added()).toHaveLength(0);
  });

  it("reports an error at max nodes", async () => {
    const h = harness({ maxNodes: 1 });
    await trace(h);
    expect(h.errors()).toEqual(["Auto-trace stopped: max nodes reached"]);
    expect(h.client.getTxOutspends).not.toHaveBeenCalled();
  });

  it("stops when aborted mid-trace", async () => {
    const h = harness({ onOutspends: (c) => c.abort() });
    await trace(h);
    expect(h.client.getTransaction).not.toHaveBeenCalled();
    expect(h.added()).toHaveLength(0);
  });
});
