"use client";

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { ChartErrorBoundary } from "../ui/ChartErrorBoundary";
import { CollapsibleSection } from "../ui/Collapse";
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
  return (
    <CollapsibleSection label={t("results.scoreImpact", { defaultValue: "Score impact" })} delay={delay}>
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
    </CollapsibleSection>
  );
}
