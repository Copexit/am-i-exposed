"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { Finding } from "@/lib/types";
import { SEVERITY_TEXT, SEVERITY_BG } from "@/lib/severity";

/** Build i18n key for a finding field, appending _variant if present in params. */
function findingKey(id: string, field: string, params?: Record<string, unknown>): string {
  const variant = params?._variant;
  return variant ? `finding.${id}.${field}.${variant}` : `finding.${id}.${field}`;
}

interface ChainAnalysisPanelProps {
  findings: Finding[];
}

/** Chain analysis finding IDs that this panel highlights */
export const CHAIN_FINDING_IDS = new Set([
  // Backward (input provenance)
  "chain-coinjoin-input",
  "chain-exchange-input",
  "chain-dust-input",
  // Forward (output destinations)
  "chain-post-coinjoin-consolidation",
  "chain-forward-peel",
  "chain-toxic-merge",
  "chain-post-coinjoin-direct-spend",
  // CoinJoin quality
  "chain-coinjoin-quality",
  // Entity proximity
  "chain-entity-proximity-backward",
  "chain-entity-proximity-forward",
  "chain-coinjoin-ancestry",
  "chain-coinjoin-descendancy",
  // Taint
  "chain-taint-backward",
  // Clustering
  "chain-cluster-size",
  // Linkability
  "linkability-deterministic",
  "linkability-ambiguous",
  "linkability-equal-subset",
  // Spending patterns
  "chain-near-exact-spend",
  "chain-ricochet",
  "chain-sweep-chain",
  "chain-post-cj-partial-spend",
  "chain-kyc-consolidation-before-cj",
  // JoinMarket
  "joinmarket-subset-sum",
  "joinmarket-subset-sum-resistant",
  "joinmarket-taker-maker",
  "joinmarket-multi-round",
  // Peel chain trace
  "peel-chain-trace",
  "peel-chain-trace-short",
]);


export function ChainAnalysisPanel({ findings }: ChainAnalysisPanelProps) {
  const { t } = useTranslation();
  const chainFindings = useMemo(
    () => findings.filter((f) => CHAIN_FINDING_IDS.has(f.id)),
    [findings],
  );

  if (chainFindings.length === 0) return null;

  const backward = chainFindings.filter((f) =>
    f.id.includes("backward") || f.id.includes("coinjoin-input") ||
    f.id.includes("exchange-input") || f.id.includes("dust-input") ||
    f.id.includes("ancestry") || f.id.includes("taint"),
  );
  const forward = chainFindings.filter((f) =>
    f.id.includes("forward") || f.id.includes("consolidation") ||
    f.id.includes("toxic-merge") || f.id.includes("direct-spend") ||
    f.id.includes("descendancy") || f.id.includes("peel-chain"),
  );
  const structural = chainFindings.filter((f) =>
    f.id.includes("linkability") || f.id.includes("cluster") ||
    f.id.includes("quality") || f.id.includes("joinmarket"),
  );
  const spending = chainFindings.filter((f) =>
    f.id.includes("near-exact") || f.id.includes("ricochet") ||
    f.id.includes("sweep-chain") || f.id.includes("post-cj-partial") ||
    f.id.includes("kyc-consolidation"),
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="rounded-xl border border-white/5 bg-surface-inset p-4 space-y-4"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-white/70">
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
      <div className="text-xs font-medium text-white/40 uppercase tracking-wider">
        {title}
      </div>
      <div className="space-y-1.5">
        {findings.map((f, i) => (
          <div
            key={`${f.id}-${i}`}
            className={`rounded-lg border px-3 py-2 text-sm ${SEVERITY_BG[f.severity] ?? SEVERITY_BG.low}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className={`font-medium ${SEVERITY_TEXT[f.severity] ?? "text-white/80"}`}>
                {t(findingKey(f.id, "title", f.params), { ...f.params, defaultValue: f.title })}
              </span>
              {f.scoreImpact !== 0 && (
                <span className={`text-xs font-mono shrink-0 ${f.scoreImpact > 0 ? "text-green-400" : "text-red-400"}`}>
                  {f.scoreImpact > 0 ? "+" : ""}{f.scoreImpact}
                </span>
              )}
            </div>
            {f.params?.hops !== undefined && (
              <div className="mt-1 text-xs text-white/50">
                {t("chainAnalysis.hopsAway", { count: Number(f.params.hops), defaultValue: "{{count}} hop away" })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
