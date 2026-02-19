"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BarChart3 } from "lucide-react";
import type { Finding } from "@/lib/types";

interface ScoreBreakdownProps {
  findings: Finding[];
  finalScore: number;
}

const BASE_SCORE = 70;

/**
 * Visual waterfall showing how each finding contributes to the final score.
 * Starts at base 70, shows each positive/negative impact as a bar segment.
 */
export function ScoreBreakdown({ findings, finalScore }: ScoreBreakdownProps) {
  const [open, setOpen] = useState(false);

  // Only show findings with non-zero impact
  const impactFindings = findings.filter((f) => f.scoreImpact !== 0);
  if (impactFindings.length === 0) return null;

  // Sort: positive first, then negative by magnitude
  const sorted = [...impactFindings].sort((a, b) => {
    if (a.scoreImpact > 0 && b.scoreImpact <= 0) return -1;
    if (a.scoreImpact <= 0 && b.scoreImpact > 0) return 1;
    return Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact);
  });

  const totalPositive = sorted
    .filter((f) => f.scoreImpact > 0)
    .reduce((sum, f) => sum + f.scoreImpact, 0);
  const totalNegative = sorted
    .filter((f) => f.scoreImpact < 0)
    .reduce((sum, f) => sum + f.scoreImpact, 0);

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs text-foreground/70 hover:text-foreground transition-colors cursor-pointer px-1 min-h-[44px]"
      >
        <BarChart3 size={12} />
        Score breakdown
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 bg-surface-inset rounded-lg px-4 py-3 space-y-2">
              {/* Base score */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted/70">Base score</span>
                <span className="text-foreground/70 font-mono tabular-nums">{BASE_SCORE}</span>
              </div>

              {/* Waterfall items */}
              {sorted.map((f) => {
                const maxMagnitude = Math.max(
                  ...impactFindings.map((x) => Math.abs(x.scoreImpact)),
                  1,
                );
                const barWidth = Math.round(
                  (Math.abs(f.scoreImpact) / maxMagnitude) * 100,
                );

                return (
                  <div key={f.id} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 text-muted/80 truncate" title={f.title}>
                      {f.title}
                    </span>
                    <div className="w-20 h-2 bg-surface-elevated rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          f.scoreImpact > 0 ? "bg-severity-good/60" : "bg-severity-high/60"
                        }`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <div className="w-10 text-right">
                      <span
                        className={`font-mono tabular-nums ${
                          f.scoreImpact > 0
                            ? "text-severity-good"
                            : "text-severity-high"
                        }`}
                      >
                        {f.scoreImpact > 0 ? "+" : ""}
                        {f.scoreImpact}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Divider */}
              <div className="border-t border-card-border/50 my-1" />

              {/* Summary */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex gap-3">
                  {totalPositive > 0 && (
                    <span className="text-severity-good font-mono">
                      +{totalPositive}
                    </span>
                  )}
                  {totalNegative < 0 && (
                    <span className="text-severity-high font-mono">
                      {totalNegative}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted/70">Final:</span>
                  <span className="text-foreground font-bold font-mono tabular-nums">
                    {finalScore}/100
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
