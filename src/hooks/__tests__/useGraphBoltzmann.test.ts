// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { GraphNode } from "@/lib/graph/graph-reducer";
import type { MempoolTransaction } from "@/lib/api/types";
import { makeTx, makeVin, makeVout } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

const computeBoltzmann = vi.fn<(tx: MempoolTransaction, opts: { signal?: AbortSignal }) => Promise<BoltzmannWorkerResult | null>>();
vi.mock("@/lib/analysis/boltzmann-compute", () => ({
  computeBoltzmann: (tx: MempoolTransaction, opts: { signal?: AbortSignal }) => computeBoltzmann(tx, opts),
}));

import { useGraphBoltzmann } from "../useGraphBoltzmann";

const oneIn = makeTx({ txid: "one-in" });
const twoIn = makeTx({ txid: "two-in", vin: [makeVin(), makeVin()], vout: [makeVout(), makeVout({ value: 50000 })] });
const NODES_oneIn = nodesOf(oneIn);
const NODES_twoIn = nodesOf(twoIn);

function nodesOf(...txs: MempoolTransaction[]): Map<string, GraphNode> {
  return new Map(txs.map((tx, i) => [tx.txid, { txid: tx.txid, tx, depth: i }]));
}

function fakeResult(id: string): BoltzmannWorkerResult {
  return { type: "result", id, entropy: 1 } as BoltzmannWorkerResult;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("useGraphBoltzmann", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    computeBoltzmann.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("fills synthetic results for 1-input nodes without waiting for the debounce", () => {
    const { result } = renderHook(() => useGraphBoltzmann({ nodes: NODES_oneIn, rootTxid: "one-in" }));
    expect(result.current.getBoltzmannResult("one-in")?.entropy).toBe(0);
    expect(result.current.boltzmannCache.has("one-in")).toBe(true);
    expect(computeBoltzmann).not.toHaveBeenCalled();
  });

  it("serves the root result passed in and never recomputes the root", async () => {
    const rootResult = fakeResult("two-in");
    const { result } = renderHook(() =>
      useGraphBoltzmann({ nodes: NODES_twoIn, rootTxid: "two-in", rootBoltzmannResult: rootResult }),
    );
    expect(result.current.getBoltzmannResult("two-in")).toBe(rootResult);
    expect(result.current.boltzmannCache.get("two-in")).toBe(rootResult);

    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(computeBoltzmann).not.toHaveBeenCalled();
  });

  it("eagerly computes small multi-input nodes after the debounce, tracking the computing set", async () => {
    const pending = deferred<BoltzmannWorkerResult | null>();
    computeBoltzmann.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useGraphBoltzmann({ nodes: NODES_twoIn, rootTxid: "two-in" }));

    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(computeBoltzmann).toHaveBeenCalledTimes(1);
    expect(result.current.computingBoltzmann.has("two-in")).toBe(true);
    expect(result.current.getBoltzmannResult("two-in")).toBeUndefined();

    const computed = fakeResult("two-in");
    await act(async () => { pending.resolve(computed); });
    expect(result.current.computingBoltzmann.has("two-in")).toBe(false);
    expect(result.current.getBoltzmannResult("two-in")).toBe(computed);
  });

  it("triggerBoltzmann computes on demand and caches the result", async () => {
    const computed = fakeResult("two-in");
    computeBoltzmann.mockResolvedValueOnce(computed);
    const { result } = renderHook(() => useGraphBoltzmann({ nodes: NODES_twoIn, rootTxid: "two-in" }));

    await act(async () => { await result.current.triggerBoltzmann("two-in"); });
    expect(result.current.getBoltzmannResult("two-in")).toBe(computed);
  });
});
