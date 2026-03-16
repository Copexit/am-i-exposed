"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { FindingCard } from "../FindingCard";
import { CHAIN_FINDING_IDS } from "../ChainAnalysisPanel";
import type { ScoringResult } from "@/lib/types";

function FindingSummary({ findings }: { findings: ScoringResult["findings"] }) {
  const { t } = useTranslation();
  const issues = findings.filter((f) => f.scoreImpact < 0).length;
  const good = findings.filter((f) => f.scoreImpact > 0 || f.severity === "good").length;

  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      {issues > 0 && (
        <span className="text-severity-high">{t("results.issueCount", { count: issues, defaultValue: "{{count}} issue", defaultValue_other: "{{count}} issues" })}</span>
      )}
      {good > 0 && (
        <span className="text-severity-good">{t("results.positiveCount", { count: good, defaultValue: "{{count}} positive" })}</span>
      )}
    </div>
  );
}

export function FindingsSection({
  issues,
  visibleFindings,
  onTxClick,
  delay,
  proMode = false,
}: {
  issues: ScoringResult["findings"];
  visibleFindings: ScoringResult["findings"];
  onTxClick?: (input: string) => void;
  delay: number;
  proMode?: boolean;
}) {
  const { t } = useTranslation();

  if (issues.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay }} className="w-full space-y-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-base font-medium text-muted uppercase tracking-wider">
          {t("results.findingsHeading", { count: visibleFindings.length, defaultValue: "Findings ({{count}})" })}
        </h2>
        <FindingSummary findings={visibleFindings} />
      </div>
      <div className="space-y-3">
        {issues.map((finding, i) => (
          <FindingCard
            key={finding.id}
            finding={finding}
            index={i}
            defaultExpanded={finding.severity === "critical" || (finding.severity === "high" && !issues.some(f => f.severity === "critical"))}
            badge={CHAIN_FINDING_IDS.has(finding.id) ? t("results.chainBadge", { defaultValue: "Chain" }) : undefined}
            onTxClick={onTxClick}
            proMode={proMode}
          />
        ))}
      </div>
    </motion.div>
  );
}
