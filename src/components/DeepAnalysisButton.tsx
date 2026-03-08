"use client";

import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Search, Loader2, X, CheckCircle, AlertCircle } from "lucide-react";
import type { DeepAnalysisState, AnalysisLevel } from "@/hooks/useDeepAnalysis";

interface DeepAnalysisButtonProps {
  state: DeepAnalysisState;
  onAnalyze: (level: AnalysisLevel) => void;
  onCancel: () => void;
}

export function DeepAnalysisButton({ state, onAnalyze, onCancel }: DeepAnalysisButtonProps) {
  const { t } = useTranslation();

  if (state.status === "complete") {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-severity-good bg-severity-good/10 rounded-lg px-3 py-2">
        <CheckCircle size={14} />
        {t("deepAnalysis.complete", {
          calls: state.totalCalls,
          defaultValue: "Deep analysis complete ({{calls}} API calls)",
        })}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-severity-critical bg-severity-critical/10 rounded-lg px-3 py-2">
          <AlertCircle size={14} />
          {state.error ?? t("deepAnalysis.error", { defaultValue: "Analysis failed" })}
        </span>
        <button
          onClick={() => onAnalyze(state.level)}
          className="text-xs text-bitcoin hover:text-bitcoin-hover transition-colors cursor-pointer"
        >
          {t("deepAnalysis.retry", { defaultValue: "Retry" })}
        </button>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="inline-flex items-center gap-2">
        <div className="flex items-center gap-2 bg-surface-inset rounded-lg px-3 py-2">
          <Loader2 size={14} className="text-bitcoin animate-spin" />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted">
              {t("deepAnalysis.analyzing", {
                completed: state.completedCalls,
                total: state.totalCalls,
                defaultValue: "Analyzing... {{completed}}/{{total}}",
              })}
            </span>
            {state.totalCalls > 0 && (
              <div className="w-24 h-1 bg-card-border rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-bitcoin rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${state.progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onCancel}
          className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
          aria-label={t("deepAnalysis.cancel", { defaultValue: "Cancel" })}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => onAnalyze(2)}
      className="inline-flex items-center gap-1.5 text-xs text-bitcoin/80 hover:text-bitcoin bg-bitcoin/10 hover:bg-bitcoin/15 rounded-lg px-3 py-2 transition-colors cursor-pointer"
    >
      <Search size={14} />
      {t("deepAnalysis.button", { defaultValue: "Deep analysis" })}
    </button>
  );
}
