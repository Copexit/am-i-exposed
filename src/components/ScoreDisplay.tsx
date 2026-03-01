"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { Finding, Grade } from "@/lib/types";
import { getSummarySentiment } from "@/lib/scoring/score";
import { useTranslation } from "react-i18next";
import { GRADE_COLORS, GRADE_HEX } from "@/lib/constants";

interface ScoreDisplayProps {
  score: number;
  grade: Grade;
  findings?: Finding[];
}

/** Convert hex color to rgba string with given opacity. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Glow colors derived from GRADE_HEX with grade-specific opacity. */
const GRADE_GLOW_COLORS: Record<Grade, string> = {
  "A+": hexToRgba(GRADE_HEX["A+"], 0.3),
  B: hexToRgba(GRADE_HEX.B, 0.25),
  C: hexToRgba(GRADE_HEX.C, 0.25),
  D: hexToRgba(GRADE_HEX.D, 0.25),
  F: hexToRgba(GRADE_HEX.F, 0.3),
};

const BAR_COLORS: Record<Grade, string> = {
  "A+": "bg-severity-good",
  B: "bg-severity-low",
  C: "bg-severity-medium",
  D: "bg-severity-high",
  F: "bg-severity-critical",
};

export function ScoreDisplay({ score, grade, findings }: ScoreDisplayProps) {
  const { t } = useTranslation();
  const [displayScore, setDisplayScore] = useState(0);

  // Animated count-up
  useEffect(() => {
    const duration = 1200;
    const steps = 60;
    const increment = score / steps;
    let current = 0;
    let frame = 0;

    const timer = setInterval(() => {
      frame++;
      current = Math.min(score, Math.round(increment * frame));
      setDisplayScore(current);

      if (frame >= steps) {
        setDisplayScore(score);
        clearInterval(timer);
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [score]);

  const isDanger = grade === "F";

  return (
    <div
      className={`flex flex-col items-center gap-4 ${isDanger ? "relative" : ""}`}
      data-testid="score-display"
      data-score={score}
      data-grade={grade}
      role="status"
      aria-label={t("score.ariaLabel", { score, grade, defaultValue: "Privacy score: {{score}} out of 100, grade {{grade}}" })}
    >
      {isDanger && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -inset-4 rounded-xl bg-severity-critical/5 border border-severity-critical/20 -z-10"
        />
      )}

      <div className="flex items-baseline gap-3">
        <div className="relative">
          {/* Glow burst behind grade */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 2, opacity: [0.6, 0] }}
            transition={{ delay: 0.3, duration: 1, ease: "easeOut" }}
            className="absolute inset-0 -z-10 rounded-full"
            style={{
              background: `radial-gradient(circle, ${GRADE_GLOW_COLORS[grade]} 0%, transparent 70%)`,
            }}
          />
          <motion.span
            initial={{ scale: 0.5, opacity: 0 }}
            animate={grade === "A+" ? {
              scale: 1,
              opacity: 1,
              textShadow: [
                `0 0 20px rgba(40, 208, 101, 0.3)`,
                `0 0 35px rgba(40, 208, 101, 0.5)`,
                `0 0 20px rgba(40, 208, 101, 0.3)`,
              ],
            } : { scale: 1, opacity: 1 }}
            transition={grade === "A+" ? {
              scale: { delay: 0.2, type: "spring", stiffness: 200 },
              opacity: { delay: 0.2, type: "spring", stiffness: 200 },
              textShadow: { duration: 3, repeat: Infinity, ease: "easeInOut" },
            } : { delay: 0.2, type: "spring", stiffness: 200 }}
            className={`text-6xl lg:text-7xl font-bold tabular-nums ${GRADE_COLORS[grade]}`}
            style={{
              textShadow: grade !== "A+" ? undefined : `0 0 20px ${GRADE_GLOW_COLORS["A+"]}`,
            }}
          >
            {grade}
          </motion.span>
        </div>
        <span className="text-3xl text-muted tabular-nums">
          {displayScore}
          <span className="text-xl text-muted/60">/100</span>
        </span>
      </div>

      {/* Score bar with grade markers */}
      <div className="w-full max-w-sm">
        <div className="relative h-2 bg-surface-inset rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(score, 2)}%` }}
            transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
            className={`h-full rounded-full ${BAR_COLORS[grade]} relative overflow-hidden`}
          >
            {/* Shimmer overlay */}
            <div
              className="absolute inset-0 opacity-30"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
                animation: "shimmer 2s infinite",
              }}
            />
          </motion.div>
        </div>
        <div className="relative mt-0.5" style={{ height: 20 }}>
          {[
            { pos: 0, label: "F" },
            { pos: 25, label: "D" },
            { pos: 50, label: "C" },
            { pos: 75, label: "B" },
            { pos: 90, label: "A+" },
          ].map(({ pos, label }) => (
            <div
              key={label}
              className="absolute flex flex-col items-center"
              style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
            >
              <div className="w-px h-1.5 bg-muted/60" />
              <span className="text-xs text-muted mt-0.5 leading-none">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-base text-muted">
        {grade === "A+"
          ? t("score.gradeAPlus", { defaultValue: "Excellent privacy practices" })
          : grade === "B"
            ? t("score.gradeB", { defaultValue: "Good privacy, minor concerns" })
            : grade === "C"
              ? findings && getSummarySentiment(grade, findings) === "positive"
                ? t("score.gradeCPositive", { defaultValue: "Good privacy practices" })
                : t("score.gradeC", { defaultValue: "Fair privacy, notable issues found" })
              : grade === "D"
                ? t("score.gradeD", { defaultValue: "Poor privacy, significant exposure" })
                : t("score.gradeF", { defaultValue: "Critical privacy failures detected" })}
      </p>
    </div>
  );
}
