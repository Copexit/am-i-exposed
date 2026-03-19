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
  it("runs all 26 TX heuristics and returns a scored result", async () => {
    const tx = makeTx();
    const stepIds: string[] = [];
    const onStep = vi.fn((id: string) => stepIds.push(id));

    const resultPromise = analyzeTransaction(tx, undefined, onStep);
    await vi.advanceTimersByTimeAsync(26 * 100);
    const result = await resultPromise;

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.grade).toBeDefined();
    expect(result.findings.length).toBeGreaterThan(0);

    // onStep called twice per heuristic (start + done) = 52 calls
    expect(onStep).toHaveBeenCalledTimes(52);
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
    await vi.advanceTimersByTimeAsync(26 * 100);
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
  it("getTxHeuristicSteps returns 32 steps (26 heuristics + 6 chain)", () => {
    expect(getTxHeuristicSteps()).toHaveLength(32);
  });

  it("getAddressHeuristicSteps returns 6 steps", () => {
    expect(getAddressHeuristicSteps()).toHaveLength(6);
  });
});

describe("cross-heuristic: Wasabi + address reuse paradox", () => {
  it("emits cross-wasabi-reuse-paradox when Wasabi fingerprint + address reuse", async () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [makeVin(), makeVin()],
    });
    const resultPromise = analyzeTransaction(tx);
    await vi.advanceTimersByTimeAsync(26 * 100);
    const result = await resultPromise;

    // Manually inject the two prerequisite findings and re-run cross-heuristic
    // (since we can't easily construct a tx that triggers both naturally)
    result.findings.push(
      {
        id: "h11-wallet-fingerprint",
        severity: "medium",
        title: "Wallet fingerprint",
        description: "",
        recommendation: "",
        scoreImpact: -5,
        params: { walletGuess: "Wasabi 2.x" },
      },
      {
        id: "h8-address-reuse",
        severity: "high",
        title: "Address reuse",
        description: "",
        recommendation: "",
        scoreImpact: -70,
      },
    );

    // Import and re-run the cross-heuristic rules
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");
    applyCrossHeuristicRulesForTest(result.findings);

    const paradox = result.findings.find((f) => f.id === "cross-wasabi-reuse-paradox");
    expect(paradox).toBeDefined();
    expect(paradox!.severity).toBe("high");
    expect(paradox!.scoreImpact).toBe(0);
  });

  it("does NOT emit paradox for non-Wasabi wallet + address reuse", async () => {
    const findings: import("@/lib/types").Finding[] = [
      {
        id: "h11-wallet-fingerprint",
        severity: "medium",
        title: "Wallet fingerprint",
        description: "",
        recommendation: "",
        scoreImpact: -5,
        params: { walletGuess: "Sparrow" },
      },
      {
        id: "h8-address-reuse",
        severity: "high",
        title: "Address reuse",
        description: "",
        recommendation: "",
        scoreImpact: -70,
      },
    ];

    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");
    applyCrossHeuristicRulesForTest(findings);

    const paradox = findings.find((f) => f.id === "cross-wasabi-reuse-paradox");
    expect(paradox).toBeUndefined();
  });
});

