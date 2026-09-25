// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { makeTx, makeVin, makeVout } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";
import { terminatePool, type BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

const computeBoltzmann = vi.fn();
vi.mock("@/lib/analysis/boltzmann-compute", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analysis/boltzmann-compute")>()),
  computeBoltzmann: (...args: unknown[]) => computeBoltzmann(...args),
}));

const { useBoltzmann } = await import("../useBoltzmann");

// 2-in/2-out: eligible and auto-computable
const tx = makeTx({
  vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q_a", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q_b", value: 40_000 } })],
  vout: [makeVout({ value: 30_000 }), makeVout({ value: 59_000 })],
});

let settle!: (r: BoltzmannWorkerResult | null) => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", class {});
  computeBoltzmann.mockImplementation(() => new Promise((r) => { settle = r; }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  computeBoltzmann.mockReset();
});

async function startCompute() {
  const hook = renderHook(() => useBoltzmann(tx));
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(hook.result.current.state.status).toBe("computing");
  return hook;
}

describe("useBoltzmann", () => {
  it("shows a neutral cancelled state when another compute preempts this one", async () => {
    const { result } = await startCompute();

    // Another caller's compute terminates the shared pool; ours settles with null
    await act(async () => {
      terminatePool();
      settle(null);
    });

    expect(result.current.state.status).toBe("cancelled");
    expect(result.current.state.error).toBeNull();
  });

  it("still reports an error when the compute fails without preemption", async () => {
    const { result } = await startCompute();

    await act(async () => { settle(null); });

    expect(result.current.state.status).toBe("error");
  });
});
