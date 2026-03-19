"use client";

import { useState, memo } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ChevronDown, BookOpen, ExternalLink, Copy, Check } from "lucide-react";
import type { Finding, Severity, ConfidenceLevel } from "@/lib/types";
import { WalletIcon } from "@/components/ui/WalletIcon";
import { Tooltip } from "@/components/ui/Tooltip";
import { truncateId } from "@/lib/constants";
import { formatSats, fmtN } from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";
import { findingKey } from "@/lib/finding-utils";

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
  /** Optional badge label (e.g., "Chain") shown next to severity. */
  badge?: string;
  /** Callback when user clicks a txid link (e.g., to analyze a child tx). */
  onTxClick?: (txid: string) => void;
  /** Pro mode: show confidence badges and score impact details. */
  proMode?: boolean;
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
    glow: "shadow-[inset_4px_0_12px_-4px_rgba(239,68,68,0.25)]",
  },
  high: {
    dot: "bg-severity-high",
    label: "High",
    text: "text-severity-high",
    border: "border-l-severity-high",
    glow: "shadow-[inset_4px_0_12px_-4px_rgba(249,115,22,0.2)]",
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

const CONFIDENCE_STYLES: Record<ConfidenceLevel, { label: string; className: string; tooltip: string }> = {
  deterministic: { label: "Definite", className: "bg-severity-critical/25 text-severity-critical border-severity-critical", tooltip: "This finding is mathematically certain - no ambiguity" },
  high: { label: "Likely", className: "bg-severity-high/20 text-severity-high border-severity-high", tooltip: "Strong evidence supports this finding, but not absolute certainty" },
  medium: { label: "Possible", className: "bg-severity-medium/20 text-severity-medium border-severity-medium", tooltip: "Moderate evidence - this pattern is suggestive but could have other explanations" },
  low: { label: "Hint", className: "bg-severity-low/20 text-severity-low border-severity-low", tooltip: "Weak signal - may indicate a pattern but could easily be coincidence" },
};

const SEVERITY_TOOLTIPS: Record<Severity, string> = {
  critical: "Severe privacy failure - immediate action recommended",
  high: "Significant privacy concern - should be addressed",
  medium: "Notable privacy issue - worth improving",
  low: "Minor privacy signal - low risk but worth noting",
  good: "Positive privacy property - helps protect your privacy",
};

export const FindingCard = memo(function FindingCard({ finding, index, defaultExpanded = false, badge, onTxClick, proMode = false }: FindingCardProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const reducedMotion = useReducedMotion();
  const style = SEVERITY_STYLES[finding.severity];
  const severityLabel = t(`common.severity.${finding.severity}`, { defaultValue: style.label });
  const confidence = finding.confidence;
  const confidenceStyle = confidence ? CONFIDENCE_STYLES[confidence] : null;

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.05, duration: 0.25 }}
      className={`glass rounded-lg border-l-2 ${style.border} ${style.glow ?? ""}`}
      data-finding-id={finding.id}
      role="article"
      aria-label={`${severityLabel} finding: ${t(findingKey(finding.id, "title", finding.params), { ...finding.params, defaultValue: finding.title })}`}
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
          {t(findingKey(finding.id, "title", finding.params), { ...finding.params, defaultValue: finding.title })}
        </span>
        {proMode && confidenceStyle && (
          <Tooltip content={t(`common.confidenceTooltip.${confidence}`, { defaultValue: confidenceStyle.tooltip })}>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${confidenceStyle.className}`}>
              {t(`common.confidence.${confidence}`, { defaultValue: confidenceStyle.label })}
            </span>
          </Tooltip>
        )}
        {badge && (
          <Tooltip content={t("results.chainBadgeTooltip", { defaultValue: "Based on backward and forward analysis of the inputs and outputs to this transaction" })}>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-card-border bg-surface-inset text-muted">
              {badge}
            </span>
          </Tooltip>
        )}
        <Tooltip content={t(`common.severityTooltip.${finding.severity}`, { defaultValue: SEVERITY_TOOLTIPS[finding.severity] })}>
          <span className={`text-xs font-medium ${style.text}`}>
            {severityLabel}
          </span>
        </Tooltip>
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
                {t(findingKey(finding.id, "description", finding.params), { ...finding.params, defaultValue: finding.description })}
              </p>
              {finding.recommendation && (
                <div className="bg-surface-inset rounded-md px-3 py-2">
                  <p className="text-xs font-medium text-muted mb-1">
                    {t("finding.recommendationLabel", { defaultValue: "Recommendation" })}
                  </p>
                  <p className="text-base text-foreground/90 leading-relaxed">
                    {t(findingKey(finding.id, "recommendation", finding.params), { ...finding.params, defaultValue: finding.recommendation })}
                  </p>
                </div>
              )}
              {/* Ricochet hop table */}
              {finding.id === "ricochet-hop0" && finding.params?.hops && (
                <RicochetHopTable
                  hopsJson={String(finding.params.hops)}
                  variant={String(finding.params.variant ?? "classic")}
                  hopCount={Number(finding.params.hopCount ?? 0)}
                  lang={i18n.language}
                  onTxClick={onTxClick}
                />
              )}
              {/* Consolidation group table for chain-post-coinjoin-consolidation */}
              {finding.id === "chain-post-coinjoin-consolidation" && finding.params?._consolidationGroups && (
                <ConsolidationTable
                  groupsJson={String(finding.params._consolidationGroups)}
                  lang={i18n.language}
                  onTxClick={onTxClick}
                />
              )}
              <div className="flex items-center justify-between">
                {FINDING_LEARN_MORE[finding.id] && (
                  <a
                    href={`/faq/#${FINDING_LEARN_MORE[finding.id].faqId}`}
                    className="inline-flex items-center gap-1 text-xs text-bitcoin hover:text-bitcoin-hover transition-colors"
                  >
                    <BookOpen size={12} />
                    {t(FINDING_LEARN_MORE[finding.id].labelKey, { defaultValue: FINDING_LEARN_MORE[finding.id].labelDefault })}
                  </a>
                )}
                {proMode && finding.scoreImpact !== 0 && (
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer select-none hover:text-foreground transition-colors">
                      {t("finding.showScoreImpact", { defaultValue: "Score impact" })}
                    </summary>
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
                  </details>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

// ─── Ricochet hop table ─────────────────────────────────────────────────

interface RicochetHop {
  hop: number;
  txid: string;
  blockHeight: number;
  value: number;
  outputCount: number;
}

function RicochetHopTable({
  hopsJson,
  variant,
  hopCount,
  lang,
  onTxClick,
}: {
  hopsJson: string;
  variant: string;
  hopCount: number;
  lang: string;
  onTxClick?: (txid: string) => void;
}) {
  const { t } = useTranslation();
  let hops: RicochetHop[];
  try {
    hops = JSON.parse(hopsJson) as RicochetHop[];
  } catch {
    return null;
  }
  if (hops.length === 0) return null;

  const variantLabel = variant === "staggered"
    ? t("finding.ricochetVariant.staggered", { defaultValue: "Staggered" })
    : t("finding.ricochetVariant.classic", { defaultValue: "Classic (consecutive blocks)" });

  const lastHopIndex = hops.length - 1;

  return (
    <div className="rounded-md border border-severity-high/20 overflow-hidden">
      {/* Header with variant badge */}
      <div className="px-3 py-1.5 bg-severity-high/8 border-b border-severity-high/15 flex items-center gap-2">
        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-severity-high/30 bg-severity-high/10 text-severity-high font-medium">
          {variantLabel}
        </span>
        <span className="text-xs text-muted">
          {t("finding.ricochetHopCount", { count: hopCount || hops.length, defaultValue: "{{count}} hops" })}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[2rem_1fr_5rem_6rem] gap-x-2 px-3 py-1 border-b border-card-border text-[10px] uppercase tracking-wider text-muted">
        <span>{t("finding.ricochetCol.hop", { defaultValue: "Hop" })}</span>
        <span>{t("finding.ricochetCol.txid", { defaultValue: "Txid" })}</span>
        <span className="text-right">{t("finding.ricochetCol.block", { defaultValue: "Block" })}</span>
        <span className="text-right">{t("finding.ricochetCol.amount", { defaultValue: "Amount" })}</span>
      </div>

      {/* Hop rows */}
      <div className="divide-y divide-card-border overflow-y-auto" style={{ maxHeight: 240 }}>
        {hops.map((hop, idx) => (
          <div key={hop.txid} className="grid grid-cols-[2rem_1fr_5rem_6rem] gap-x-2 px-3 py-1.5 items-center text-xs">
            <span className="text-muted font-mono">{hop.hop}</span>
            <span className="flex items-center gap-1">
              {onTxClick ? (
                <button
                  onClick={() => onTxClick(hop.txid)}
                  className="font-mono text-bitcoin hover:text-bitcoin-hover transition-colors cursor-pointer"
                >
                  {truncateId(hop.txid, 4)}
                </button>
              ) : (
                <a
                  href={`/#tx=${hop.txid}`}
                  className="font-mono text-bitcoin hover:text-bitcoin-hover transition-colors"
                >
                  {truncateId(hop.txid, 4)}
                </a>
              )}
              {idx === lastHopIndex && (
                <span className="text-[10px] text-severity-high/80">
                  {t("finding.ricochetDest", { defaultValue: "-> dest" })}
                </span>
              )}
            </span>
            <span className="text-right text-muted font-mono">
              {fmtN(hop.blockHeight)}
            </span>
            <span className="text-right text-muted font-mono">
              {formatSats(hop.value, lang)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Consolidation detail table ─────────────────────────────────────────

interface ConsolidationGroup {
  childTxid: string;
  outputs: { index: number; value: number }[];
}

function ConsolidationTable({
  groupsJson,
  lang,
  onTxClick,
}: {
  groupsJson: string;
  lang: string;
  onTxClick?: (txid: string) => void;
}) {
  const { t } = useTranslation();
  const [copiedTxid, setCopiedTxid] = useState<string | null>(null);
  let groups: ConsolidationGroup[];
  try {
    groups = JSON.parse(groupsJson) as ConsolidationGroup[];
  } catch {
    return null;
  }
  if (groups.length === 0) return null;

  const handleCopy = (txid: string) => {
    copyToClipboard(txid);
    setCopiedTxid(txid);
    setTimeout(() => setCopiedTxid(null), 1500);
  };

  return (
    <div className="rounded-md border border-severity-critical/20 overflow-hidden">
      <div className="px-3 py-1.5 bg-severity-critical/8 border-b border-severity-critical/15">
        <p className="text-xs font-semibold text-severity-critical">
          {t("finding.consolidationDetail", { defaultValue: "Re-linked outputs" })}
        </p>
      </div>
      <div className="divide-y divide-card-border overflow-y-auto" style={{ maxHeight: 320 }}>
        {groups.map((g) => (
          <div key={g.childTxid} className="px-3 py-2 space-y-1.5">
            {/* Child tx link */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted">
                {t("finding.spentIn", { defaultValue: "Spent together in" })}
              </span>
              {onTxClick ? (
                <button
                  onClick={() => onTxClick(g.childTxid)}
                  className="font-mono text-xs text-bitcoin hover:text-bitcoin-hover transition-colors cursor-pointer"
                >
                  {truncateId(g.childTxid, 8)}
                </button>
              ) : (
                <span className="font-mono text-xs text-foreground/70">{truncateId(g.childTxid, 8)}</span>
              )}
              <a
                href={`/#tx=${g.childTxid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-foreground transition-colors"
                title={t("common.openInNewTab", { defaultValue: "Open in new tab" })}
              >
                <ExternalLink size={10} />
              </a>
              <button
                onClick={() => handleCopy(g.childTxid)}
                className="text-muted hover:text-foreground transition-colors cursor-pointer"
                title={t("common.copyTxid", { defaultValue: "Copy transaction ID" })}
              >
                {copiedTxid === g.childTxid ? <Check size={10} className="text-severity-good" /> : <Copy size={10} />}
              </button>
            </div>
            {/* Output list */}
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {g.outputs.map((o) => (
                <div key={o.index} className="contents">
                  <span className="font-mono text-severity-critical/80">#{o.index}</span>
                  <span className="text-muted">{formatSats(o.value, lang)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
