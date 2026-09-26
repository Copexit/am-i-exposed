"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, AlertTriangle } from "lucide-react";
import { selectRecommendations } from "@/lib/recommendations/primary-recommendation";
import { RecCard } from "@/components/PrimaryRecommendation";
import { AddressTypeBadge } from "@/components/results/constants";
import { copyToClipboard } from "@/lib/clipboard";
import { gradeTagline } from "@/lib/view/verdict";
import { findingKeys } from "@/lib/finding-utils";
import type { ResultViewModel } from "@/lib/view/tx-view-model";
import type { MempoolTransaction } from "@/lib/api/types";
import type { RevealState } from "@/components/v2/scan/useRevealTimeline";
import { ChecksStrip } from "@/components/v2/scan/ChecksStrip";
import { RevealSkip } from "@/components/v2/scan/RevealSkip";
import { GradeDial } from "./GradeDial";
import { SEVERITY_TEXT } from "./severity";

interface VerdictBandProps {
  query: string;
  inputType: "txid" | "address";
  vm: ResultViewModel;
  txData: MempoolTransaction | null;
  reveal: RevealState;
  checkCount: number;
  onRetry: () => void;
}

function Stat({ value, label, tone }: { value: React.ReactNode; label: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className={`v2-num text-xl leading-none ${tone ?? "text-foreground"}`}>{value}</div>
      <div className="text-xs text-muted mt-1.5">{label}</div>
    </div>
  );
}

/** L0: the verdict. Grade, what it means, the counts that matter, and the one thing to do next. */
export function VerdictBand({ query, inputType, vm, txData, reveal, checkCount, onRetry }: VerdictBandProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const tagline = gradeTagline(vm.grade, vm.all);
  const [primary, secondary] = selectRecommendations({ findings: vm.all, grade: vm.grade, walletGuess: vm.walletGuess });
  const status = txData?.status;
  const showType = inputType === "txid" && vm.txType && vm.txType !== "simple-payment" && vm.txType !== "unknown";

  return (
    <section id="v2-overview" aria-labelledby="v2-verdict-title" className="v2-panel grid gap-8 lg:gap-14 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)] items-center">
      {/* Grade */}
      <div
        className="flex flex-col items-center gap-5"
        data-testid="score-display"
        data-grade={vm.grade}
        data-score={vm.score}
      >
        <GradeDial score={reveal.displayScore} size={300} />
        {reveal.playing ? (
          <div className="w-full max-w-[280px] space-y-2">
            <ChecksStrip total={checkCount} done={reveal.checksDone} label={t("v2.results.revealChecks", { done: reveal.checksDone, total: checkCount, defaultValue: "{{done}} of {{total}} checks" })} />
            <RevealSkip onSkip={reveal.skip} />
          </div>
        ) : null}
      </div>

      {/* Meaning + action */}
      <div className="min-w-0 space-y-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={() => {
                void copyToClipboard(query).then((ok) => {
                  if (!ok) return;
                  setCopied(true);
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => setCopied(false), 1800);
                });
              }}
              className="group inline-flex items-center gap-2 v2-num text-xs text-muted hover:text-foreground transition-colors min-w-0 max-w-full"
              aria-label={t("common.copyToClipboard", { defaultValue: "Copy to clipboard" })}
              title={query}
            >
              <span className="truncate">{query}</span>
              {copied ? <Check size={13} className="shrink-0 text-severity-good" /> : <Copy size={13} className="shrink-0 opacity-50 group-hover:opacity-100" />}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {showType && (
              <span className="px-2 py-1 rounded-md border border-hairline-strong text-foreground">
                {t(`txType.${vm.txType}`, { defaultValue: String(vm.txType).replace(/-/g, " ") })}
              </span>
            )}
            {inputType === "address" && <AddressTypeBadge address={query} />}
            {inputType === "txid" && status?.confirmed && status.block_height != null && (
              <span className="v2-num">{t("results.blockHeight", { height: status.block_height.toLocaleString(), defaultValue: "Block #{{height}}" })}</span>
            )}
            {inputType === "txid" && status?.confirmed && status.block_time != null && (
              <span className="v2-num">{new Date(status.block_time * 1000).toLocaleString()}</span>
            )}
            {inputType === "txid" && txData && !status?.confirmed && (
              <span className="text-severity-medium">{t("results.unconfirmed", { defaultValue: "Unconfirmed (mempool)" })}</span>
            )}
          </div>
          {/* Waits for the reveal to settle so it never contradicts the dial's interim grade. */}
          <h1 id="v2-verdict-title" className={`text-3xl sm:text-4xl font-semibold tracking-tight text-balance leading-tight transition-opacity duration-300 ${reveal.playing ? "opacity-0" : "opacity-100"}`}>
            {t(tagline.key, { defaultValue: tagline.defaultValue })}
          </h1>
          {vm.grade === "F" && !reveal.playing && (
            <p className="flex items-start gap-2 text-sm text-muted max-w-[70ch]">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-severity-critical" aria-hidden="true" />
              {inputType === "txid"
                ? t("results.fGradeWarningTx", { defaultValue: "This transaction has severe privacy issues. On-chain surveillance can likely identify the owner and trace fund flows. Immediate remediation steps are recommended below." })
                : t("results.fGradeWarningAddr", { defaultValue: "This address has severe privacy issues. On-chain surveillance can likely identify the owner and trace fund flows. Immediate remediation steps are recommended below." })}
            </p>
          )}
          {(vm.partial || vm.status.length > 0) && (
            <div className="text-[13px] text-muted flex flex-wrap items-baseline gap-x-2 gap-y-1" data-testid="v2-analysis-notices">
              <span className="size-1.5 rounded-full bg-severity-medium self-center" aria-hidden="true" />
              <span>{t("v2.results.partial", { defaultValue: "Some data could not be fetched, so this result may be incomplete." })}</span>
              {vm.status.length > 0 && (
                <span className="text-faint">
                  ({vm.status.map((f) => t(findingKeys(f.id, "title", f.params), { ...f.params, defaultValue: f.title })).join("; ")})
                </span>
              )}
              <button type="button" onClick={onRetry} className="text-bitcoin hover:underline underline-offset-4">
                {t("page.retry", { defaultValue: "Retry" })}
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5 py-5 border-y border-hairline">
          <Stat value={vm.counts.issues} label={t("v2.results.statIssues", { count: vm.counts.issues, defaultValue: "issues found" })} />
          <Stat
            value={vm.counts.worst ? t(`common.severity.${vm.counts.worst}`, { defaultValue: vm.counts.worst }) : t("v2.results.none", { defaultValue: "None" })}
            tone={vm.counts.worst ? SEVERITY_TEXT[vm.counts.worst] : "text-severity-good"}
            label={t("v2.results.statWorst", { defaultValue: "worst severity" })}
          />
          <Stat value={vm.counts.historical} label={t("v2.results.statHistorical", { defaultValue: "already on chain" })} />
          <Stat value={vm.counts.ongoing + vm.counts.active} label={t("v2.results.statFixable", { defaultValue: "habits or risks to fix" })} />
        </div>

        <div className="space-y-4">
          <p className="v2-eyebrow">{t("primaryRec.sectionTitle", { defaultValue: "Top recommendation" })}</p>
          <RecCard rec={primary} />
          {secondary && (
            <div className="pt-4 border-t border-hairline">
              <RecCard rec={secondary} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
