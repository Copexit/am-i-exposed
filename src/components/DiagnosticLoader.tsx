"use client";

import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Check, Loader2, Circle } from "lucide-react";
import type { HeuristicStep } from "@/lib/analysis/orchestrator";

interface DiagnosticLoaderProps {
  steps: HeuristicStep[];
  phase: "fetching" | "analyzing";
}

export function DiagnosticLoader({ steps, phase }: DiagnosticLoaderProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 100) / 10);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const doneCount = steps.filter((s) => s.status === "done").length;

  // Running score tally
  const totalImpact = steps.reduce((sum, s) => sum + (s.impact ?? 0), 0);
  const runningScore = Math.max(0, Math.min(100, 70 + totalImpact));
  const hasImpact = steps.some((s) => s.impact !== undefined);

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin text-bitcoin" />
          <span>
            {phase === "fetching"
              ? "Fetching data from mempool.space..."
              : "Diagnosing your privacy..."}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {phase === "analyzing" && hasImpact && (
            <motion.span
              key={runningScore}
              initial={{ opacity: 0.5, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`text-sm font-bold tabular-nums ${
                runningScore >= 75
                  ? "text-severity-good"
                  : runningScore >= 50
                    ? "text-severity-medium"
                    : "text-severity-critical"
              }`}
            >
              {runningScore}
            </motion.span>
          )}
          <span className="text-xs text-muted/90 tabular-nums">
            {elapsed.toFixed(1)}s
          </span>
        </div>
      </div>

      {/* Progress bar */}
      {phase === "analyzing" && steps.length > 0 && (
        <div className="w-full h-0.5 bg-surface-inset rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-bitcoin/60 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${(doneCount / steps.length) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      )}

      <div className="space-y-1.5">
        {steps.map((step, i) => (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.2 }}
            className="flex items-center gap-2.5 text-sm"
          >
            <StepIcon status={step.status} />
            <span
              className={`flex-1 ${
                step.status === "done"
                  ? "text-foreground/80"
                  : step.status === "running"
                    ? "text-foreground"
                    : "text-muted/90"
              }`}
            >
              {step.label}
            </span>
            {step.status === "done" && step.impact !== undefined && step.impact !== 0 && (
              <span
                className={`text-xs tabular-nums ${
                  step.impact > 0 ? "text-severity-good" : "text-severity-critical/70"
                }`}
              >
                {step.impact > 0 ? "+" : ""}{step.impact}
              </span>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: HeuristicStep["status"] }) {
  switch (status) {
    case "done":
      return <Check size={14} className="text-success shrink-0" />;
    case "running":
      return (
        <Loader2 size={14} className="animate-spin text-bitcoin shrink-0" />
      );
    case "pending":
      return <Circle size={14} className="text-muted/90 shrink-0" />;
  }
}
