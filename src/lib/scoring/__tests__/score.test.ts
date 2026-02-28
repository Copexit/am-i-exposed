import { describe, it, expect } from "vitest";
import { calculateScore, getSummarySentiment } from "../score";
import type { Finding } from "@/lib/types";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "test",
    severity: "low",
    title: "Test finding",
    description: "Test",
    recommendation: "Test",
    scoreImpact: 0,
    ...overrides,
  };
}

describe("calculateScore", () => {
  it("returns base score 70 with no impacts", () => {
    const result = calculateScore([makeFinding({ scoreImpact: 0 })]);
    expect(result.score).toBe(70);
    expect(result.grade).toBe("C");
  });

  it("sums positive impacts", () => {
    const findings = [
      makeFinding({ scoreImpact: 20 }),
      makeFinding({ scoreImpact: 10 }),
    ];
    const result = calculateScore(findings);
    expect(result.score).toBe(100); // 70 + 30, clamped to 100
    expect(result.grade).toBe("A+");
  });

  it("sums negative impacts", () => {
    const findings = [
      makeFinding({ scoreImpact: -10 }),
      makeFinding({ scoreImpact: -15 }),
    ];
    const result = calculateScore(findings);
    expect(result.score).toBe(45); // 70 - 25
    expect(result.grade).toBe("D");
  });

  it("clamps at 0 (never negative)", () => {
    const result = calculateScore([makeFinding({ scoreImpact: -80 })]);
    expect(result.score).toBe(0);
    expect(result.grade).toBe("F");
  });

  it("clamps at 100 (never above)", () => {
    const result = calculateScore([makeFinding({ scoreImpact: 50 })]);
    expect(result.score).toBe(100);
    expect(result.grade).toBe("A+");
  });

  // Grade boundary tests
  it("grades A+ at exactly 90", () => {
    const result = calculateScore([makeFinding({ scoreImpact: 20 })]);
    expect(result.score).toBe(90);
    expect(result.grade).toBe("A+");
  });

  it("grades B at exactly 75", () => {
    const result = calculateScore([makeFinding({ scoreImpact: 5 })]);
    expect(result.score).toBe(75);
    expect(result.grade).toBe("B");
  });

  it("grades B at 89 (just below A+)", () => {
    const result = calculateScore([makeFinding({ scoreImpact: 19 })]);
    expect(result.score).toBe(89);
    expect(result.grade).toBe("B");
  });

  it("grades C at exactly 50", () => {
    const result = calculateScore([makeFinding({ scoreImpact: -20 })]);
    expect(result.score).toBe(50);
    expect(result.grade).toBe("C");
  });

  it("grades D at exactly 25", () => {
    const result = calculateScore([makeFinding({ scoreImpact: -45 })]);
    expect(result.score).toBe(25);
    expect(result.grade).toBe("D");
  });

  it("grades F below 25", () => {
    const result = calculateScore([makeFinding({ scoreImpact: -46 })]);
    expect(result.score).toBe(24);
    expect(result.grade).toBe("F");
  });

  it("sorts findings by severity (critical first, good last)", () => {
    const findings = [
      makeFinding({ id: "good", severity: "good", scoreImpact: 5 }),
      makeFinding({ id: "critical", severity: "critical", scoreImpact: -10 }),
      makeFinding({ id: "medium", severity: "medium", scoreImpact: -3 }),
    ];
    const result = calculateScore(findings);
    expect(result.findings[0].id).toBe("critical");
    expect(result.findings[1].id).toBe("medium");
    expect(result.findings[2].id).toBe("good");
  });
});

describe("getSummarySentiment", () => {
  it("returns danger for F grade", () => {
    expect(getSummarySentiment("F", [makeFinding({ scoreImpact: -50 })])).toBe("danger");
  });

  it("returns positive when no negative findings", () => {
    const findings = [makeFinding({ scoreImpact: 0 }), makeFinding({ scoreImpact: 5 })];
    expect(getSummarySentiment("B", findings)).toBe("positive");
  });

  it("returns positive when no negative findings even for C grade", () => {
    // Theoretically a C with only positive/zero findings
    expect(getSummarySentiment("C", [makeFinding({ scoreImpact: 0 })])).toBe("positive");
  });

  it("returns positive for A+ with negative findings", () => {
    expect(getSummarySentiment("A+", [makeFinding({ scoreImpact: -1 })])).toBe("positive");
  });

  it("returns positive for B with negative findings", () => {
    expect(getSummarySentiment("B", [makeFinding({ scoreImpact: -3 })])).toBe("positive");
  });

  it("returns cautious for C with negative findings", () => {
    expect(getSummarySentiment("C", [makeFinding({ scoreImpact: -5 })])).toBe("cautious");
  });

  it("returns warning for D with negative findings", () => {
    expect(getSummarySentiment("D", [makeFinding({ scoreImpact: -20 })])).toBe("warning");
  });
});
