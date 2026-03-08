import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  analyzeTransaction,
  analyzeAddress,
  analyzeTransactionsForAddress,
  analyzeDestination,
  getTxHeuristicSteps,
  getAddressHeuristicSteps,
  classifyTransactionType,
} from "../orchestrator";
import { makeTx, makeVin, makeAddress, makeUtxo, resetAddrCounter } from "../heuristics/__tests__/fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

vi.useFakeTimers();

describe("analyzeTransaction", () => {
  it("runs all 24 TX heuristics and returns a scored result", async () => {
    const tx = makeTx();
    const stepIds: string[] = [];
    const onStep = vi.fn((id: string) => stepIds.push(id));

    const resultPromise = analyzeTransaction(tx, undefined, onStep);
    await vi.advanceTimersByTimeAsync(24 * 100);
    const result = await resultPromise;

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.grade).toBeDefined();
    expect(result.findings.length).toBeGreaterThan(0);

    // onStep called twice per heuristic (start + done) = 48 calls
    expect(onStep).toHaveBeenCalledTimes(48);
  });

  it("passes rawHex to wallet-fingerprint heuristic", async () => {
    const tx = makeTx({
      locktime: 800_000, // block-height locktime (anti-fee-sniping)
      vin: [makeVin({ sequence: 0xfffffffd }), makeVin({ sequence: 0xfffffffd })],
    });
    // Build rawHex with Low-R signatures
    const sig = "3044022020" + "00".repeat(32) + "0220" + "00".repeat(32);
    const rawHex = sig + sig;

    const resultPromise = analyzeTransaction(tx, rawHex);
    await vi.advanceTimersByTimeAsync(24 * 100);
    const result = await resultPromise;

    const wf = result.findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(wf).toBeDefined();
    expect(wf!.params?.walletGuess).toBe("Bitcoin Core");
  });
});

describe("analyzeAddress", () => {
  it("runs all 6 address heuristics and returns a scored result", async () => {
    const addr = makeAddress();
    const utxos = [makeUtxo()];
    const onStep = vi.fn();

    const resultPromise = analyzeAddress(addr, utxos, [], onStep);
    await vi.advanceTimersByTimeAsync(6 * 100);
    const result = await resultPromise;

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.grade).toBeDefined();
    // onStep called twice per heuristic = 12 calls
    expect(onStep).toHaveBeenCalledTimes(12);
  });

  it("adds partial-history warning when no txs but txCount > 0", async () => {
    const addr = makeAddress({
      chain_stats: { funded_txo_count: 5, funded_txo_sum: 500_000, spent_txo_count: 3, spent_txo_sum: 300_000, tx_count: 8 },
    });

    const resultPromise = analyzeAddress(addr, [], []);
    await vi.advanceTimersByTimeAsync(6 * 100);
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
    await vi.advanceTimersByTimeAsync(6 * 100);
    const result = await resultPromise;

    const pw = result.findings.find((f) => f.id === "partial-history-partial");
    expect(pw).toBeDefined();
  });
});

describe("analyzeTransactionsForAddress", () => {
  it("returns scored results with correct role for sender", async () => {
    const targetAddr = "bc1qsender00000000000000000000000000000001";
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey_address: targetAddr, scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", value: 100_000 } })],
    });

    const results = await analyzeTransactionsForAddress(targetAddr, [tx]);
    expect(results).toHaveLength(1);
    expect(results[0].role).toBe("sender");
    expect(results[0].score).toBeGreaterThanOrEqual(0);
    expect(results[0].grade).toBeDefined();
  });

  it("returns correct role for receiver", async () => {
    const targetAddr = "bc1qrecvr000000000000000000000000000000001";
    const tx = makeTx({
      vout: [{ scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: targetAddr, value: 50_000 }],
    });

    const results = await analyzeTransactionsForAddress(targetAddr, [tx]);
    expect(results).toHaveLength(1);
    expect(results[0].role).toBe("receiver");
  });

  it("returns 'both' when target is in vin and vout", async () => {
    const targetAddr = "bc1qboth0000000000000000000000000000000001";
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey_address: targetAddr, scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", value: 100_000 } })],
      vout: [{ scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: targetAddr, value: 50_000 }],
    });

    const results = await analyzeTransactionsForAddress(targetAddr, [tx]);
    expect(results).toHaveLength(1);
    expect(results[0].role).toBe("both");
  });

  it("caps at 50 transactions", async () => {
    const txs = Array.from({ length: 60 }, () => makeTx());
    const resultPromise = analyzeTransactionsForAddress("bc1qtest", txs);
    // tick() uses setTimeout(0) every 10 txs - run all pending timers
    await vi.runAllTimersAsync();
    const results = await resultPromise;
    expect(results).toHaveLength(50);
  });

  it("continues when a heuristic throws", async () => {
    // A transaction with minimal data should still produce results
    const tx = makeTx();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const results = await analyzeTransactionsForAddress("bc1qtest", [tx]);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThanOrEqual(0);
    consoleSpy.mockRestore();
  });
});