describe("cross-heuristic: CoinJoin suppression of conflicting findings", () => {
  it("suppresses CIOH, round amount, change detection, and script-mixed when CoinJoin is detected", async () => {
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");

    const findings: import("@/lib/types").Finding[] = [
      {
        id: "h4-coinjoin",
        severity: "good",
        title: "CoinJoin detected",
        description: "",
        recommendation: "",
        scoreImpact: 25,
        params: { isWabiSabi: 0 },
      },
      {
        id: "h3-cioh",
        severity: "high",
        title: "Common input ownership heuristic",
        description: "",
        recommendation: "",
        scoreImpact: -8,
      },
      {
        id: "h1-round-amount",
        severity: "medium",
        title: "Round amount detected",
        description: "",
        recommendation: "",
        scoreImpact: -3,
      },
      {
        id: "h2-change-detected",
        severity: "medium",
        title: "Change output detected",
        description: "",
        recommendation: "",
        scoreImpact: -5,
      },
      {
        id: "script-mixed",
        severity: "medium",
        title: "Mixed script types",
        description: "",
        recommendation: "",
        scoreImpact: -4,
      },
    ];

    applyCrossHeuristicRulesForTest(findings);

    const cioh = findings.find((f) => f.id === "h3-cioh")!;
    expect(cioh.scoreImpact).toBe(0);
    expect(cioh.severity).toBe("low");
    expect(cioh.params?.context).toBe("coinjoin");

    const round = findings.find((f) => f.id === "h1-round-amount")!;
    expect(round.scoreImpact).toBe(0);
    expect(round.severity).toBe("low");
    expect(round.params?.context).toBe("coinjoin");

    const change = findings.find((f) => f.id === "h2-change-detected")!;
    expect(change.scoreImpact).toBe(0);
    expect(change.severity).toBe("low");
    expect(change.params?.context).toBe("coinjoin");

    const scriptMixed = findings.find((f) => f.id === "script-mixed")!;
    expect(scriptMixed.scoreImpact).toBe(0);
    expect(scriptMixed.severity).toBe("low");
    expect(scriptMixed.params?.context).toBe("coinjoin");
  });

  it("also suppresses consolidation, unnecessary-input, and entropy findings for CoinJoin", async () => {
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");

    const findings: import("@/lib/types").Finding[] = [
      {
        id: "h4-whirlpool",
        severity: "good",
        title: "Whirlpool CoinJoin detected",
        description: "",
        recommendation: "",
        scoreImpact: 30,
      },
      {
        id: "consolidation-fan-in",
        severity: "high",
        title: "Consolidation",
        description: "",
        recommendation: "",
        scoreImpact: -5,
      },
      {
        id: "unnecessary-input",
        severity: "medium",
        title: "Unnecessary input",
        description: "",
        recommendation: "",
        scoreImpact: -3,
      },
      {
        id: "h5-low-entropy",
        severity: "medium",
        title: "Low entropy",
        description: "",
        recommendation: "",
        scoreImpact: -4,
      },
    ];

    applyCrossHeuristicRulesForTest(findings);

    for (const f of findings) {
      if (f.id !== "h4-whirlpool") {
        expect(f.scoreImpact).toBe(0);
        expect(f.severity).toBe("low");
        expect(f.params?.context).toBe("coinjoin");
      }
    }
  });
});

describe("cross-heuristic: CIOH + consolidation penalty capping", () => {
  it("caps consolidation at -2 and zeroes unnecessary-input when CIOH fires on non-CoinJoin tx", async () => {
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");

    const findings: import("@/lib/types").Finding[] = [
      {
        id: "h3-cioh",
        severity: "high",
        title: "Common input ownership heuristic",
        description: "",
        recommendation: "",
        scoreImpact: -8,
      },
      {
        id: "consolidation-fan-in",
        severity: "high",
        title: "Consolidation fan-in",
        description: "",
        recommendation: "",
        scoreImpact: -5,
      },
      {
        id: "unnecessary-input",
        severity: "medium",
        title: "Unnecessary input",
        description: "",
        recommendation: "",
        scoreImpact: -3,
      },
    ];

    applyCrossHeuristicRulesForTest(findings);

    const cioh = findings.find((f) => f.id === "h3-cioh")!;
    // CIOH itself should remain unchanged (it still fires)
    expect(cioh.scoreImpact).toBe(-8);

    const consolidation = findings.find((f) => f.id === "consolidation-fan-in")!;
    expect(consolidation.scoreImpact).toBe(-2);
    expect(consolidation.params?.context).toBe("cioh-covers");

    const unnecessary = findings.find((f) => f.id === "unnecessary-input")!;
    expect(unnecessary.scoreImpact).toBe(0);
    expect(unnecessary.severity).toBe("low");
    expect(unnecessary.params?.context).toBe("cioh-covers");
  });

  it("does NOT cap consolidation when impact is already -2 or lighter", async () => {
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");

    const findings: import("@/lib/types").Finding[] = [
      {
        id: "h3-cioh",
        severity: "high",
        title: "CIOH",
        description: "",
        recommendation: "",
        scoreImpact: -6,
      },
      {
        id: "consolidation-fan-in",
        severity: "medium",
        title: "Consolidation fan-in",
        description: "",
        recommendation: "",
        scoreImpact: -2,
      },
    ];

    applyCrossHeuristicRulesForTest(findings);

    const consolidation = findings.find((f) => f.id === "consolidation-fan-in")!;
    // Already at -2, should not be modified (the condition is scoreImpact < -2)
    expect(consolidation.scoreImpact).toBe(-2);
    expect(consolidation.params?.context).toBeUndefined();
  });
});

