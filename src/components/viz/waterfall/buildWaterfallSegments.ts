import { SVG_COLORS, SEVERITY_HEX, GRADE_HEX_SVG } from "../shared/svgConstants";
import type { Finding, Grade } from "@/lib/types";
import { findingKeys } from "@/lib/finding-utils";

export interface WaterfallSegment {
  key: string;
  label: string;
  value: number;
  runningStart: number;
  runningEnd: number;
  color: string;
  findingId?: string;
  severity?: string;
}

/**
 * Build the array of waterfall segments from findings.
 *
 * Pure function - no React dependency, independently testable.
 */
export function buildWaterfallSegments(
  findings: Finding[],
  finalScore: number,
  grade: Grade,
  baseScore: number,
  t: (key: string | string[], opts?: Record<string, unknown>) => string,
): WaterfallSegment[] {
  const impactFindings = findings.filter((f) => f.scoreImpact !== 0);
  // Sort: positive first, then negative by magnitude
  const sorted = [...impactFindings].sort((a, b) => {
    if (a.scoreImpact > 0 && b.scoreImpact <= 0) return -1;
    if (a.scoreImpact <= 0 && b.scoreImpact > 0) return 1;
    return Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact);
  });

  const segs: WaterfallSegment[] = [];
  let running = baseScore;

  // Base column
  segs.push({
    key: "base",
    label: t("viz.waterfall.base", { defaultValue: "Base" }),
    value: baseScore,
    runningStart: 0,
    runningEnd: baseScore,
    color: SVG_COLORS.muted,
  });

  // Impact columns
  for (const f of sorted) {
    const start = running;
    running = Math.max(0, Math.min(100, running + f.scoreImpact));
    segs.push({
      key: f.id,
      label: t(findingKeys(f.id, "title", f.params), { ...f.params, defaultValue: f.title }),
      value: f.scoreImpact,
      runningStart: Math.min(start, running),
      runningEnd: Math.max(start, running),
      color: f.scoreImpact > 0 ? SVG_COLORS.good : SEVERITY_HEX[f.severity] ?? SVG_COLORS.high,
      findingId: f.id,
      severity: f.severity,
    });
  }

  // Final column
  segs.push({
    key: "final",
    label: t("viz.waterfall.final", { defaultValue: "Final" }),
    value: finalScore,
    runningStart: 0,
    runningEnd: finalScore,
    color: GRADE_HEX_SVG[grade],
  });

  return segs;
}
