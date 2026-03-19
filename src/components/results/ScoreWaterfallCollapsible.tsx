"use client";

import { useState, lazy, Suspense } from "react";
import { ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { ChartErrorBoundary } from "../ui/ChartErrorBoundary";
import { fadeUpVariants, fadeUpTransition } from "./animations";
import type { ScoringResult } from "@/lib/types";

const ScoreWaterfall = lazy(() => import("../viz/ScoreWaterfall").then(m => ({ default: m.ScoreWaterfall })));

export function ScoreWaterfallCollapsible({
  findings,
  score,
  grade,
  baseScore,
  onFindingClick,
  delay,
}: {
  findings: ScoringResult["findings"];
  score: number;
  grade: ScoringResult["grade"];
  baseScore: number;
  onFindingClick: (id: string) => void;
  delay: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      {...fadeUpVariants}
      transition={fadeUpTransition(delay)}
      className="w-full"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-1 py-2 text-left group cursor-pointer"
        aria-expanded={open}
      >
        <ChevronRight
          size={14}
          className={`text-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        <span className="text-sm font-medium text-muted uppercase tracking-wider">
          {t("results.scoreImpact", { defaultValue: "Score impact" })}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="pt-1">
              <ChartErrorBoundary>
                <Suspense fallback={null}>
                  <ScoreWaterfall
                    findings={findings}
                    finalScore={score}
                    grade={grade}
                    baseScore={baseScore}
                    onFindingClick={onFindingClick}
                  />
                </Suspense>
              </ChartErrorBoundary>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
