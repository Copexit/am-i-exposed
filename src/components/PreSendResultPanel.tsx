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
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { FindingCard } from "./FindingCard";
import { AddressSummary } from "./AddressSummary";
import { copyToClipboard } from "@/lib/clipboard";
import { formatSats } from "@/lib/format";
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
    labelKey: "presend.riskLow",
    labelDefault: "Low Risk",
    adviceKey: "presend.adviceLow",
    adviceDefault: "This destination looks safe to send to.",
  },
  MEDIUM: {
    icon: ShieldAlert,
    color: "text-severity-medium",
    bg: "bg-severity-medium/10 border-severity-medium/30",
    labelKey: "presend.riskMedium",
    labelDefault: "Medium Risk",
    adviceKey: "presend.adviceMedium",
    adviceDefault: "Consider asking the recipient for a fresh address.",
  },
  HIGH: {
    icon: ShieldAlert,
    color: "text-severity-high",
    bg: "bg-severity-high/10 border-severity-high/30",
    labelKey: "presend.riskHigh",
    labelDefault: "High Risk",
    adviceKey: "presend.adviceHigh",
    adviceDefault: "Ask the recipient for a fresh, unused address before sending.",
  },
  CRITICAL: {
    icon: ShieldX,
    color: "text-severity-critical",
    bg: "bg-severity-critical/10 border-severity-critical/30",
    labelKey: "presend.riskCritical",
    labelDefault: "Critical Risk",
    adviceKey: "presend.adviceCritical",
    adviceDefault: "Do NOT send to this address. It poses severe privacy or legal risks.",
  },
} as const;


export function PreSendResultPanel({
  query,
  preSendResult,
  addressData,
  onBack,
  durationMs,
}: PreSendResultPanelProps) {
  const { config, customApiUrl, localApiStatus } = useNetwork();
  const { t, i18n } = useTranslation();
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");
  const risk = RISK_CONFIG[preSendResult.riskLevel];
  const RiskIcon = risk.icon;
  const explorerLabel = customApiUrl
    ? t("presend.viewOnCustom", { hostname: new URL(config.explorerUrl).hostname, defaultValue: "View on {{hostname}}" })
    : localApiStatus === "available"
      ? t("presend.viewOnLocal", { defaultValue: "View on local mempool" })
      : t("presend.viewOnMempool", { defaultValue: "View on mempool.space" });

  const handleCopy = async () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#check=${encodeURIComponent(query)}`;
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col items-center gap-8 w-full max-w-3xl"
    >
      {/* Top bar */}
      <div className="w-full flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer py-2 min-h-[44px]"
        >
          <ArrowLeft size={16} />
          {t("presend.newCheck", { defaultValue: "New check" })}
        </button>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer py-2 min-h-[44px]"
        >
          {shareStatus === "copied" ? <Check size={14} /> : <Copy size={14} />}
          {shareStatus === "copied" ? t("presend.copied", { defaultValue: "Copied" }) : t("presend.share", { defaultValue: "Share" })}
        </button>
      </div>

      {/* Destination + Risk Level */}
      <div className="w-full bg-card-bg border border-card-border rounded-xl p-7 space-y-6">
        <div className="space-y-1">
          <span className="text-sm font-medium text-muted uppercase tracking-wider">
            {t("presend.destinationCheck", { defaultValue: "Pre-Send Destination Check" })}
          </span>
          <p className="font-mono text-sm text-foreground/90 break-all leading-relaxed">
            {query}
          </p>
        </div>

        {/* Big risk badge */}
        <div className={`rounded-xl border p-6 ${risk.bg} flex flex-col items-center gap-3`}>
          <RiskIcon size={40} className={risk.color} />
          <span className={`text-2xl font-bold ${risk.color}`}>
            {t(risk.labelKey, { defaultValue: risk.labelDefault })}
          </span>
          <p className="text-sm text-center text-foreground max-w-md">
            {preSendResult.summary}
          </p>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-lg font-semibold text-foreground">
              {preSendResult.txCount.toLocaleString(i18n.language)}
            </p>
            <p className="text-sm text-muted">{t("presend.transactions", { defaultValue: "Transactions" })}</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">
              {preSendResult.timesReceived.toLocaleString(i18n.language)}
            </p>
            <p className="text-sm text-muted">{t("presend.timesReceived", { defaultValue: "Times received" })}</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground truncate">
              {formatSats(preSendResult.totalReceived, i18n.language)}
            </p>
            <p className="text-sm text-muted">{t("presend.totalReceived", { defaultValue: "Total received" })}</p>
          </div>
        </div>
      </div>

      {/* Advice box */}
      <div className={`w-full rounded-xl border p-4 flex items-start gap-3 ${risk.bg}`}>
        <AlertTriangle size={18} className={`${risk.color} shrink-0 mt-0.5`} />
        <div>
          <p className={`text-sm font-medium ${risk.color}`}>
            {t(risk.adviceKey, { defaultValue: risk.adviceDefault })}
          </p>
          {preSendResult.riskLevel !== "LOW" && (
            <p className="text-sm text-foreground mt-1 leading-relaxed">
              {t("presend.reusedAddressWarning", { defaultValue: "Sending to a reused address links your transaction to all other transactions involving this address. Chain analysis can trivially trace your payment." })}
            </p>
          )}
        </div>
      </div>

      {/* Address data if available */}
      {addressData && <AddressSummary address={addressData} />}

      {/* Findings */}
      {preSendResult.findings.length > 0 && (
        <div className="w-full space-y-3">
          <h2 className="text-base font-medium text-muted uppercase tracking-wider px-1">
            {t("presend.findingsHeading", { count: preSendResult.findings.length, defaultValue: "Findings ({{count}})" })}
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
          href={`${config.explorerUrl}/address/${encodeURIComponent(query)}`}
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
        {t("presend.disclaimerCompleted", { defaultValue: "Pre-send check completed" })}{durationMs ? t("presend.disclaimerDuration", { duration: (durationMs / 1000).toFixed(1), defaultValue: " in {{duration}}s" }) : ""}.
        {" "}{t("presend.disclaimerBrowser", { defaultValue: "Analysis ran entirely in your browser. This is a heuristic-based assessment - always verify independently." })}
      </div>
    </motion.div>
  );
}
