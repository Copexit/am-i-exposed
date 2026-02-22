import type { Finding, Grade, ScoringResult } from "@/lib/types";

const BASE_SCORE = 70;
const MIN_SCORE = 0;
const MAX_SCORE = 100;

/**
 * Calculate a privacy score from a set of findings.
 *
 * Model: start at 70 (neutral), sum all heuristic impacts, clamp to 0-100.
 *
 * Grade thresholds:
 * - A+ >= 90: Excellent privacy practices
 * - B  >= 75: Good, minor issues
 * - C  >= 50: Fair, notable concerns
 * - D  >= 25: Poor, significant exposure
 * - F  <  25: Critical privacy failures
 */
export function calculateScore(findings: Finding[]): ScoringResult {
  const totalImpact = findings.reduce((sum, f) => sum + f.scoreImpact, 0);
  const rawScore = BASE_SCORE + totalImpact;
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

function severityOrder(s: string): number {
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
