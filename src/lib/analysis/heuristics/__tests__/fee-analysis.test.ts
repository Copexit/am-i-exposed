import { describe, it, expect, beforeEach } from "vitest";
import { analyzeFees } from "../fee-analysis";
import { makeTx, makeVin, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeFees", () => {
  it("detects round fee rate > 5 sat/vB with impact -2", () => {
    // weight=400 -> vsize=100, fee=600 -> 6.0 sat/vB (round)
    const tx = makeTx({ weight: 400, fee: 600 });
    const { findings } = analyzeFees(tx);
    const f = findings.find((f) => f.id === "h6-round-fee-rate");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-2);
    expect(f!.severity).toBe("low");
    expect(f!.params?.feeRate).toBe(6);
  });

  it("does not flag round fee rate <= 5 sat/vB", () => {
    // weight=400 -> vsize=100, fee=500 -> 5.0 sat/vB (round but <= 5)
    const tx = makeTx({ weight: 400, fee: 500 });
    const { findings } = analyzeFees(tx);
    expect(findings.find((f) => f.id === "h6-round-fee-rate")).toBeUndefined();
  });

  it("does not flag non-round fee rate", () => {
    // weight=700 -> vsize=175, fee=1500 -> ~8.57 sat/vB (not round)
    const tx = makeTx({ weight: 700, fee: 1500 });
    const { findings } = analyzeFees(tx);
    expect(findings.find((f) => f.id === "h6-round-fee-rate")).toBeUndefined();
  });

  it("detects RBF signaled (sequence < 0xfffffffe) with impact 0", () => {
    const tx = makeTx({
      vin: [makeVin({ sequence: 0xfffffffd })],
    });
    const { findings } = analyzeFees(tx);
    const f = findings.find((f) => f.id === "h6-rbf-signaled");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(0);
  });

  it("does not flag RBF when sequence >= 0xfffffffe", () => {
    const tx = makeTx({
      vin: [makeVin({ sequence: 0xfffffffe })],
    });
    const { findings } = analyzeFees(tx);
    expect(findings.find((f) => f.id === "h6-rbf-signaled")).toBeUndefined();
  });

  it("returns empty when fee is 0", () => {
    const tx = makeTx({ fee: 0 });
    const { findings } = analyzeFees(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns empty when weight is 0", () => {
    const tx = makeTx({ weight: 0 });
    const { findings } = analyzeFees(tx);
    expect(findings).toHaveLength(0);
  });

  it("can return both round-fee and rbf findings", () => {
    const tx = makeTx({
      weight: 400,
      fee: 600,
      vin: [makeVin({ sequence: 0xfffffffd })],
    });
    const { findings } = analyzeFees(tx);
    expect(findings.find((f) => f.id === "h6-round-fee-rate")).toBeDefined();
    expect(findings.find((f) => f.id === "h6-rbf-signaled")).toBeDefined();
  });
});
