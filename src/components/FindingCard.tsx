"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import type { Finding, Severity } from "@/lib/types";

interface FindingCardProps {
  finding: Finding;
  index: number;
  defaultExpanded?: boolean;
}

const SEVERITY_STYLES: Record<
  Severity,
  { dot: string; label: string; text: string; border: string }
> = {
  critical: {
    dot: "bg-severity-critical",
    label: "Critical",
    text: "text-severity-critical",
    border: "border-l-severity-critical",
  },
  high: {
    dot: "bg-severity-high",
    label: "High",
    text: "text-severity-high",
    border: "border-l-severity-high",
  },
  medium: {
    dot: "bg-severity-medium",
    label: "Medium",
    text: "text-severity-medium",
    border: "border-l-severity-medium",
  },
  low: {
    dot: "bg-severity-low",
    label: "Low",
    text: "text-severity-low",
    border: "border-l-severity-low",
  },
  good: {
    dot: "bg-severity-good",
    label: "Good",
    text: "text-severity-good",
    border: "border-l-severity-good",
  },
};

export function FindingCard({ finding, index, defaultExpanded = false }: FindingCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const style = SEVERITY_STYLES[finding.severity];
  const severityLabel = t(`common.severity.${finding.severity}`, { defaultValue: style.label });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className={`border border-card-border rounded-lg overflow-hidden border-l-2 ${style.border}`}
      role="article"
      aria-label={`${severityLabel} finding: ${t(`finding.${finding.id}.title`, { ...finding.params, defaultValue: finding.title })}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-elevated/50 transition-colors cursor-pointer"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
        <span className="flex-1 text-sm font-medium text-foreground">
          {t(`finding.${finding.id}.title`, { ...finding.params, defaultValue: finding.title })}
        </span>
        <span className={`text-xs font-medium ${style.text}`}>
          {severityLabel}
        </span>
        <ChevronDown
          size={14}
          className={`text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-3 border-t border-card-border pt-3">
              <p className="text-base text-foreground leading-relaxed">
                {t(`finding.${finding.id}.description`, { ...finding.params, defaultValue: finding.description })}
              </p>
              {finding.recommendation && (
                <div className="bg-surface-inset rounded-md px-3 py-2">
                  <p className="text-xs font-medium text-muted mb-1">
                    {t("finding.recommendationLabel", { defaultValue: "Recommendation" })}
                  </p>
                  <p className="text-base text-foreground/90 leading-relaxed">
                    {t(`finding.${finding.id}.recommendation`, { ...finding.params, defaultValue: finding.recommendation })}
                  </p>
                </div>
              )}
              {finding.scoreImpact !== 0 && (
                <p className="text-xs text-muted">
                  {t("finding.scoreImpactLabel", { defaultValue: "Score impact:" })}{" "}
                  <span
                    className={
                      finding.scoreImpact > 0
                        ? "text-severity-good"
                        : "text-severity-high"
                    }
                  >
                    {finding.scoreImpact > 0 ? "+" : ""}
                    {finding.scoreImpact}
                  </span>
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
