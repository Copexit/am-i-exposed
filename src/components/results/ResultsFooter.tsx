"use client";

import { ExternalLink } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { ScoringExplainer } from "./ScoringExplainer";
import { fadeUpVariants, fadeUpTransition } from "./animations";
import type { ScoringResult, TxAnalysisResult } from "@/lib/types";

export function ResultsFooter({
  inputType,
  result,
  txBreakdown,
  durationMs,
  explorerUrl,
  explorerLabel,
  mempoolBaseUrl,
}: {
  inputType: "txid" | "address";
  result: ScoringResult;
  txBreakdown: TxAnalysisResult[] | null;
  durationMs?: number | null;
  explorerUrl: string;
  explorerLabel: string;
  mempoolBaseUrl: string;
}) {
  const { t } = useTranslation();

  return (
    <motion.div {...fadeUpVariants} transition={fadeUpTransition(0.65)} className="w-full space-y-2 pb-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <ScoringExplainer isAddress={inputType === "address"} />
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-bitcoin hover:text-bitcoin-hover transition-colors"
        >
          {explorerLabel}
          <ExternalLink size={12} />
        </a>
      </div>

      <p className="text-xs text-muted/70 leading-relaxed">
        {t("results.disclaimerStats", {
          findingCount: result.findings.length,
          heuristicCount: inputType === "txid" ? "31" : "6",
          defaultValue: "{{findingCount}} findings from {{heuristicCount}} heuristics",
        })}
        {txBreakdown ? t("results.disclaimerTxAnalyzed", { count: txBreakdown.length, defaultValue: " + {{count}} transactions analyzed" }) : ""}
        {durationMs ? t("results.disclaimerDuration", { duration: (durationMs / 1000).toFixed(1), defaultValue: " in {{duration}}s" }) : ""}.
        {" "}{t("results.disclaimerBrowser", { defaultValue: "Analysis ran entirely in your browser." })}{" "}
        {t("results.disclaimerApi", {
          hostname: mempoolBaseUrl.startsWith("/")
            ? "local API"
            : mempoolBaseUrl.includes("mempool.space")
              ? "mempool.space"
              : (() => { try { return new URL(mempoolBaseUrl).hostname; } catch { return "custom API"; } })(),
          defaultValue: "API queries were sent to {{hostname}}.",
        })}{" "}
        {t("results.disclaimerHeuristic", { defaultValue: "Scores are heuristic-based estimates, not definitive privacy assessments." })}
      </p>
    </motion.div>
  );
}
