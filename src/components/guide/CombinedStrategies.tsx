"use client";

import { ChevronDown, AlertTriangle, Route } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { COMBINED_PATHWAYS } from "@/data/guide/pathways";

interface CombinedStrategiesProps {
  expanded: boolean;
  onToggle: () => void;
}

export function CombinedStrategies({ expanded, onToggle }: CombinedStrategiesProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <h2 id="combined-strategies" className="text-2xl font-bold text-foreground scroll-mt-24">
        <Route size={20} className="inline mr-2 text-bitcoin" />
        {t("guide.combinedTitle", { defaultValue: "Combined strategies" })}
      </h2>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 text-sm font-medium text-foreground/90 cursor-pointer hover:text-foreground transition-colors w-full text-left"
      >
        {t("pathways.combined.title", { defaultValue: "Combined pathways (strongest privacy)" })}
        <ChevronDown
          size={14}
          className={`text-muted transition-transform ml-auto ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="space-y-3">
              <p className="text-sm text-muted leading-relaxed">
                {t("pathways.combined.intro", {
                  defaultValue: "Think beyond single-tool solutions. The most effective privacy strategies combine multiple techniques across different layers.",
                })}
              </p>
              {COMBINED_PATHWAYS.map((combo) => (
                <div
                  key={combo.id}
                  id={combo.id}
                  className="bg-surface-elevated/50 border border-card-border rounded-lg px-4 py-3 space-y-1.5 scroll-mt-24"
                >
                  <p className="text-sm font-medium text-bitcoin">
                    {t(combo.titleKey, { defaultValue: combo.titleDefault })}
                  </p>
                  <p className="text-sm text-foreground/80 leading-relaxed">
                    {t(combo.stepsKey, { defaultValue: combo.stepsDefault })}
                  </p>
                  <p className="text-xs text-muted leading-relaxed">
                    {t(combo.strengthKey, { defaultValue: combo.strengthDefault })}
                  </p>
                </div>
              ))}
              <div className="flex items-start gap-1.5 bg-severity-medium/10 rounded-lg px-3 py-2 mt-1">
                <AlertTriangle size={14} className="text-severity-medium shrink-0 mt-0.5" />
                <p className="text-xs text-foreground/80 leading-relaxed">
                  {t("pathways.jurisdictionNote", {
                    defaultValue: "Privacy tools like CoinJoin and atomic swaps are standard Bitcoin transactions - not illegal anywhere. However, KYC exchanges may flag, delay, or restrict funds that have interacted with privacy tools due to internal compliance policies. If using KYC exchanges, send to your own wallet first. For full freedom, use non-KYC, trustless, and permissionless systems.",
                  })}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
