"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import type { Finding } from "@/lib/types";

interface ChainAnalysisPanelProps {
  findings: Finding[];
}

/** Chain analysis finding IDs that this panel highlights */
const CHAIN_FINDING_IDS = new Set([
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

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-400",
  high: "text-orange-400",
  medium: "text-amber-400",
  low: "text-blue-400",
  good: "text-green-400",
};

const SEVERITY_BG: Record<string, string> = {
  critical: "bg-red-500/10 border-red-500/20",
  high: "bg-orange-500/10 border-orange-500/20",
  medium: "bg-amber-500/10 border-amber-500/20",
  low: "bg-blue-500/10 border-blue-500/20",
  good: "bg-green-500/10 border-green-500/20",
};

export function ChainAnalysisPanel({ findings }: ChainAnalysisPanelProps) {
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
        Chain Analysis
      </div>

      {backward.length > 0 && (
        <ChainSection title="Input Provenance" findings={backward} />
      )}
      {forward.length > 0 && (
        <ChainSection title="Output Destinations" findings={forward} />
      )}
      {structural.length > 0 && (
        <ChainSection title="Structural Analysis" findings={structural} />
      )}
      {spending.length > 0 && (
        <ChainSection title="Spending Patterns" findings={spending} />
      )}
    </motion.div>
  );
}

function ChainSection({ title, findings }: { title: string; findings: Finding[] }) {
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
              <span className={`font-medium ${SEVERITY_COLORS[f.severity] ?? "text-white/80"}`}>
                {f.title}
              </span>
              {f.scoreImpact !== 0 && (
                <span className={`text-xs font-mono shrink-0 ${f.scoreImpact > 0 ? "text-green-400" : "text-red-400"}`}>
                  {f.scoreImpact > 0 ? "+" : ""}{f.scoreImpact}
                </span>
              )}
            </div>
            {f.params?.hops !== undefined && (
              <div className="mt-1 text-xs text-white/50">
                {f.params.hops} hop{Number(f.params.hops) !== 1 ? "s" : ""} away
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
