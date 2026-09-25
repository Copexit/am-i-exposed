import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeTx, makeVin, makeVout } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";
import type { MempoolOutspend } from "@/lib/api/types";
import type { AutoTraceProgress } from "../auto-trace-logic";
import type { GraphNode } from "../graph-reducer";

const computeBoltzmann = vi.fn();
vi.mock("@/lib/analysis/boltzmann-compute", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analysis/boltzmann-compute")>()),
  computeBoltzmann: (...args: unknown[]) => computeBoltzmann(...args),
}));

const { runAutoTraceLinkability } = await import("../auto-trace-logic");
// Warm the modules runAutoTraceLinkability imports lazily, so fake timers see every hop's delay
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

function run() {
  const outspends: Record<string, MempoolOutspend[]> = {
    [start.txid]: [{ spent: true, txid: child.txid, vin: 0, status: { confirmed: true } }],
    [child.txid]: [],
  };
  const client = {
    getTransaction: vi.fn(async () => child),
    getTxOutspends: vi.fn(async (txid: string) => outspends[txid]),
  };
  const progress: (AutoTraceProgress | null)[] = [];
  const nodes = new Map<string, GraphNode>([[start.txid, { txid: start.txid, tx: start, depth: 0 }]]);
  const done = runAutoTraceLinkability(client, start.txid, 0, new AbortController().signal, {
    dispatch: vi.fn(),
    getState: () => ({ nodes, maxNodes: 200 }),
    onProgress: (p) => progress.push(p),
    onTracingChange: vi.fn(),
  });
  return { client, progress, done };
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
  it("stops at a hop whose linkability is unknown (Boltzmann returned null) instead of assuming 100%", async () => {
    computeBoltzmann.mockResolvedValue(null);
    const { client, progress, done } = run();
    await vi.runAllTimersAsync();
    await done;

    expect(computeBoltzmann).toHaveBeenCalledTimes(1);
    // Never continues past the unknown hop
    expect(client.getTxOutspends).toHaveBeenCalledTimes(1);
    const reasons = progress.filter((p) => p).map((p) => p!.reason);
    // The hop ends as unknown, not as a 100% compound
    expect(reasons.at(-1)).toBe("linkability unknown");
  });

  it("compounds the known probability when Boltzmann returns a matrix", async () => {
    computeBoltzmann.mockResolvedValue({ matLnkProbabilities: [[0.5, 0.5], [0.5, 0.5]] });
    const { client, progress, done } = run();
    await vi.runAllTimersAsync();
    await done;

    const reasons = progress.filter((p) => p).map((p) => p!.reason);
    expect(reasons).toContain("compound: 50%");
    // Continued to the next hop (child's outputs are unspent there)
    expect(client.getTxOutspends).toHaveBeenCalledTimes(2);
  });
});
