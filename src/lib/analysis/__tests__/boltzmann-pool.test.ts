import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { MempoolTransaction } from "@/lib/api/types";
import { computeBoltzmann } from "../boltzmann-compute";
import { getWorkerPool, onPoolTerminate, runParallelPass, terminatePool } from "../boltzmann-pool";

/** Worker stub that never replies, like a real Worker after terminate(). */
class SilentWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
}

function makeTx(txid: string, ins: number[], outs: number[]): MempoolTransaction {
  return {
    txid,
    fee: 1000,
    vin: ins.map((value) => ({ is_coinbase: false, prevout: { value } })),
    vout: outs.map((value) => ({ scriptpubkey_type: "v0_p2wpkh", value })),
  } as unknown as MempoolTransaction;
}

/** Resolves to "settled" if p settled, "pending" otherwise, after draining the task queue. */
async function state(p: Promise<unknown>): Promise<"settled" | "pending"> {
  let done = false;
  p.then(() => { done = true; }, () => { done = true; });
  await new Promise((r) => setImmediate(r));
  return done ? "settled" : "pending";
}

describe("boltzmann pool termination settles pending jobs", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", SilentWorker);
  });
  afterEach(() => {
    terminatePool();
    vi.unstubAllGlobals();
  });

  const small = makeTx("a".repeat(64), [60_000, 50_000], [70_000, 39_000]);

  it("abort resolves the pending compute to null", async () => {
    const ac = new AbortController();
    const p = computeBoltzmann(small, { signal: ac.signal });
    expect(await state(p)).toBe("pending");
    ac.abort();
    expect(await state(p)).toBe("settled");
    await expect(p).resolves.toBeNull();
  });

  it("a second compute preempts the first, which resolves to null", async () => {
    const a = computeBoltzmann(small);
    const b = computeBoltzmann(makeTx("b".repeat(64), [80_000, 30_000], [90_000, 19_000]));
    expect(await state(a)).toBe("settled");
    await expect(a).resolves.toBeNull();
    expect(await state(b)).toBe("pending");
  });

  it("preempting the multi-worker path does not kill the new job's workers", async () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
    const big = makeTx(
      "c".repeat(64),
      [100_001, 200_003, 300_007, 400_009, 500_021],
      [110_000, 220_000, 330_000, 440_000, 499_041],
    );
    const a = computeBoltzmann(big);
    const b = computeBoltzmann(small);
    expect(await state(a)).toBe("settled");
    await expect(a).resolves.toBeNull();
    // a's cleanup must not terminate the pool b now owns
    expect(await state(b)).toBe("pending");
  });

  it("terminatePool rejects a pending runParallelPass", async () => {
    const pool = getWorkerPool(2);
    const p = runParallelPass(pool, "x", [2, 1], [2, 1], 0, 0, 0, 1000, () => {});
    terminatePool();
    expect(await state(p)).toBe("settled");
    await expect(p).rejects.toThrow();
  });

  describe("a job's own worker failure is not reported as preemption", () => {
    it("single-worker crash", async () => {
      const preempted = vi.fn();
      const p = computeBoltzmann(small);
      const off = onPoolTerminate(preempted);
      getWorkerPool(1)[0]!.onerror!({ message: "crash" } as ErrorEvent);
      await expect(p).resolves.toBeNull();
      expect(preempted).not.toHaveBeenCalled();
      off();
    });

    it("parallel pass worker error", async () => {
      const preempted = vi.fn();
      const pool = getWorkerPool(2);
      const p = runParallelPass(pool, "x", [2, 1], [2, 1], 0, 0, 0, 1000, () => {});
      const off = onPoolTerminate(preempted);
      pool[1]!.onmessage!(new MessageEvent("message", { data: { type: "error", id: "x", message: "boom" } }));
      await expect(p).rejects.toThrow("boom");
      expect(preempted).not.toHaveBeenCalled();
      expect(getWorkerPool(0)).toHaveLength(0);
      off();
    });
  });
});
