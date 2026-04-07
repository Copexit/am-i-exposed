"use client";

import { useState, memo } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ChevronDown, BookOpen } from "lucide-react";
import type { Finding } from "@/lib/types";
import { highestAdversaryTier } from "@/lib/analysis/finding-metadata";
import { WalletIcon } from "@/components/ui/WalletIcon";
import { Tooltip } from "@/components/ui/Tooltip";
import { findingKey } from "@/lib/finding-utils";
import { RicochetHopTable, ConsolidationTable } from "./FindingCardTables";
import {
  SEVERITY_STYLES,
  CONFIDENCE_STYLES,
  CONFIDENCE_DESCRIPTIONS,
  ADVERSARY_STYLES,
  TEMPORALITY_STYLES,
  SEVERITY_TOOLTIPS,
  ADVERSARY_DESCRIPTIONS,
  TEMPORALITY_DESCRIPTIONS,
  CHANGE_SIGNAL_LABELS,
} from "./findingCardConstants";

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

function TierContext({ finding, t }: { finding: Finding; t: (key: string, opts?: Record<string, unknown>) => string }) {
  if (!finding.confidence && !finding.adversaryTiers?.length && !finding.temporality) return null;

  const conf = finding.confidence;
  const confText = conf
    ? t(`finding.tierContext.confidence.${conf}`, { defaultValue: CONFIDENCE_DESCRIPTIONS[conf] })
    : null;
  const confStyle = conf ? CONFIDENCE_STYLES[conf] : null;
  const tier = finding.adversaryTiers?.length ? highestAdversaryTier(finding.adversaryTiers) : null;
  const advText = tier
    ? t(`finding.tierContext.adversary.${tier}`, { defaultValue: `Exploitable by ${ADVERSARY_DESCRIPTIONS[tier]}` })
    : null;
  const advStyle = tier ? ADVERSARY_STYLES[tier] : null;
  const tempText = finding.temporality
    ? t(`finding.tierContext.temporality.${finding.temporality}`, { defaultValue: TEMPORALITY_DESCRIPTIONS[finding.temporality] })
    : null;
  const tempStyle = finding.temporality ? TEMPORALITY_STYLES[finding.temporality] : null;

  if (!confText && !advText && !tempText) return null;

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {confText && confStyle && (
        <span className="flex items-center gap-2">
          <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${confStyle.className}`}>
            {t(`common.confidence.${conf}`, { defaultValue: confStyle.label })}
          </span>
          <span className="text-muted">{confText}</span>
        </span>
      )}
      {advText && advStyle && (
        <span className="flex items-center gap-2">
          <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${advStyle.className}`}>
            {t(`adversary.${tier}`, { defaultValue: advStyle.label })}
          </span>
          <span className="text-muted">{advText}.</span>
        </span>
      )}
      {tempText && tempStyle && (
        <span className="flex items-center gap-2">
          <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${tempStyle.className}`}>
            {t(`temporality.${finding.temporality}`, { defaultValue: tempStyle.label })}
          </span>
          <span className="text-muted">{tempText}</span>
        </span>
      )}
    </div>
  );
}

/** Inline breakdown of which change detection signals fired and how they voted. */
function ChangeSignalBreakdown({ finding, t, proMode }: { finding: Finding; t: (key: string, opts?: Record<string, unknown>) => string; proMode: boolean }) {
  if (finding.id !== "h2-change-detected" || !finding.params?.signalDetails) return null;

  let details: Array<{ key: string; votedOutput: number; weight: number }>;
  try {
    details = JSON.parse(String(finding.params.signalDetails));
  } catch {
    return null;
  }
  if (!Array.isArray(details) || details.length === 0) return null;

  const hasMinorityDissent = Number(finding.params.hasMinorityDissent ?? 0) === 1;
  const changeIndex = finding.params.changeIndex;
  const majorityRatio = Number(finding.params.majorityRatio ?? 100);
  const corroboratorCount = Number(finding.params.corroboratorCount ?? 0);

  // Count how many signals agree on the majority output
  const majorityOutput = typeof changeIndex === "number" ? changeIndex : -1;
  const agreeCount = majorityOutput >= 0
    ? details.filter((d) => d.votedOutput === majorityOutput).length
    : details.length;

  return (
    <div className="bg-surface-inset/50 rounded-md px-3 py-2 space-y-2 text-xs">
      <ul className="space-y-1">
        {details.map((d) => {
          const label = CHANGE_SIGNAL_LABELS[d.key];
          const name = label
            ? t(label.i18nKey, { defaultValue: label.defaultLabel })
            : d.key;
          return (
            <li key={d.key} className="flex items-center justify-between gap-2">
              <span className="text-foreground/80">{name}</span>
              <span className="text-muted text-[11px] shrink-0">
                {t("finding.changeSignals.votesFor", { defaultValue: "votes" })}{" "}
                {t("finding.changeSignals.output", { index: d.votedOutput, defaultValue: `Output #${d.votedOutput}` })}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-muted">
        {!hasMinorityDissent
          ? t("finding.changeSignals.allAgree", {
              count: details.length,
              output: majorityOutput,
              defaultValue: `All ${details.length} signal${details.length > 1 ? "s" : ""} agree on Output #${majorityOutput} as change.`,
            })
          : majorityRatio >= 67
            ? t("finding.changeSignals.majorityAgree", {
                agreeCount,
                total: details.length,
                output: majorityOutput,
                defaultValue: `${agreeCount} of ${details.length} signals agree on Output #${majorityOutput} as change.`,
              })
            : t("finding.changeSignals.split", {
                defaultValue: "Signals are split - change output uncertain.",
              })}
      </p>
      {typeof changeIndex === "number" && majorityRatio >= 67 && (
        <p className="text-foreground/70 font-medium">
          {t("finding.changeSignals.identified", {
            index: changeIndex,
            defaultValue: `Output #${changeIndex} identified as likely change.`,
          })}
        </p>
      )}
      {proMode && corroboratorCount > 0 && (
        <p className="text-muted italic">
          {t("finding.changeSignals.compoundBoost", {
            count: corroboratorCount,
            defaultValue: `Confidence boosted by ${corroboratorCount} corroborating heuristic${corroboratorCount > 1 ? "s" : ""}.`,
          })}
        </p>
      )}
    </div>
  );
}

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
        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 min-h-[48px] text-left hover:bg-surface-elevated/50 transition-colors cursor-pointer"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} aria-hidden="true" />
        {finding.id === "h11-wallet-fingerprint" && finding.params?.walletGuess && (
          <WalletIcon walletName={String(finding.params.walletGuess)} size="sm" />
        )}
        <span className="flex-1 text-sm font-medium text-foreground min-w-[120px]">
          {t(findingKey(finding.id, "title", finding.params), { ...finding.params, defaultValue: finding.title })}
        </span>
        <span className="flex items-center gap-1.5 flex-wrap">
          {proMode && confidenceStyle && (
            <Tooltip content={t(`common.confidenceTooltip.${confidence}`, { defaultValue: confidenceStyle.tooltip })}>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${confidenceStyle.className}`}>
                {t(`common.confidence.${confidence}`, { defaultValue: confidenceStyle.label })}
              </span>
            </Tooltip>
          )}
          {proMode && finding.adversaryTiers && finding.adversaryTiers.length > 0 && (() => {
            const tier = highestAdversaryTier(finding.adversaryTiers);
            const advStyle = ADVERSARY_STYLES[tier];
            return (
              <Tooltip content={t(`adversaryTooltip.${tier}`, { defaultValue: `Exploitable by ${tier.replace(/_/g, " ")}` })}>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${advStyle.className}`}>
                  {t(`adversary.${tier}`, { defaultValue: advStyle.label })}
                </span>
              </Tooltip>
            );
          })()}
          {proMode && finding.temporality && (() => {
            const tempStyle = TEMPORALITY_STYLES[finding.temporality];
            return (
              <Tooltip content={t(`temporalityTooltip.${finding.temporality}`, { defaultValue: `Temporality: ${finding.temporality.replace(/_/g, " ")}` })}>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tempStyle.className}`}>
                  {t(`temporality.${finding.temporality}`, { defaultValue: tempStyle.label })}
                </span>
              </Tooltip>
            );
          })()}
          {badge && (
            <Tooltip content={t("results.chainBadgeTooltip", { defaultValue: "Based on backward and forward analysis of the inputs and outputs to this transaction" })}>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-card-border bg-surface-inset text-muted">
                {badge}
              </span>
            </Tooltip>
          )}
        </span>
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
              <ChangeSignalBreakdown finding={finding} t={t} proMode={proMode} />
              {proMode && <TierContext finding={finding} t={t} />}
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
              {finding.id === "ricochet-hop0" && finding.params?.hops && (
                <RicochetHopTable
                  hopsJson={String(finding.params.hops)}
                  variant={String(finding.params.variant ?? "classic")}
                  hopCount={Number(finding.params.hopCount ?? 0)}
                  lang={i18n.language}
                  onTxClick={onTxClick}
                />
              )}
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
