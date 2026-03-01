import type { Finding, Grade, Severity, ScoringResult } from "@/lib/types";

/** Base score for transaction analysis (13 heuristics, impacts up to +30). */
export const TX_BASE_SCORE = 70;
/** Base score for address analysis (4 heuristics, max positive +7). */
export const ADDRESS_BASE_SCORE = 93;
const MIN_SCORE = 0;
const MAX_SCORE = 100;

export type AnalysisMode = "tx" | "address";

/**
 * Calculate a privacy score from a set of findings.
 *
 * Model: start at base (70 for tx, 93 for address), sum all heuristic
 * impacts, clamp to 0-100.
 *
 * Grade thresholds:
 * - A+ >= 90: Excellent privacy practices
 * - B  >= 75: Good, minor issues
 * - C  >= 50: Fair, notable concerns
 * - D  >= 25: Poor, significant exposure
 * - F  <  25: Critical privacy failures
 */
export function calculateScore(findings: Finding[], mode: AnalysisMode = "tx"): ScoringResult {
  const baseScore = mode === "address" ? ADDRESS_BASE_SCORE : TX_BASE_SCORE;
  const totalImpact = findings.reduce((sum, f) => sum + f.scoreImpact, 0);
  const rawScore = baseScore + totalImpact;
  const score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, rawScore));
  const grade = scoreToGrade(score);

  // Sort findings by severity (most severe first)
  const sortedFindings = [...findings].sort(
    (a, b) => severityOrder(a.severity) - severityOrder(b.severity),
  );

  return { score, grade, findings: sortedFindings };
}

function scoreToGrade(score: number): Grade {
  if (score >= 90) return "A+";
  if (score >= 75) return "B";
  if (score >= 50) return "C";
  if (score >= 25) return "D";
  return "F";
}

export type SummarySentiment = "positive" | "cautious" | "warning" | "danger";

/**
 * Derive the summary sentiment from the grade and findings.
 *
 * If no finding has a negative scoreImpact the sentiment is always "positive",
 * regardless of the numeric grade.  This prevents all-green results from
 * showing a scary amber/orange banner.
 */
export function getSummarySentiment(
  grade: Grade,
  findings: Finding[],
): SummarySentiment {
  if (grade === "F") return "danger";

  const hasNegative = findings.some((f) => f.scoreImpact < 0);

  if (!hasNegative) return "positive";

  if (grade === "A+" || grade === "B") return "positive";
  if (grade === "C") return "cautious";
  // D with negative findings
  return "warning";
}

function severityOrder(s: Severity): number {
  switch (s) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    case "good":
      return 4;
    default:
      return 5;
  }
}
