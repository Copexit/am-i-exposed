import { describe, it, expect } from "vitest";
import { applyCrossHeuristicRules } from "../cross-heuristic";
import type { Finding } from "@/lib/types";
import type { FindingId } from "@/lib/analysis/finding-metadata";

function makeFinding(id: FindingId, scoreImpact: number = -2): Finding {
  return {
    id,
    severity: "low",
    title: `Finding ${id}`,
    description: `Description for ${id}`,
    recommendation: `Fix ${id}`,
    scoreImpact,
  };
}

describe("behavioral fingerprint rollup", () => {
  it("does not fire with fewer than 2 behavioral signals", () => {
    const findings: Finding[] = [
      makeFinding("h11-wallet-fingerprint"),
    ];
    applyCrossHeuristicRules(findings);
    expect(findings.some((f) => f.id === "behavioral-fingerprint-rollup")).toBe(false);
  });

  it("fires HIGH with 2 behavioral signals", () => {
    const findings: Finding[] = [
      makeFinding("h11-wallet-fingerprint"),
      makeFinding("h6-round-fee-rate"),
    ];
    applyCrossHeuristicRules(findings);
    const rollup = findings.find((f) => f.id === "behavioral-fingerprint-rollup");
    expect(rollup).toBeDefined();
    expect(rollup!.severity).toBe("high");
    expect(rollup!.scoreImpact).toBe(-6);
    expect(rollup!.params?.signalCount).toBe(2);
  });

  it("fires HIGH with 3 behavioral signals", () => {
    const findings: Finding[] = [
      makeFinding("h11-wallet-fingerprint"),
      makeFinding("h6-round-fee-rate"),
      makeFinding("bip69-detected"),
    ];
    applyCrossHeuristicRules(findings);
    const rollup = findings.find((f) => f.id === "behavioral-fingerprint-rollup");
    expect(rollup).toBeDefined();
    expect(rollup!.severity).toBe("high");
    expect(rollup!.params?.signalCount).toBe(3);
  });

  it("escalates to CRITICAL with 4+ behavioral signals", () => {
    const findings: Finding[] = [
      makeFinding("h11-wallet-fingerprint"),
      makeFinding("h6-round-fee-rate"),
      makeFinding("bip69-detected"),
      makeFinding("witness-mixed-types"),
    ];
    applyCrossHeuristicRules(findings);
    const rollup = findings.find((f) => f.id === "behavioral-fingerprint-rollup");
    expect(rollup).toBeDefined();
    expect(rollup!.severity).toBe("critical");
    expect(rollup!.scoreImpact).toBe(-12);
    expect(rollup!.params?.signalCount).toBe(4);
  });

  it("does not count the changeless (BnB) credit as a fingerprint", () => {
    // A privacy credit (+3) is not a re-identifying penalty: one real signal
    // plus the credit stays below the 2-signal threshold
    const findings: Finding[] = [
      makeFinding("h11-wallet-fingerprint"),
      makeFinding("h-coin-selection-bnb", 3),
    ];
    applyCrossHeuristicRules(findings);
    expect(findings.some((f) => f.id === "behavioral-fingerprint-rollup")).toBe(false);
  });

  it("ignores suppressed behavioral signals (scoreImpact = 0)", () => {
    const findings: Finding[] = [
      makeFinding("h11-wallet-fingerprint", 0), // suppressed by CoinJoin
      makeFinding("h6-round-fee-rate", 0),      // suppressed by CoinJoin
      makeFinding("bip69-detected"),             // active
    ];
    applyCrossHeuristicRules(findings);
    expect(findings.some((f) => f.id === "behavioral-fingerprint-rollup")).toBe(false);
  });

  it("includes witness analysis signals in count", () => {
    const findings: Finding[] = [
      makeFinding("h11-wallet-fingerprint"),
      makeFinding("witness-mixed-types"),
    ];
    applyCrossHeuristicRules(findings);
    const rollup = findings.find((f) => f.id === "behavioral-fingerprint-rollup");
    expect(rollup).toBeDefined();
    expect(rollup!.params?.signalCount).toBe(2);
  });
});
