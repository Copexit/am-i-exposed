import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  analyzeTransaction,
  analyzeAddress,
  getTxHeuristicSteps,
  getAddressHeuristicSteps,
} from "../orchestrator";
import { makeTx, makeVin, makeAddress, makeUtxo, resetAddrCounter } from "../heuristics/__tests__/fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

vi.useFakeTimers();

describe("analyzeTransaction", () => {
  it("runs all 13 TX heuristics and returns a scored result", async () => {
    const tx = makeTx();
    const stepIds: string[] = [];
    const onStep = vi.fn((id: string) => stepIds.push(id));

    const resultPromise = analyzeTransaction(tx, undefined, onStep);
    await vi.advanceTimersByTimeAsync(13 * 100);
    const result = await resultPromise;

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.grade).toBeDefined();
    expect(result.findings.length).toBeGreaterThan(0);

    // onStep called twice per heuristic (start + done) = 26 calls
    expect(onStep).toHaveBeenCalledTimes(26);
  });

  it("passes rawHex to wallet-fingerprint heuristic", async () => {
    const tx = makeTx({
      vin: [makeVin({ sequence: 0xffffffff }), makeVin({ sequence: 0xffffffff })],
    });
    // Build rawHex with Low-R signatures
    const sig = "3044022020" + "00".repeat(32) + "0220" + "00".repeat(32);
    const rawHex = sig + sig;

    const resultPromise = analyzeTransaction(tx, rawHex);
    await vi.advanceTimersByTimeAsync(13 * 100);
    const result = await resultPromise;

    const wf = result.findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(wf).toBeDefined();
    expect(wf!.params?.walletGuess).toBe("Bitcoin Core");
  });
});

describe("analyzeAddress", () => {
  it("runs all 4 address heuristics and returns a scored result", async () => {
    const addr = makeAddress();
    const utxos = [makeUtxo()];
    const onStep = vi.fn();

    const resultPromise = analyzeAddress(addr, utxos, [], onStep);
    await vi.advanceTimersByTimeAsync(4 * 100);
    const result = await resultPromise;

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.grade).toBeDefined();
    // onStep called twice per heuristic = 8 calls
    expect(onStep).toHaveBeenCalledTimes(8);
  });

  it("adds partial-history warning when no txs but txCount > 0", async () => {
    const addr = makeAddress({
      chain_stats: { funded_txo_count: 5, funded_txo_sum: 500_000, spent_txo_count: 3, spent_txo_sum: 300_000, tx_count: 8 },
    });

    const resultPromise = analyzeAddress(addr, [], []);
    await vi.advanceTimersByTimeAsync(4 * 100);
    const result = await resultPromise;

    const pw = result.findings.find((f) => f.id === "partial-history-unavailable");
    expect(pw).toBeDefined();
  });

  it("adds partial-history-partial when txs < totalOnChain", async () => {
    const addr = makeAddress({
      chain_stats: { funded_txo_count: 5, funded_txo_sum: 500_000, spent_txo_count: 3, spent_txo_sum: 300_000, tx_count: 50 },
    });
    const txs = Array.from({ length: 10 }, () => makeTx());

    const resultPromise = analyzeAddress(addr, [], txs);
    await vi.advanceTimersByTimeAsync(4 * 100);
    const result = await resultPromise;

    const pw = result.findings.find((f) => f.id === "partial-history-partial");
    expect(pw).toBeDefined();
  });
});

describe("heuristic step lists", () => {
  it("getTxHeuristicSteps returns 13 steps", () => {
    expect(getTxHeuristicSteps()).toHaveLength(13);
  });

  it("getAddressHeuristicSteps returns 4 steps", () => {
    expect(getAddressHeuristicSteps()).toHaveLength(4);
  });
});
