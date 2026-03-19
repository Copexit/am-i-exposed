"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { Finding } from "@/lib/types";
import { SEVERITY_TEXT, SEVERITY_BG } from "@/lib/severity";
import { findingKey } from "@/lib/finding-utils";

interface ChainAnalysisPanelProps {
  findings: Finding[];
}

/** Category keys for chain finding routing */
type ChainCategory = "input-provenance" | "output-destinations" | "structural" | "spending-patterns";

/** Explicit map from finding ID to its display category. */
const FINDING_CATEGORY: Record<string, ChainCategory> = {
  // Input provenance (backward analysis)
  "chain-coinjoin-input": "input-provenance",
  "chain-exchange-input": "input-provenance",
  "chain-dust-input": "input-provenance",
  "chain-entity-proximity-backward": "input-provenance",
  "chain-coinjoin-ancestry": "input-provenance",
  "chain-taint-backward": "input-provenance",
  // Output destinations (forward analysis)
  "chain-post-coinjoin-consolidation": "output-destinations",
  "chain-forward-peel": "output-destinations",
  "chain-toxic-merge": "output-destinations",
  "chain-post-coinjoin-direct-spend": "output-destinations",
  "chain-entity-proximity-forward": "output-destinations",
  "chain-coinjoin-descendancy": "output-destinations",
  "peel-chain-trace": "output-destinations",
  "peel-chain-trace-short": "output-destinations",
  // Structural analysis
  "linkability-deterministic": "structural",
  "linkability-ambiguous": "structural",
  "linkability-equal-subset": "structural",
  "chain-cluster-size": "structural",
  "chain-coinjoin-quality": "structural",
  "joinmarket-subset-sum": "structural",
  "joinmarket-subset-sum-resistant": "structural",
  "joinmarket-taker-maker": "structural",
  "joinmarket-multi-round": "structural",
  // Spending patterns
  "chain-near-exact-spend": "spending-patterns",
  "chain-ricochet": "spending-patterns",
  "chain-sweep-chain": "spending-patterns",
  "chain-post-cj-partial-spend": "spending-patterns",
  "chain-post-mix-consolidation": "spending-patterns",
  "chain-kyc-consolidation-before-cj": "spending-patterns",
};

/** Chain analysis finding IDs that this panel highlights */
export const CHAIN_FINDING_IDS = new Set(Object.keys(FINDING_CATEGORY));


export function ChainAnalysisPanel({ findings }: ChainAnalysisPanelProps) {
  const { t } = useTranslation();
  const chainFindings = useMemo(
    () => findings.filter((f) => CHAIN_FINDING_IDS.has(f.id)),
    [findings],
  );

  if (chainFindings.length === 0) return null;

  const backward = chainFindings.filter((f) => FINDING_CATEGORY[f.id] === "input-provenance");
  const forward = chainFindings.filter((f) => FINDING_CATEGORY[f.id] === "output-destinations");
  const structural = chainFindings.filter((f) => FINDING_CATEGORY[f.id] === "structural");
  const spending = chainFindings.filter((f) => FINDING_CATEGORY[f.id] === "spending-patterns");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="rounded-xl border border-card-border bg-surface-inset p-4 space-y-4"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/70">
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
          <path d="M2 8h4m4 0h4M8 2v4m0 4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        {t("chainAnalysis.title", { defaultValue: "Chain Analysis" })}
      </div>

      {backward.length > 0 && (
        <ChainSection title={t("chainAnalysis.inputProvenance", { defaultValue: "Input Provenance" })} findings={backward} t={t} />
      )}
      {forward.length > 0 && (
        <ChainSection title={t("chainAnalysis.outputDestinations", { defaultValue: "Output Destinations" })} findings={forward} t={t} />
      )}
      {structural.length > 0 && (
        <ChainSection title={t("chainAnalysis.structuralAnalysis", { defaultValue: "Structural Analysis" })} findings={structural} t={t} />
      )}
      {spending.length > 0 && (
        <ChainSection title={t("chainAnalysis.spendingPatterns", { defaultValue: "Spending Patterns" })} findings={spending} t={t} />
      )}
    </motion.div>
  );
}

function ChainSection({ title, findings, t }: { title: string; findings: Finding[]; t: (key: string, opts?: Record<string, unknown>) => string }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted uppercase tracking-wider">
        {title}
      </div>
      <div className="space-y-1.5">
        {findings.map((f, i) => (
          <div
            key={`${f.id}-${i}`}
            className={`rounded-lg border px-3 py-2 text-sm ${SEVERITY_BG[f.severity] ?? SEVERITY_BG.low}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className={`font-medium ${SEVERITY_TEXT[f.severity] ?? "text-foreground"}`}>
                {t(findingKey(f.id, "title", f.params), { ...f.params, defaultValue: f.title })}
              </span>
              {f.scoreImpact !== 0 && (
                <span className={`text-xs font-mono shrink-0 ${f.scoreImpact > 0 ? "text-severity-good" : "text-severity-critical"}`}>
                  {f.scoreImpact > 0 ? "+" : ""}{f.scoreImpact}
                </span>
              )}
            </div>
            {f.params?.hops !== undefined && (
              <div className="mt-1 text-xs text-muted">
                {t("chainAnalysis.hopsAway", { count: Number(f.params.hops), defaultValue: "{{count}} hop away" })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
