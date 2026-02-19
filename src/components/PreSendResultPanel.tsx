"use client";

import { motion } from "motion/react";
import {
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  AlertTriangle,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { useState } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { FindingCard } from "./FindingCard";
import { AddressSummary } from "./AddressSummary";
import type { PreSendResult } from "@/lib/analysis/orchestrator";
import type { MempoolAddress } from "@/lib/api/types";

interface PreSendResultPanelProps {
  query: string;
  preSendResult: PreSendResult;
  addressData: MempoolAddress | null;
  onBack: () => void;
  durationMs?: number | null;
}

const RISK_CONFIG = {
  LOW: {
    icon: ShieldCheck,
    color: "text-severity-good",
    bg: "bg-severity-good/10 border-severity-good/30",
    label: "Low Risk",
    advice: "This destination looks safe to send to.",
  },
  MEDIUM: {
    icon: ShieldAlert,
    color: "text-severity-medium",
    bg: "bg-severity-medium/10 border-severity-medium/30",
    label: "Medium Risk",
    advice: "Consider asking the recipient for a fresh address.",
  },
  HIGH: {
    icon: ShieldAlert,
    color: "text-severity-high",
    bg: "bg-severity-high/10 border-severity-high/30",
    label: "High Risk",
    advice: "Ask the recipient for a fresh, unused address before sending.",
  },
  CRITICAL: {
    icon: ShieldX,
    color: "text-severity-critical",
    bg: "bg-severity-critical/10 border-severity-critical/30",
    label: "Critical Risk",
    advice: "Do NOT send to this address. It poses severe privacy or legal risks.",
  },
} as const;

function formatBtc(sats: number): string {
  return `${(sats / 100_000_000).toFixed(8)} BTC`;
}

export function PreSendResultPanel({
  query,
  preSendResult,
  addressData,
  onBack,
  durationMs,
}: PreSendResultPanelProps) {
  const { config, customApiUrl } = useNetwork();
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");
  const risk = RISK_CONFIG[preSendResult.riskLevel];
  const RiskIcon = risk.icon;
  const explorerLabel = customApiUrl
    ? `View on ${new URL(config.explorerUrl).hostname}`
    : "View on mempool.space";

  const handleCopy = async () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#check=${query}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch { /* noop */ }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col items-center gap-6 w-full max-w-2xl"
    >
      {/* Top bar */}
      <div className="w-full flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer py-2 min-h-[44px]"
        >
          <ArrowLeft size={16} />
          New check
        </button>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer py-2 min-h-[44px]"
        >
          {shareStatus === "copied" ? <Check size={14} /> : <Copy size={14} />}
          {shareStatus === "copied" ? "Copied" : "Share"}
        </button>
      </div>

      {/* Destination + Risk Level */}
      <div className="w-full bg-card-bg border border-card-border rounded-xl p-6 space-y-6">
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted uppercase tracking-wider">
            Pre-Send Destination Check
          </span>
          <p className="font-mono text-sm text-foreground/80 break-all leading-relaxed">
            {query}
          </p>
        </div>

        {/* Big risk badge */}
        <div className={`rounded-xl border p-6 ${risk.bg} flex flex-col items-center gap-3`}>
          <RiskIcon size={40} className={risk.color} />
          <span className={`text-2xl font-bold ${risk.color}`}>
            {risk.label}
          </span>
          <p className="text-sm text-center text-foreground/70 max-w-md">
            {preSendResult.summary}
          </p>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-lg font-semibold text-foreground">
              {preSendResult.txCount}
            </p>
            <p className="text-xs text-muted">Transactions</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">
              {preSendResult.timesReceived}
            </p>
            <p className="text-xs text-muted">Times received</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground truncate">
              {formatBtc(preSendResult.totalReceived)}
            </p>
            <p className="text-xs text-muted">Total received</p>
          </div>
        </div>
      </div>

      {/* Advice box */}
      <div className={`w-full rounded-xl border p-4 flex items-start gap-3 ${risk.bg}`}>
        <AlertTriangle size={18} className={`${risk.color} shrink-0 mt-0.5`} />
        <div>
          <p className={`text-sm font-medium ${risk.color}`}>
            {risk.advice}
          </p>
          {preSendResult.riskLevel !== "LOW" && (
            <p className="text-xs text-foreground/60 mt-1 leading-relaxed">
              Sending to a reused address links your transaction to all other transactions
              involving this address. Chain analysis can trivially trace your payment.
            </p>
          )}
        </div>
      </div>

      {/* Address data if available */}
      {addressData && <AddressSummary address={addressData} />}

      {/* Findings */}
      {preSendResult.findings.length > 0 && (
        <div className="w-full space-y-3">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider px-1">
            Findings ({preSendResult.findings.length})
          </h2>
          <div className="space-y-2">
            {preSendResult.findings.map((finding, i) => (
              <FindingCard key={finding.id} finding={finding} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Footer links */}
      <div className="w-full flex flex-wrap items-center justify-center gap-4 pt-2 pb-4 text-sm">
        <a
          href={`${config.explorerUrl}/address/${query}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-bitcoin hover:text-bitcoin-hover transition-colors"
        >
          {explorerLabel}
          <ExternalLink size={13} />
        </a>
      </div>

      {/* Disclaimer */}
      <div className="w-full bg-surface-inset rounded-lg px-4 py-3 text-xs text-muted/70 leading-relaxed">
        Pre-send check completed{durationMs ? ` in ${(durationMs / 1000).toFixed(1)}s` : ""}.
        Analysis ran entirely in your browser. This is a heuristic-based assessment - always verify independently.
      </div>
    </motion.div>
  );
}
