import { describe, it, expect, afterEach, vi } from "vitest";
import type { MempoolTransaction } from "@/lib/api/types";
import jmMultiInput from "../heuristics/__tests__/fixtures/api-responses/joinmarket-multi-input.json";
import { getBoltzmannEligibility } from "../boltzmann-eligibility";
import { detectJoinMarketForTurbo, isAutoComputable, extractTxValues, terminatePool } from "../boltzmann-pool";
import { computeBoltzmann } from "../boltzmann-compute";

// Home page "JoinMarket CoinJoin" example (6cb2433f): 23 inputs, 10 x 198_732_961
// + 9 changes. Makers fund the denomination from 2-3 inputs of ~1 BTC each.
const example = jmMultiInput as unknown as MempoolTransaction;
const { inputValues, outputValues } = extractTxValues(example);

function makeTx(ins: number[], outs: number[]): MempoolTransaction {
  return {
    txid: "e".repeat(64),
    fee: 1000,
    vin: ins.map((value) => ({ is_coinbase: false, prevout: { value } })),
    vout: outs.map((value) => ({ scriptpubkey_type: "v0_p2wpkh", value })),
  } as unknown as MempoolTransaction;
}

describe("Boltzmann routing for JoinMarket rounds with multi-input makers", () => {
  afterEach(() => {
    terminatePool();
    vi.unstubAllGlobals();
  });

  it("detects the example as JoinMarket although no maker input covers the denomination", () => {
    expect(inputValues.filter((v) => v >= 198_732_961)).toHaveLength(1);
    expect(detectJoinMarketForTurbo(inputValues, outputValues)).toEqual({
      isJoinMarket: true,
      denomination: 198_732_961,
    });
  });

  it("auto-computes the example instead of offering the exact engine", () => {
    expect(getBoltzmannEligibility(example).canCompute).toBe(true);
    expect(isAutoComputable(inputValues, outputValues)).toBe(true);
  });

  it("sends the example to the JoinMarket worker mode, never to exact DFS", async () => {
    const posted: { type: string; denomination?: number }[] = [];
    class RecordingWorker {
      onmessage = null;
      onerror = null;
      postMessage(msg: { type: string; denomination?: number }) { posted.push(msg); }
      terminate() {}
    }
    vi.stubGlobal("Worker", RecordingWorker);
    void computeBoltzmann(example);
    await new Promise((r) => setImmediate(r));
    expect(posted).toEqual([expect.objectContaining({ type: "compute-jm", denomination: 198_732_961 })]);
  });

  it("still rejects a multi-input batch payment (3 equal outputs, 1 change)", () => {
    const ins = [250_000, 250_000, 200_000, 150_000, 100_000];
    const outs = [300_000, 300_000, 300_000, 249_000];
    expect(detectJoinMarketForTurbo(ins, outs).isJoinMarket).toBe(false);
  });

  it("marks a transaction too large for the exact engine as ineligible", () => {
    // Same size as the example, but no equal outputs: exact DFS would never answer
    const distinct = outputValues.map((v, i) => v + i);
    const tx = makeTx(inputValues, distinct);
    expect(getBoltzmannEligibility(tx)).toMatchObject({ canCompute: false, reason: "too-large" });
    expect(isAutoComputable(inputValues, distinct)).toBe(false);
  });

  it("keeps mid-size transactions the exact engine finishes", () => {
    const tx = makeTx(
      Array.from({ length: 16 }, (_, i) => 1_000_000 + i * 7_919),
      Array.from({ length: 16 }, (_, i) => 900_000 + i * 6_007),
    );
    expect(getBoltzmannEligibility(tx).canCompute).toBe(true);
  });
});
