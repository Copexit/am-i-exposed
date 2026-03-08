import { describe, it, expect, beforeEach } from "vitest";
import { analyzeTemporalCorrelation } from "../temporal";
import { makeTx, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

function makeTxAtTime(blockTime: number, txid?: string) {
  return makeTx({
    txid: txid ?? Math.random().toString(16).slice(2).padEnd(64, "0"),
    status: {
      confirmed: true,
      block_height: 800000 + Math.floor(blockTime / 600),
      block_time: blockTime,
    },
  });
}

describe("analyzeTemporalCorrelation", () => {
  it("returns empty for fewer than 3 confirmed txs", () => {
    const txs = [
      makeTxAtTime(1700000000),
      makeTxAtTime(1700000600),
    ];
    const findings = analyzeTemporalCorrelation(txs);
    expect(findings).toHaveLength(0);
  });

  it("detects moderate burst (3 txs within 2 hours)", () => {
    const base = 1700000000;
    const txs = [
      makeTxAtTime(base),
      makeTxAtTime(base + 1800), // 30 min later
      makeTxAtTime(base + 3600), // 1 hour later
    ];
    const findings = analyzeTemporalCorrelation(txs);
    const f = findings.find((f) => f.id === "temporal-burst-moderate");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-2);
    expect(f!.params?.burstSize).toBe(3);
  });

  it("detects high burst (5+ txs within 2 hours)", () => {
    const base = 1700000000;
    const txs = [
      makeTxAtTime(base),
      makeTxAtTime(base + 600),
      makeTxAtTime(base + 1200),
      makeTxAtTime(base + 1800),
      makeTxAtTime(base + 2400),
    ];
    const findings = analyzeTemporalCorrelation(txs);
    const f = findings.find((f) => f.id === "temporal-burst-high");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("high");
    expect(f!.scoreImpact).toBe(-5);
  });

  it("does not flag txs spread over long periods", () => {
    const base = 1700000000;
    const day = 86400;
    const txs = [
      makeTxAtTime(base),
      makeTxAtTime(base + day * 5),
      makeTxAtTime(base + day * 15),
      makeTxAtTime(base + day * 30),
    ];
    const findings = analyzeTemporalCorrelation(txs);
    expect(findings.find((f) => f.id.startsWith("temporal-burst"))).toBeUndefined();
  });

  it("detects regular interval pattern", () => {
    const base = 1700000000;
    const interval = 86400; // exactly 1 day
    const txs = Array.from({ length: 10 }, (_, i) =>
      makeTxAtTime(base + i * interval),
    );
    const findings = analyzeTemporalCorrelation(txs);
    const f = findings.find((f) => f.id === "temporal-regular-pattern");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
    expect(f!.scoreImpact).toBe(-3);
  });

  it("does not flag irregular intervals", () => {
    const base = 1700000000;
    // Highly variable intervals
    const txs = [
      makeTxAtTime(base),
      makeTxAtTime(base + 3600),      // 1 hour
      makeTxAtTime(base + 86400),     // 1 day
      makeTxAtTime(base + 86400 * 10), // 10 days
      makeTxAtTime(base + 86400 * 11), // 11 days
    ];
    const findings = analyzeTemporalCorrelation(txs);
    expect(findings.find((f) => f.id === "temporal-regular-pattern")).toBeUndefined();
  });

  it("skips unconfirmed transactions", () => {
    const txs = [
      makeTx({ status: { confirmed: false } }),
      makeTx({ status: { confirmed: false } }),
      makeTx({ status: { confirmed: false } }),
    ];
    const findings = analyzeTemporalCorrelation(txs);
    expect(findings).toHaveLength(0);
  });
});
