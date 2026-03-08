import { describe, it, expect } from "vitest";
import { analyzeHighActivityAddress } from "../high-activity-address";
import { makeAddress } from "./fixtures/tx-factory";

describe("analyzeHighActivityAddress", () => {
  it("detects extremely high activity (1000+ txs)", () => {
    const addr = makeAddress({
      chain_stats: {
        funded_txo_count: 800,
        funded_txo_sum: 500_000_000,
        spent_txo_count: 700,
        spent_txo_sum: 450_000_000,
        tx_count: 1500,
      },
    });
    const { findings } = analyzeHighActivityAddress(addr, [], []);
    const f = findings.find((f) => f.id === "high-activity-exchange");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("critical");
    expect(f!.scoreImpact).toBe(-8);
  });

  it("detects high activity (100-999 txs)", () => {
    const addr = makeAddress({
      chain_stats: {
        funded_txo_count: 80,
        funded_txo_sum: 50_000_000,
        spent_txo_count: 60,
        spent_txo_sum: 40_000_000,
        tx_count: 200,
      },
    });
    const { findings } = analyzeHighActivityAddress(addr, [], []);
    const f = findings.find((f) => f.id === "high-activity-service");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("high");
    expect(f!.scoreImpact).toBe(-5);
  });

  it("detects moderate activity (20-99 txs)", () => {
    const addr = makeAddress({
      chain_stats: {
        funded_txo_count: 15,
        funded_txo_sum: 5_000_000,
        spent_txo_count: 10,
        spent_txo_sum: 3_000_000,
        tx_count: 30,
      },
    });
    const { findings } = analyzeHighActivityAddress(addr, [], []);
    const f = findings.find((f) => f.id === "high-activity-moderate");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
    expect(f!.scoreImpact).toBe(-3);
  });

  it("does not flag low activity address", () => {
    const addr = makeAddress({
      chain_stats: {
        funded_txo_count: 3,
        funded_txo_sum: 500_000,
        spent_txo_count: 1,
        spent_txo_sum: 200_000,
        tx_count: 5,
      },
    });
    const { findings } = analyzeHighActivityAddress(addr, [], []);
    expect(findings).toHaveLength(0);
  });

  it("includes mempool stats in tx count", () => {
    const addr = makeAddress({
      chain_stats: {
        funded_txo_count: 95,
        funded_txo_sum: 50_000_000,
        spent_txo_count: 90,
        spent_txo_sum: 45_000_000,
        tx_count: 95,
      },
      mempool_stats: {
        funded_txo_count: 5,
        funded_txo_sum: 1_000_000,
        spent_txo_count: 0,
        spent_txo_sum: 0,
        tx_count: 5,
      },
    });
    const { findings } = analyzeHighActivityAddress(addr, [], []);
    // 95 + 5 = 100, should trigger high-activity-service
    const f = findings.find((f) => f.id === "high-activity-service");
    expect(f).toBeDefined();
  });
});
