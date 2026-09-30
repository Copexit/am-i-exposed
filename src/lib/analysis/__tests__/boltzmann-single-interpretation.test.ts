import { describe, it, expect, afterEach, vi } from "vitest";
import type { MempoolTransaction } from "@/lib/api/types";
import consolidation40b88e16 from "../heuristics/__tests__/fixtures/api-responses/consolidation-5in1out.json";
import { makeOpReturnVout } from "../heuristics/__tests__/fixtures/tx-factory";
import { computeBoltzmann } from "../boltzmann-compute";
import { terminatePool } from "../boltzmann-pool";

// LaurentMT's process_tx (boltzmann/utils/tx_processor.py): after dropping
// zero-value txos, <= 1 input or exactly 1 output has one interpretation and
// every link is deterministic. computeBoltzmann answers these without a worker.

function makeTx(ins: number[], outs: number[]): MempoolTransaction {
  const fee = ins.reduce((s, v) => s + v, 0) - outs.reduce((s, v) => s + v, 0);
  return {
    txid: "f".repeat(64),
    fee,
    vin: ins.map((value) => ({ is_coinbase: false, prevout: { value } })),
    vout: outs.map((value) => ({ scriptpubkey_type: "v0_p2wpkh", value })),
  } as unknown as MempoolTransaction;
}

const posted: { type: string }[] = [];
class RecordingWorker {
  onmessage = null;
  onerror = null;
  postMessage(msg: { type: string }) { posted.push(msg); }
  terminate() {}
}

describe("computeBoltzmann - reference single-interpretation rule", () => {
  afterEach(() => {
    terminatePool();
    vi.unstubAllGlobals();
    posted.length = 0;
  });

  async function run(tx: MempoolTransaction) {
    vi.stubGlobal("Worker", RecordingWorker);
    return computeBoltzmann(tx);
  }

  it("40b88e16 (5-in/1-out, one input below the fee): 1 interpretation, 0 bits, every link deterministic", async () => {
    const r = await run(consolidation40b88e16 as unknown as MempoolTransaction);
    expect(posted).toEqual([]);
    expect(r).toMatchObject({ nbCmbn: 1, entropy: 0, timedOut: false, nInputs: 5, nOutputs: 1, method: "exact" });
    expect(r!.matLnkProbabilities).toEqual([[1, 1, 1, 1, 1]]);
    expect(r!.deterministicLinks).toEqual([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]);
  });

  it("2-in/1-out with a dust input below the fee", async () => {
    const r = await run(makeTx([100_000, 500], [99_000]));
    expect(posted).toEqual([]);
    expect(r).toMatchObject({ nbCmbn: 1, entropy: 0, matLnkProbabilities: [[1, 1]] });
  });

  it("1-in/2-out", async () => {
    const r = await run(makeTx([100_000], [60_000, 39_000]));
    expect(posted).toEqual([]);
    expect(r).toMatchObject({ nbCmbn: 1, entropy: 0, matLnkProbabilities: [[1], [1]], deterministicLinks: [[0, 0], [1, 0]] });
  });

  it("1 spendable output + zero-value OP_RETURN: rows stay indexed by vout", async () => {
    const tx = makeTx([50_000, 400], [49_000]);
    tx.vout.unshift(makeOpReturnVout());
    const r = await run(tx);
    expect(posted).toEqual([]);
    expect(r).toMatchObject({ nbCmbn: 1, nOutputs: 1, matLnkProbabilities: [[0, 0], [1, 1]], deterministicLinks: [[1, 0], [1, 1]] });
  });

  it("multi-output with an input below the fee still goes to the exact engine", async () => {
    void run(makeTx([100_000, 60_000, 300], [95_000, 58_000]));
    await new Promise((r) => setImmediate(r));
    expect(posted).toEqual([expect.objectContaining({ type: "compute" })]);
  });
});
