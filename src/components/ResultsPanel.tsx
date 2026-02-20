"use client";

import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ExternalLink, Copy, Check, Info, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { ScoreDisplay } from "./ScoreDisplay";
import { FindingCard } from "./FindingCard";
import { TxSummary } from "./TxSummary";
import { AddressSummary } from "./AddressSummary";
import { ExportButton } from "./ExportButton";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { Remediation } from "./Remediation";
import { CexRiskPanel } from "./CexRiskPanel";
import { TxBreakdownPanel } from "./TxBreakdownPanel";
import { ClusterPanel } from "./ClusterPanel";
import { TipJar } from "./TipJar";
import { CrossPromo } from "./CrossPromo";
import type { ScoringResult, InputType, TxAnalysisResult } from "@/lib/types";
import type { MempoolTransaction, MempoolAddress } from "@/lib/api/types";

function ScoringExplainer() {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs text-foreground hover:text-foreground transition-colors cursor-pointer px-1 min-h-[44px]"
      >
        <Info size={12} />
        {t("results.howScoringWorks", { defaultValue: "How scoring works" })}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 bg-surface-inset rounded-lg px-4 py-3 text-sm text-muted leading-relaxed space-y-2">
              <p>
                {t("results.scoringExplainerP1", { defaultValue: "Scores start at " })}<strong className="text-foreground">70/100</strong>{t("results.scoringExplainerP1b", { defaultValue: " (baseline) and are adjusted by each heuristic finding. Negative findings (address reuse, change detection, round amounts) lower the score. Positive findings (CoinJoin, high entropy, anonymity sets) raise it." })}
              </p>
              <p>
                <strong className="text-severity-good">A+ (90+)</strong>{" "}
                <strong className="text-severity-low">B (75-89)</strong>{" "}
                <strong className="text-severity-medium">C (50-74)</strong>{" "}
                <strong className="text-severity-high">D (25-49)</strong>{" "}
                <strong className="text-severity-critical">F (&lt;25)</strong>
              </p>
              <p>
                {t("results.scoringExplainerP3", { defaultValue: "The engine runs 16 heuristics based on published chain analysis research. Scores are clamped to 0-100. CoinJoin transactions receive adjusted scoring that accounts for their privacy-enhancing properties." })}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AddressTypeBadge({ address }: { address: string }) {
  const { t } = useTranslation();
  let typeKey: string;
  let color: string;

  if (address.startsWith("bc1p") || address.startsWith("tb1p")) {
    typeKey = "Taproot";
    color = "bg-severity-good/20 text-severity-good border-severity-good/30";
  } else if (address.startsWith("bc1q") || address.startsWith("tb1q")) {
    typeKey = "SegWit";
    color = "bg-severity-low/20 text-severity-low border-severity-low/30";
  } else if (address.startsWith("3") || address.startsWith("2")) {
    typeKey = "P2SH";
    color = "bg-severity-medium/20 text-severity-medium border-severity-medium/30";
  } else if (address.startsWith("1") || address.startsWith("m") || address.startsWith("n")) {
    typeKey = "Legacy";
    color = "bg-severity-high/20 text-severity-high border-severity-high/30";
  } else {
    return null;
  }

  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${color}`}>
      {t(`results.addressType.${typeKey}`, { defaultValue: typeKey })}
    </span>
  );
}

function FindingSummary({ findings }: { findings: ScoringResult["findings"] }) {
  const { t } = useTranslation();
  const issues = findings.filter((f) => f.scoreImpact < 0).length;
  const good = findings.filter((f) => f.scoreImpact > 0 || f.severity === "good").length;

  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      {issues > 0 && (
        <span className="text-severity-high">{t("results.issueCount", { count: issues, defaultValue: "{{count}} issue", defaultValue_plural: "{{count}} issues" })}</span>
      )}
      {good > 0 && (
        <span className="text-severity-good">{t("results.positiveCount", { count: good, defaultValue: "{{count}} positive" })}</span>
      )}
    </div>
  );
}

interface ResultsPanelProps {
  query: string;
  inputType: InputType;
  result: ScoringResult;
  txData: MempoolTransaction | null;
  addressData: MempoolAddress | null;
  addressTxs: MempoolTransaction[] | null;
  txBreakdown: TxAnalysisResult[] | null;
  onBack: () => void;
  onScan?: (input: string) => void;
  durationMs?: number | null;
}

export function ResultsPanel({
  query,
  inputType,
  result,
  txData,
  addressData,
  addressTxs,
  txBreakdown,
  onBack,
  onScan,
  durationMs,
}: ResultsPanelProps) {
  const { config, customApiUrl } = useNetwork();
  const { t } = useTranslation();
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "failed">("idle");

  const explorerUrl = `${config.explorerUrl}/${inputType === "txid" ? "tx" : "address"}/${query}`;
  const explorerLabel = customApiUrl
    ? t("results.viewOnCustom", { hostname: new URL(config.explorerUrl).hostname, defaultValue: "View on {{hostname}}" })
    : t("results.viewOnMempool", { defaultValue: "View on mempool.space" });

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#${inputType === "txid" ? "tx" : "addr"}=${query}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch {
      setShareStatus("failed");
      setTimeout(() => setShareStatus("idle"), 2000);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      id="results-panel"
      className="flex flex-col items-center gap-8 w-full max-w-3xl"
    >
      {/* Top bar */}
      <div className="w-full flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer py-2 min-h-[44px]"
        >
          <ArrowLeft size={16} />
          {t("results.newScan", { defaultValue: "New scan" })}
        </button>

        <div className="flex items-center gap-4">
          <ExportButton targetId="results-panel" query={query} result={result} inputType={inputType} />
          <button
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer py-2 min-h-[44px]"
          >
            {shareStatus === "copied" ? <Check size={14} /> : <Copy size={14} />}
            {shareStatus === "copied" ? t("results.copied", { defaultValue: "Copied" }) : shareStatus === "failed" ? t("results.failed", { defaultValue: "Failed" }) : t("results.share", { defaultValue: "Share" })}
          </button>
        </div>
      </div>

      {/* Query + Score */}
      <div className="w-full bg-card-bg border border-card-border rounded-xl p-7 space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted uppercase tracking-wider">
              {inputType === "txid" ? t("results.transaction", { defaultValue: "Transaction" }) : t("results.address", { defaultValue: "Address" })}
            </span>
            {inputType === "address" && (
              <AddressTypeBadge address={query} />
            )}
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(query).catch(() => {})}
            className="inline-flex items-start gap-2 font-mono text-sm text-foreground/90 break-all leading-relaxed text-left hover:text-foreground transition-colors cursor-pointer group/copy"
            title="Click to copy"
          >
            <span className="break-all">{query}</span>
            <Copy size={14} className="shrink-0 mt-1 text-muted opacity-0 group-hover/copy:opacity-100 transition-opacity" />
          </button>
        </div>

        <div className="border-t border-card-border pt-6">
          <ScoreDisplay score={result.score} grade={result.grade} />
        </div>
      </div>

      {/* Danger zone warning for F grade */}
      {result.grade === "F" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1.5, duration: 0.3 }}
          className="w-full bg-severity-critical/10 border border-severity-critical/30 rounded-xl p-4 flex items-start gap-3"
        >
          <AlertTriangle size={18} className="text-severity-critical shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-severity-critical">
              {t("results.highExposureRisk", { defaultValue: "High exposure risk" })}
            </p>
            <p className="text-xs text-foreground mt-1 leading-relaxed">
              {inputType === "txid"
                ? t("results.fGradeWarningTx", { defaultValue: "This transaction has severe privacy issues. On-chain surveillance can likely identify the owner and trace fund flows. Immediate remediation steps are recommended below." })
                : t("results.fGradeWarningAddr", { defaultValue: "This address has severe privacy issues. On-chain surveillance can likely identify the owner and trace fund flows. Immediate remediation steps are recommended below." })}
            </p>
          </div>
        </motion.div>
      )}

      {/* Data visualization */}
      {txData && <TxSummary tx={txData} onAddressClick={onScan} />}
      {addressData && <AddressSummary address={addressData} />}

      {/* Per-transaction breakdown (address analysis only) */}
      {txBreakdown && txBreakdown.length > 0 && addressData && (
        <TxBreakdownPanel
          breakdown={txBreakdown}
          targetAddress={query}
          totalTxCount={addressData.chain_stats.tx_count + addressData.mempool_stats.tx_count}
          onScan={onScan}
        />
      )}

      {/* Findings */}
      {result.findings.length > 0 && (
        <div className="w-full space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-base font-medium text-muted uppercase tracking-wider">
              {t("results.findingsHeading", { count: result.findings.length, defaultValue: "Findings ({{count}})" })}
            </h2>
            <FindingSummary findings={result.findings} />
          </div>
          <div className="space-y-3">
            {result.findings.map((finding, i) => (
              <FindingCard key={finding.id} finding={finding} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Cluster Analysis (address only, opt-in) */}
      {inputType === "address" && addressTxs && addressTxs.length > 0 && (
        <ClusterPanel
          targetAddress={query}
          txs={addressTxs}
          onAddressClick={onScan}
        />
      )}

      {/* Remediation */}
      <Remediation findings={result.findings} grade={result.grade} />

      {/* Exchange Risk Check */}
      <CexRiskPanel query={query} inputType={inputType} txData={txData} />

      {/* Score breakdown & how scoring works */}
      <ScoreBreakdown findings={result.findings} finalScore={result.score} />
      <ScoringExplainer />

      {/* TipJar + CrossPromo */}
      <TipJar />
      {inputType === "txid" && <CrossPromo />}

      {/* Footer */}
      <div className="w-full flex flex-wrap items-center justify-center gap-4 pt-2 pb-4 text-sm">
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-bitcoin hover:text-bitcoin-hover transition-colors"
        >
          {explorerLabel}
          <ExternalLink size={13} />
        </a>
      </div>

      {/* Disclaimer */}
      <div className="w-full bg-surface-inset rounded-lg px-4 py-3 text-sm text-muted leading-relaxed">
        {t("results.disclaimerStats", {
          findingCount: result.findings.length,
          heuristicCount: inputType === "txid" ? "12" : "4",
          defaultValue: "{{findingCount}} findings from {{heuristicCount}} heuristics",
        })}
        {txBreakdown ? t("results.disclaimerTxAnalyzed", { count: txBreakdown.length, defaultValue: " + {{count}} transactions analyzed" }) : ""}
        {durationMs ? t("results.disclaimerDuration", { duration: (durationMs / 1000).toFixed(1), defaultValue: " in {{duration}}s" }) : ""}.
        {" "}{t("results.disclaimerBrowser", { defaultValue: "Analysis ran entirely in your browser." })}{" "}
        {t("results.disclaimerApi", {
          hostname: config.mempoolBaseUrl.startsWith("/")
            ? "local API"
            : config.mempoolBaseUrl.includes("mempool.space")
              ? "mempool.space"
              : new URL(config.mempoolBaseUrl).hostname,
          defaultValue: "API queries were sent to {{hostname}}.",
        })}{" "}
        {t("results.disclaimerHeuristic", { defaultValue: "Scores are heuristic-based estimates, not definitive privacy assessments." })}
      </div>

      <div className="text-xs text-muted pb-4 hidden sm:block">
        {t("results.pressEsc", { defaultValue: "Press" })} <kbd className="px-1.5 py-0.5 rounded bg-surface-elevated border border-card-border text-muted font-mono">Esc</kbd> {t("results.forNewScan", { defaultValue: "for new scan" })}
      </div>
    </motion.div>
  );
}
