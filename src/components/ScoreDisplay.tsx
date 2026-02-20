"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { Grade } from "@/lib/types";
import { useTranslation } from "react-i18next";

interface ScoreDisplayProps {
  score: number;
  grade: Grade;
}

const GRADE_COLORS: Record<Grade, string> = {
  "A+": "text-severity-good",
  B: "text-severity-low",
  C: "text-severity-medium",
  D: "text-severity-high",
  F: "text-severity-critical",
};

const BAR_COLORS: Record<Grade, string> = {
  "A+": "bg-severity-good",
  B: "bg-severity-low",
  C: "bg-severity-medium",
  D: "bg-severity-high",
  F: "bg-severity-critical",
};

export function ScoreDisplay({ score, grade }: ScoreDisplayProps) {
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
        <motion.span
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          className={`text-6xl font-bold tabular-nums ${GRADE_COLORS[grade]}`}
        >
          {grade}
        </motion.span>
        <span className="text-2xl text-muted tabular-nums">
          {displayScore}
          <span className="text-muted">/100</span>
        </span>
      </div>

      {/* Score bar with grade markers */}
      <div className="w-full max-w-xs">
        <div className="relative h-2 bg-surface-inset rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(score, 2)}%` }}
            transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
            className={`h-full rounded-full ${BAR_COLORS[grade]}`}
          />
        </div>
        <div className="relative h-3 mt-0.5">
          {[25, 50, 75, 90].map((threshold) => (
            <div
              key={threshold}
              className="absolute top-0 w-px h-1.5 bg-muted/60"
              style={{ left: `${threshold}%` }}
            />
          ))}
          <div className="flex justify-between text-xs text-muted mt-1">
            <span>F</span>
            <span style={{ position: "absolute", left: "25%", transform: "translateX(-50%)" }}>D</span>
            <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }}>C</span>
            <span style={{ position: "absolute", left: "75%", transform: "translateX(-50%)" }}>B</span>
            <span style={{ position: "absolute", left: "90%", transform: "translateX(-50%)" }}>A+</span>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted">
        {grade === "A+"
          ? t("score.gradeAPlus", { defaultValue: "Excellent privacy practices" })
          : grade === "B"
            ? t("score.gradeB", { defaultValue: "Good privacy, minor concerns" })
            : grade === "C"
              ? t("score.gradeC", { defaultValue: "Fair privacy, notable issues found" })
              : grade === "D"
                ? t("score.gradeD", { defaultValue: "Poor privacy, significant exposure" })
                : t("score.gradeF", { defaultValue: "Critical privacy failures detected" })}
      </p>
    </div>
  );
}