describe("analyzeDestination", () => {
  it("returns LOW risk for unused address", async () => {
    const addr = makeAddress({
      chain_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
      mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
    });
    const onStep = vi.fn();

    const resultPromise = analyzeDestination(addr, [], [], onStep);
    await vi.advanceTimersByTimeAsync(6 * 100);
    const result = await resultPromise;

    expect(result.riskLevel).toBe("LOW");
    expect(result.txCount).toBe(0);
    expect(result.timesReceived).toBe(0);
  });

  it("returns HIGH risk for address received once (reuse)", async () => {
    const addr = makeAddress({
      chain_stats: { funded_txo_count: 1, funded_txo_sum: 100_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 },
      mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
    });

    const resultPromise = analyzeDestination(addr, [], []);
    await vi.advanceTimersByTimeAsync(6 * 100);
    const result = await resultPromise;

    expect(result.riskLevel).toBe("HIGH");
    expect(result.timesReceived).toBe(1);
  });

  it("returns CRITICAL risk for heavily reused address (100+)", async () => {
    const addr = makeAddress({
      chain_stats: { funded_txo_count: 150, funded_txo_sum: 50_000_000, spent_txo_count: 100, spent_txo_sum: 40_000_000, tx_count: 250 },
      mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
    });

    const resultPromise = analyzeDestination(addr, [], []);
    await vi.advanceTimersByTimeAsync(6 * 100);
    const result = await resultPromise;

    expect(result.riskLevel).toBe("CRITICAL");
    expect(result.timesReceived).toBe(150);
  });

  it("returns HIGH risk when funded_txo_count=0 but tx_count>0 (electrs fallback)", async () => {
    const addr = makeAddress({
      chain_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 5 },
      mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
    });

    const resultPromise = analyzeDestination(addr, [], []);
    await vi.advanceTimersByTimeAsync(6 * 100);
    const result = await resultPromise;

    expect(result.riskLevel).toBe("HIGH");
    expect(result.summaryKey).toBe("presend.summaryHighDataUnavailable");
  });

  it("includes h13-presend-check finding in results", async () => {
    const addr = makeAddress();

    const resultPromise = analyzeDestination(addr, [], []);
    await vi.advanceTimersByTimeAsync(6 * 100);
    const result = await resultPromise;

    const presend = result.findings.find((f) => f.id === "h13-presend-check");
    expect(presend).toBeDefined();
  });
});

describe("heuristic step lists", () => {
  it("getTxHeuristicSteps returns 24 steps", () => {
    expect(getTxHeuristicSteps()).toHaveLength(24);
  });

  it("getAddressHeuristicSteps returns 6 steps", () => {
    expect(getAddressHeuristicSteps()).toHaveLength(6);
  });
});

describe("classifyTransactionType", () => {
  it("classifies Whirlpool CoinJoin", () => {
    expect(classifyTransactionType([
      { id: "h4-whirlpool", severity: "good", title: "", description: "", recommendation: "", scoreImpact: 30 },
    ])).toBe("whirlpool-coinjoin");
  });

  it("classifies WabiSabi CoinJoin via isWabiSabi param", () => {
    expect(classifyTransactionType([
      { id: "h4-coinjoin", severity: "good", title: "", description: "", recommendation: "", scoreImpact: 25, params: { isWabiSabi: 1 } },
    ])).toBe("wabisabi-coinjoin");
  });

  it("classifies generic CoinJoin (non-WabiSabi h4-coinjoin)", () => {
    expect(classifyTransactionType([
      { id: "h4-coinjoin", severity: "good", title: "", description: "", recommendation: "", scoreImpact: 20, params: { isWabiSabi: 0 } },
    ])).toBe("generic-coinjoin");
  });

  it("classifies JoinMarket CoinJoin", () => {
    expect(classifyTransactionType([
      { id: "h4-joinmarket", severity: "good", title: "", description: "", recommendation: "", scoreImpact: 15 },
    ])).toBe("joinmarket-coinjoin");
  });

  it("classifies PayJoin", () => {
    expect(classifyTransactionType([
      { id: "h4-payjoin", severity: "good", title: "", description: "", recommendation: "", scoreImpact: 8 },
    ])).toBe("payjoin");
  });

  it("classifies tx0 premix", () => {
    expect(classifyTransactionType([
      { id: "tx0-premix", severity: "good", title: "", description: "", recommendation: "", scoreImpact: 5 },
    ])).toBe("tx0-premix");
  });

  it("classifies self-transfer", () => {
    expect(classifyTransactionType([
      { id: "h2-self-send", severity: "high", title: "", description: "", recommendation: "", scoreImpact: -15 },
    ])).toBe("self-transfer");
  });

  it("classifies consolidation", () => {
    expect(classifyTransactionType([
      { id: "consolidation-fan-in", severity: "high", title: "", description: "", recommendation: "", scoreImpact: -5 },
    ])).toBe("consolidation");
  });

  it("classifies batch payment", () => {
    expect(classifyTransactionType([
      { id: "consolidation-fan-out", severity: "low", title: "", description: "", recommendation: "", scoreImpact: -2 },
    ])).toBe("batch-payment");
  });

  it("defaults to simple-payment", () => {
    expect(classifyTransactionType([
      { id: "h3-cioh", severity: "medium", title: "", description: "", recommendation: "", scoreImpact: -6 },
    ])).toBe("simple-payment");
  });

  it("prioritizes CoinJoin over structural patterns", () => {
    expect(classifyTransactionType([
      { id: "h4-whirlpool", severity: "good", title: "", description: "", recommendation: "", scoreImpact: 30 },
      { id: "consolidation-fan-in", severity: "high", title: "", description: "", recommendation: "", scoreImpact: 0 },
    ])).toBe("whirlpool-coinjoin");
  });
});