describe("cross-heuristic: deterministic cap enforcement", () => {
  it("adds compound-deterministic-cap when h2-same-address-io fires and total impact is insufficient for F", async () => {
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");

    const findings: import("@/lib/types").Finding[] = [
      {
        id: "h2-same-address-io",
        severity: "critical",
        title: "Same address in input and output",
        description: "",
        recommendation: "",
        scoreImpact: -15,
      },
      {
        id: "h3-cioh",
        severity: "high",
        title: "CIOH",
        description: "",
        recommendation: "",
        scoreImpact: -8,
      },
    ];

    // Total impact before cross-heuristic = -15 + -8 = -23
    // Target is -46, so a cap finding with -23 impact should be added
    applyCrossHeuristicRulesForTest(findings);

    const cap = findings.find((f) => f.id === "compound-deterministic-cap");
    expect(cap).toBeDefined();
    expect(cap!.severity).toBe("critical");
    expect(cap!.confidence).toBe("deterministic");

    // Total impact must now reach -46
    const totalImpact = findings.reduce((sum, f) => sum + f.scoreImpact, 0);
    expect(totalImpact).toBe(-46);
  });

  it("does NOT add compound-deterministic-cap for h2-sweep (sweeps are normal practice)", async () => {
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");

    const findings: import("@/lib/types").Finding[] = [
      {
        id: "h2-sweep",
        severity: "low",
        title: "Sweep transaction",
        description: "",
        recommendation: "",
        scoreImpact: 0,
      },
    ];

    applyCrossHeuristicRulesForTest(findings);

    const cap = findings.find((f) => f.id === "compound-deterministic-cap");
    expect(cap).toBeUndefined();
  });

  it("does NOT add cap finding when total impact already exceeds -46", async () => {
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");

    const findings: import("@/lib/types").Finding[] = [
      {
        id: "h2-same-address-io",
        severity: "critical",
        title: "Same address in input and output",
        description: "",
        recommendation: "",
        scoreImpact: -30,
      },
      {
        id: "h8-address-reuse",
        severity: "high",
        title: "Address reuse",
        description: "",
        recommendation: "",
        scoreImpact: -20,
      },
    ];

    // Total = -50, already beyond -46
    applyCrossHeuristicRulesForTest(findings);

    const cap = findings.find((f) => f.id === "compound-deterministic-cap");
    expect(cap).toBeUndefined();
  });
});

