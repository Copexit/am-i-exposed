"use client";

import { useState, memo } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { BookOpen } from "lucide-react";
import type { Finding, Severity, ConfidenceLevel } from "@/lib/types";
import { WalletIcon } from "@/components/ui/WalletIcon";

/** Map finding IDs to relevant FAQ section anchors */
const FINDING_LEARN_MORE: Record<string, { faqId: string; labelKey: string; labelDefault: string }> = {
  "h8-address-reuse": { faqId: "address-reuse", labelKey: "learnMore.addressReuse", labelDefault: "Why address reuse is dangerous" },
  "h2-change-detected": { faqId: "change-detection", labelKey: "learnMore.changeDetection", labelDefault: "How change detection works" },
  "h2-self-send": { faqId: "change-detection", labelKey: "learnMore.selfSend", labelDefault: "Change detection explained" },
  "h3-cioh": { faqId: "cioh", labelKey: "learnMore.cioh", labelDefault: "Common input ownership heuristic" },
  "dust-attack": { faqId: "dust-attack", labelKey: "learnMore.dustAttack", labelDefault: "What is a dust attack?" },
  "h5-entropy": { faqId: "coinjoin", labelKey: "learnMore.coinjoin", labelDefault: "How CoinJoin improves privacy" },
  "h5-low-entropy": { faqId: "coinjoin", labelKey: "learnMore.entropy", labelDefault: "Transaction entropy explained" },
};

interface FindingCardProps {
  finding: Finding;
  index: number;
  defaultExpanded?: boolean;
}

const SEVERITY_STYLES: Record<
  Severity,
  { dot: string; label: string; text: string; border: string; glow?: string }
> = {
  critical: {
    dot: "bg-severity-critical",
    label: "Critical",
    text: "text-severity-critical",
    border: "border-l-severity-critical",
    glow: "shadow-[inset_4px_0_12px_-4px_rgba(239,68,68,0.15)]",
  },
  high: {
    dot: "bg-severity-high",
    label: "High",
    text: "text-severity-high",
    border: "border-l-severity-high",
    glow: "shadow-[inset_4px_0_12px_-4px_rgba(249,115,22,0.12)]",
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

const CONFIDENCE_STYLES: Record<ConfidenceLevel, { label: string; className: string }> = {
  deterministic: { label: "Definite", className: "bg-severity-critical/20 text-severity-critical border-severity-critical" },
  high: { label: "Likely", className: "bg-severity-high/15 text-severity-high border-severity-high" },
  medium: { label: "Possible", className: "bg-severity-medium/15 text-severity-medium border-severity-medium" },
  low: { label: "Hint", className: "bg-severity-low/15 text-severity-low border-severity-low" },
};

export const FindingCard = memo(function FindingCard({ finding, index, defaultExpanded = false }: FindingCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const reducedMotion = useReducedMotion();
  const style = SEVERITY_STYLES[finding.severity];
  const severityLabel = t(`common.severity.${finding.severity}`, { defaultValue: style.label });
  const confidence = finding.confidence;
  const confidenceStyle = confidence ? CONFIDENCE_STYLES[confidence] : null;

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className={`glass rounded-lg overflow-hidden border-l-2 ${style.border} ${style.glow ?? ""}`}
      data-finding-id={finding.id}
      role="article"
      aria-label={`${severityLabel} finding: ${t(`finding.${finding.id}.title`, { ...finding.params, defaultValue: finding.title })}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={`finding-detail-${finding.id}`}
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[48px] text-left hover:bg-surface-elevated/50 transition-colors cursor-pointer"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} aria-hidden="true" />
        {finding.id === "h11-wallet-fingerprint" && finding.params?.walletGuess && (
          <WalletIcon walletName={String(finding.params.walletGuess)} size="sm" />
        )}
        <span className="flex-1 text-sm font-medium text-foreground">
          {t(`finding.${finding.id}.title`, { ...finding.params, defaultValue: finding.title })}
        </span>
        {confidenceStyle && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${confidenceStyle.className}`}>
            {t(`common.confidence.${confidence}`, { defaultValue: confidenceStyle.label })}
          </span>
        )}
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
            <div id={`finding-detail-${finding.id}`} className="px-5 pb-5 space-y-3 border-t border-card-border pt-3">
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
              <div className="flex items-center justify-between">
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
                {FINDING_LEARN_MORE[finding.id] && (
                  <a
                    href={`/faq/#${FINDING_LEARN_MORE[finding.id].faqId}`}
                    className="inline-flex items-center gap-1 text-xs text-bitcoin hover:text-bitcoin-hover transition-colors"
                  >
                    <BookOpen size={12} />
                    {t(FINDING_LEARN_MORE[finding.id].labelKey, { defaultValue: FINDING_LEARN_MORE[finding.id].labelDefault })}
                  </a>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
