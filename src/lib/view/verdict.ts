import type { Finding, Grade } from "@/lib/types";
import { getSummarySentiment } from "@/lib/scoring/score";

/** i18n key + English default of the one-line grade tagline ("Poor privacy, significant exposure"). */
/** Without findings, B and C fall back to their "concerns" variants (classic ScoreDisplay behavior). */
export function gradeTagline(grade: Grade, findings: readonly Finding[] | undefined): { key: string; defaultValue: string } {
  switch (grade) {
    case "A+":
      return { key: "score.gradeAPlus", defaultValue: "Excellent privacy practices" };
    case "B":
      return !findings || findings.some((f) => f.scoreImpact < 0)
        ? { key: "score.gradeB", defaultValue: "Good privacy, minor concerns" }
        : { key: "score.gradeBPositive", defaultValue: "Good privacy practices" };
    case "C":
      return findings && getSummarySentiment(grade, [...findings]) === "positive"
        ? { key: "score.gradeCPositive", defaultValue: "Good privacy practices" }
        : { key: "score.gradeC", defaultValue: "Fair privacy, notable issues found" };
    case "D":
      return { key: "score.gradeD", defaultValue: "Poor privacy, significant exposure" };
    default:
      return { key: "score.gradeF", defaultValue: "Critical privacy failures detected" };
  }
}