describe("cross-heuristic: post-mix consolidation + entity escalation", () => {
  it("escalates entity-known-output to critical with -10 impact when post-mix consolidation is present", async () => {
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");

    const findings: import("@/lib/types").Finding[] = [
      {
        id: "post-mix-consolidation",
        severity: "high",
        title: "Post-mix consolidation detected",
        description: "",
        recommendation: "",
        scoreImpact: -8,
      },
      {
        id: "entity-known-output",
        severity: "medium",
        title: "Output to known entity",
        description: "Funds sent to a known entity.",
        recommendation: "Use privacy-preserving methods.",
        scoreImpact: -4,
        params: { entityName: "Binance" },
      },
    ];

    applyCrossHeuristicRulesForTest(findings);

    const entity = findings.find((f) => f.id === "entity-known-output")!;
    expect(entity.severity).toBe("critical");
    expect(entity.scoreImpact).toBe(-10);
    expect(entity.title).toBe("Post-mix funds sent to known entity");
    expect(entity.params?.context).toBe("postmix-consolidation-to-entity");
    // Original param should be preserved
    expect(entity.params?.entityName).toBe("Binance");
  });

  it("escalates entity-known-output when chain-post-coinjoin-consolidation is present", async () => {
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");

    const findings: import("@/lib/types").Finding[] = [
      {
        id: "chain-post-coinjoin-consolidation",
        severity: "high",
        title: "Chain: post-CoinJoin consolidation",
        description: "",
        recommendation: "",
        scoreImpact: -6,
      },
      {
        id: "entity-known-output",
        severity: "medium",
        title: "Output to known entity",
        description: "",
        recommendation: "",
        scoreImpact: -4,
      },
    ];

    applyCrossHeuristicRulesForTest(findings);

    const entity = findings.find((f) => f.id === "entity-known-output")!;
    expect(entity.severity).toBe("critical");
    expect(entity.scoreImpact).toBe(-10);
    expect(entity.params?.context).toBe("postmix-consolidation-to-entity");
  });

  it("escalates entity-known-output when chain-post-coinjoin-direct-spend is present", async () => {
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");

    const findings: import("@/lib/types").Finding[] = [
      {
        id: "chain-post-coinjoin-direct-spend",
        severity: "high",
        title: "Chain: direct spend from post-CoinJoin",
        description: "",
        recommendation: "",
        scoreImpact: -5,
      },
      {
        id: "entity-known-output",
        severity: "medium",
        title: "Output to known entity",
        description: "",
        recommendation: "",
        scoreImpact: -4,
      },
    ];

    applyCrossHeuristicRulesForTest(findings);

    const entity = findings.find((f) => f.id === "entity-known-output")!;
    expect(entity.severity).toBe("critical");
    expect(entity.scoreImpact).toBe(-10);
    expect(entity.params?.context).toBe("postmix-direct-to-entity");
  });

  it("does NOT escalate entity finding when no post-mix pattern is present", async () => {
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");

    const findings: import("@/lib/types").Finding[] = [
      {
        id: "entity-known-output",
        severity: "medium",
        title: "Output to known entity",
        description: "",
        recommendation: "",
        scoreImpact: -4,
      },
    ];

    applyCrossHeuristicRulesForTest(findings);

    const entity = findings.find((f) => f.id === "entity-known-output")!;
    expect(entity.severity).toBe("medium");
    expect(entity.scoreImpact).toBe(-4);
  });

  it("also zeroes chain-coinjoin-input positive finding when post-mix consolidation is present", async () => {
    const { applyCrossHeuristicRulesForTest } = await import("../orchestrator");

    const findings: import("@/lib/types").Finding[] = [
      {
        id: "post-mix-consolidation",
        severity: "high",
        title: "Post-mix consolidation",
        description: "",
        recommendation: "",
        scoreImpact: -8,
      },
      {
        id: "chain-coinjoin-input",
        severity: "good",
        title: "Input from CoinJoin",
        description: "",
        recommendation: "",
        scoreImpact: 5,
      },
    ];

    applyCrossHeuristicRulesForTest(findings);

    const cjInput = findings.find((f) => f.id === "chain-coinjoin-input")!;
    expect(cjInput.scoreImpact).toBe(0);
    expect(cjInput.params?.context).toBe("negated-by-consolidation");
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
