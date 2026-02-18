"use client";

import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ExternalLink, Copy, Check, Info, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { ScoreDisplay } from "./ScoreDisplay";
import { FindingCard } from "./FindingCard";
import { TxSummary } from "./TxSummary";
import { AddressSummary } from "./AddressSummary";
import { ExportButton } from "./ExportButton";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { Remediation } from "./Remediation";
import { CexRiskPanel } from "./CexRiskPanel";
import { TipJar } from "./TipJar";
import { CrossPromo } from "./CrossPromo";
import type { ScoringResult, InputType } from "@/lib/types";
import type { MempoolTransaction, MempoolAddress } from "@/lib/api/types";

function ScoringExplainer() {
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs text-muted/50 hover:text-muted transition-colors cursor-pointer px-1"
      >
        <Info size={12} />
        How scoring works
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
            <div className="mt-2 bg-surface-inset rounded-lg px-4 py-3 text-xs text-muted/70 leading-relaxed space-y-2">
              <p>
                Scores start at <strong className="text-foreground/70">70/100</strong> (baseline) and are adjusted by each heuristic finding.
                Negative findings (address reuse, change detection, round amounts) lower the score.
                Positive findings (CoinJoin, high entropy, anonymity sets) raise it.
              </p>
              <p>
                <strong className="text-severity-good">A+ (90+)</strong>{" "}
                <strong className="text-severity-low">B (75-89)</strong>{" "}
                <strong className="text-severity-medium">C (50-74)</strong>{" "}
                <strong className="text-severity-high">D (25-49)</strong>{" "}
                <strong className="text-severity-critical">F (&lt;25)</strong>
              </p>
              <p>
                The engine runs 17 heuristics based on published chain analysis research.
                Scores are clamped to 0-100. CoinJoin transactions receive adjusted
                scoring that accounts for their privacy-enhancing properties.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AddressTypeBadge({ address }: { address: string }) {
  let type: string;
  let color: string;

  if (address.startsWith("bc1p") || address.startsWith("tb1p")) {
    type = "Taproot";
    color = "bg-severity-good/20 text-severity-good border-severity-good/30";
  } else if (address.startsWith("bc1q") || address.startsWith("tb1q")) {
    type = "SegWit";
    color = "bg-severity-low/20 text-severity-low border-severity-low/30";
  } else if (address.startsWith("3") || address.startsWith("2")) {
    type = "P2SH";
    color = "bg-severity-medium/20 text-severity-medium border-severity-medium/30";
  } else if (address.startsWith("1") || address.startsWith("m") || address.startsWith("n")) {
    type = "Legacy";
    color = "bg-severity-high/20 text-severity-high border-severity-high/30";
  } else {
    return null;
  }

  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${color}`}>
      {type}
    </span>
  );
}

function FindingSummary({ findings }: { findings: ScoringResult["findings"] }) {
  const issues = findings.filter((f) => f.scoreImpact < 0).length;
  const good = findings.filter((f) => f.scoreImpact > 0 || f.severity === "good").length;

  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      {issues > 0 && (
        <span className="text-severity-high">{issues} issue{issues > 1 ? "s" : ""}</span>
      )}
      {good > 0 && (
        <span className="text-severity-good">{good} positive</span>
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
  onBack,
  onScan,
  durationMs,
}: ResultsPanelProps) {
  const { config } = useNetwork();
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "failed">("idle");

  const explorerUrl = `${config.explorerUrl}/${inputType === "txid" ? "tx" : "address"}/${query}`;

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
      className="flex flex-col items-center gap-6 w-full max-w-2xl"
    >
      {/* Top bar */}
      <div className="w-full flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} />
          New scan
        </button>

        <div className="flex items-center gap-4">
          <ExportButton targetId="results-panel" query={query} result={result} />
          <button
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            {shareStatus === "copied" ? <Check size={14} /> : <Copy size={14} />}
            {shareStatus === "copied" ? "Copied" : shareStatus === "failed" ? "Failed" : "Share"}
          </button>
        </div>
      </div>

      {/* Query + Score */}
      <div className="w-full bg-card-bg border border-card-border rounded-xl p-6 space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted uppercase tracking-wider">
              {inputType === "txid" ? "Transaction" : "Address"}
            </span>
            {inputType === "address" && (
              <AddressTypeBadge address={query} />
            )}
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(query).catch(() => {})}
            className="font-mono text-sm text-foreground/80 break-all leading-relaxed text-left hover:text-foreground transition-colors cursor-pointer"
            title="Click to copy"
          >
            {query}
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
              High exposure risk
            </p>
            <p className="text-xs text-foreground/60 mt-1 leading-relaxed">
              This {inputType === "txid" ? "transaction" : "address"} has severe privacy issues.
              On-chain surveillance can likely identify the owner and trace fund flows.
              Immediate remediation steps are recommended below.
            </p>
          </div>
        </motion.div>
      )}

      {/* Data visualization */}
      {txData && <TxSummary tx={txData} onAddressClick={onScan} />}
      {addressData && <AddressSummary address={addressData} />}

      {/* Findings */}
      {result.findings.length > 0 && (
        <div className="w-full space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-medium text-muted uppercase tracking-wider">
              Findings ({result.findings.length})
            </h2>
            <FindingSummary findings={result.findings} />
          </div>
          <div className="space-y-2">
            {result.findings.map((finding, i) => (
              <FindingCard key={finding.id} finding={finding} index={i} />
            ))}
          </div>
        </div>
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
          View on mempool.space
          <ExternalLink size={13} />
        </a>
      </div>

      {/* Disclaimer */}
      <div className="w-full bg-surface-inset rounded-lg px-4 py-3 text-xs text-muted/50 leading-relaxed">
        {result.findings.length} findings from {inputType === "txid" ? "13" : "4"} heuristics
        {durationMs ? ` in ${(durationMs / 1000).toFixed(1)}s` : ""}.
        Analysis ran entirely in your browser. API queries were sent to{" "}
        {config.mempoolBaseUrl.includes("mempool.space")
          ? "mempool.space"
          : new URL(config.mempoolBaseUrl).hostname}.
        Scores are heuristic-based estimates, not definitive privacy assessments.
      </div>

      <div className="text-xs text-muted/30 pb-4">
        Press <kbd className="px-1.5 py-0.5 rounded bg-surface-elevated border border-card-border text-muted/50 font-mono">Esc</kbd> for new scan
      </div>
    </motion.div>
  );
}
