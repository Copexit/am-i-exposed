import type { Finding } from "@/lib/types";

export interface WaterfallStep {
  findingId: Finding["id"];
  severity: Finding["severity"];
  impact: number;
  /** Unclamped running total before and after this step. */
  from: number;
  to: number;
}

export interface ScoreWaterfall {
  base: number;
  steps: WaterfallStep[];
  /** base + sum of impacts, before clamping. */
  raw: number;
  /** The reported score: raw clamped to 0-100. */
  final: number;
  /** True when the clamp changed the result (raw outside 0-100). */
  clamped: boolean;
}

/**
 * Where the score went: base plus each finding's impact, in display order
 * (gains first, then losses by magnitude). The running total is NOT clamped
 * per step - calculateScore clamps once at the end, so clamping mid-way would
 * misreport the path whenever gains push the total past 100.
 */
export function buildScoreWaterfall(findings: readonly Finding[], base: number): ScoreWaterfall {
  const impactful = findings.filter((f) => f.scoreImpact !== 0);
  const ordered = [...impactful].sort((a, b) => {
    if (a.scoreImpact > 0 !== b.scoreImpact > 0) return a.scoreImpact > 0 ? -1 : 1;
    return Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact);
  });
  let running = base;
  const steps = ordered.map((f) => {
    const from = running;
    running += f.scoreImpact;
    return { findingId: f.id, severity: f.severity, impact: f.scoreImpact, from, to: running };
  });
  const final = Math.max(0, Math.min(100, running));
  return { base, steps, raw: running, final, clamped: final !== running };
}
