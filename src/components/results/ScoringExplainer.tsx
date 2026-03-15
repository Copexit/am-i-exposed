"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";

export function ScoringExplainer({ isAddress }: { isAddress?: boolean }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const baseScore = isAddress ? "93" : "70";

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="scoring-explainer-panel"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
      >
        <Info size={12} aria-hidden="true" />
        {t("results.howScoringWorks", { defaultValue: "How scoring works" })}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden col-span-full"
          >
            <div id="scoring-explainer-panel" className="bg-surface-inset rounded-lg px-4 py-3 text-sm text-muted leading-relaxed space-y-2 mt-2">
              <p>
                {t("results.scoringExplainerP1", { defaultValue: "Scores start at " })}<strong className="text-foreground">{baseScore}/100</strong>{t("results.scoringExplainerP1b", { defaultValue: " (baseline) and are adjusted by each heuristic finding. Negative findings (address reuse, change detection, round amounts) lower the score. Positive findings (CoinJoin, high entropy, anonymity sets) raise it." })}
              </p>
              <p>
                <strong className="text-severity-good">A+ (90+)</strong>{" "}
                <strong className="text-severity-low">B (75-89)</strong>{" "}
                <strong className="text-severity-medium">C (50-74)</strong>{" "}
                <strong className="text-severity-high">D (25-49)</strong>{" "}
                <strong className="text-severity-critical">F (&lt;25)</strong>
              </p>
              <p>
                {t("results.scoringExplainerP3", { defaultValue: "The engine runs 32 heuristics based on published chain analysis research. Scores are clamped to 0-100. CoinJoin transactions receive adjusted scoring that accounts for their privacy-enhancing properties." })}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
