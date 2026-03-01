"use client";

import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ExternalLink, Copy, Info, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import { ScoreDisplay } from "./ScoreDisplay";
import { FindingCard } from "./FindingCard";
import { AddressSummary } from "./AddressSummary";
import { ExportButton } from "./ExportButton";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { ScoreWaterfall } from "./viz/ScoreWaterfall";
import { SeverityRing } from "./viz/SeverityRing";
import { TxFlowDiagram } from "./viz/TxFlowDiagram";
import { UtxoBubbleChart } from "./viz/UtxoBubbleChart";
import { PrivacyTimeline } from "./viz/PrivacyTimeline";
import { CoinJoinStructure } from "./viz/CoinJoinStructure";
import { Remediation } from "./Remediation";
import { CexRiskPanel } from "./CexRiskPanel";
import { ExchangeWarningPanel } from "./ExchangeWarningPanel";
import { TxBreakdownPanel } from "./TxBreakdownPanel";
import { ClusterPanel } from "./ClusterPanel";
import { TipJar } from "./TipJar";
import { CrossPromo } from "./CrossPromo";
import { ShareButtons } from "./ShareButtons";
import { ShareCardButton } from "./ShareCardButton";
import { BookmarkButton } from "./BookmarkButton";
import { GlowCard } from "./ui/GlowCard";
import { copyToClipboard } from "@/lib/clipboard";
import { getSummarySentiment } from "@/lib/scoring/score";
import { DestinationAlert } from "./DestinationAlert";
import type { ScoringResult, InputType, TxAnalysisResult } from "@/lib/types";
import type { MempoolTransaction, MempoolAddress, MempoolUtxo } from "@/lib/api/types";
import type { PreSendResult } from "@/lib/analysis/orchestrator";

function ScoringExplainer() {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
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
    color = "bg-muted/15 text-muted border-muted/30";
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
        <span className="text-severity-high">{t("results.issueCount", { count: issues, defaultValue: "{{count}} issue", defaultValue_other: "{{count}} issues" })}</span>
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
  addressUtxos?: MempoolUtxo[] | null;
  txBreakdown: TxAnalysisResult[] | null;
  preSendResult?: PreSendResult | null;
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
  addressUtxos,
  preSendResult,
  onBack,
  onScan,
  durationMs,
}: ResultsPanelProps) {
  const { config, customApiUrl, localApiStatus } = useNetwork();
  const { t } = useTranslation();
  const isCoinJoin = result.findings.some(isCoinJoinFinding);
  const explorerUrl = `${config.explorerUrl}/${inputType === "txid" ? "tx" : "address"}/${encodeURIComponent(query)}`;
  const explorerLabel = customApiUrl
    ? t("results.viewOnCustom", { hostname: new URL(config.explorerUrl).hostname, defaultValue: "View on {{hostname}}" })
    : localApiStatus === "available"
      ? t("results.viewOnLocal", { defaultValue: "View on local mempool" })
      : t("results.viewOnMempool", { defaultValue: "View on mempool.space" });

  const findingsBlock = result.findings.length > 0 && (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }} className="w-full space-y-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-base font-medium text-muted uppercase tracking-wider">
          {t("results.findingsHeading", { count: result.findings.length, defaultValue: "Findings ({{count}})" })}
        </h2>
        <FindingSummary findings={result.findings} />
      </div>
      <div className="space-y-3">
        {result.findings.map((finding, i) => (
          <FindingCard
            key={finding.id}
            finding={finding}
            index={i}
            defaultExpanded={finding.severity === "critical" || (result.grade === "F" && finding.severity === "high")}
          />
        ))}
      </div>
    </motion.div>
  );

  return (
    <motion.div
      data-testid="results-panel"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      id="results-panel"
      className="flex flex-col items-center gap-10 sm:gap-12 w-full max-w-3xl lg:max-w-5xl"
    >
      {/* ZONE 1: Navigation */}
      <div className="w-full flex flex-wrap items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer px-3 py-2 min-h-[44px] rounded-lg border border-card-border hover:border-muted/50 bg-surface-elevated/50"
        >
          <ArrowLeft size={16} />
          {t("results.newScan", { defaultValue: "New scan" })}
        </button>

        <div className="flex-1" />

        <BookmarkButton query={query} inputType={inputType} grade={result.grade} score={result.score} />
        <ExportButton targetId="results-panel" query={query} result={result} inputType={inputType} />
        <ShareCardButton
          grade={result.grade}
          score={result.score}
          query={query}
          inputType={inputType as "txid" | "address"}
          findingCount={result.findings.length}
        />
        <ShareButtons
          grade={result.grade}
          score={result.score}
          query={query}
          inputType={inputType as "txid" | "address"}
          findingCount={result.findings.length}
        />
      </div>

      {/* ZONE 2: Hero Score */}
      <GlowCard className="w-full p-7 space-y-6">
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
            onClick={() => copyToClipboard(query)}
            className="inline-flex items-start gap-2 font-mono text-sm text-foreground/90 break-all leading-relaxed text-left hover:text-foreground transition-colors cursor-pointer group/copy"
            title={t("common.copy", { defaultValue: "Copy" })}
          >
            <span className="break-all">{query}</span>
            <Copy size={14} className="shrink-0 mt-1 text-muted opacity-0 group-hover/copy:opacity-100 transition-opacity" />
          </button>
        </div>

        <div className="border-t border-card-border pt-6">
          <div className="flex items-center justify-center gap-6">
            <ScoreDisplay score={result.score} grade={result.grade} findings={result.findings} />
            {result.findings.length > 3 && (
              <SeverityRing findings={result.findings} size={120} />
            )}
          </div>
        </div>
      </GlowCard>

      {/* ZONE 3: Alerts + Context */}
      {(result.grade === "F" || result.findings.length > 0 || (inputType === "address" && preSendResult)) && (
        <div className="w-full flex flex-col gap-3 sm:gap-4">
          {result.grade === "F" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 }}
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

          {/* Summary sentiment (moved up from after findings) */}
          {result.grade !== "F" && (() => {
            const sentiment = getSummarySentiment(result.grade, result.findings);
            const colorMap = {
              positive: { border: "border-severity-good/30 bg-severity-good/5", text: "text-severity-good" },
              cautious: { border: "border-severity-medium/30 bg-severity-medium/5", text: "text-severity-medium" },
              warning: { border: "border-severity-high/30 bg-severity-high/5", text: "text-severity-high" },
              danger: { border: "border-severity-critical/30 bg-severity-critical/5", text: "text-severity-critical" },
            };
            const colors = colorMap[sentiment];
            return (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }} className={`w-full rounded-xl border px-4 py-3 ${colors.border}`}>
                <p className={`text-base font-medium ${colors.text}`}>
                  {sentiment === "positive"
                    ? t("results.summaryGood", { defaultValue: "No significant privacy concerns detected." })
                    : sentiment === "cautious"
                      ? t("results.summaryFair", { defaultValue: "Some privacy concerns detected. Review the findings below." })
                      : t("results.summaryPoor", { defaultValue: "Significant privacy exposure detected. Remediation recommended." })}
                </p>
              </motion.div>
            );
          })()}

          {inputType === "address" && preSendResult && (
            <DestinationAlert preSendResult={preSendResult} />
          )}
        </div>
      )}

      {/* ZONE 5: Transaction Structure (full width) */}
      {txData && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }} className="w-full">
          {result.findings.some((f) => f.id.startsWith("h4-")) ? (
            <CoinJoinStructure tx={txData} findings={result.findings} onAddressClick={onScan} />
          ) : (
            <TxFlowDiagram tx={txData} findings={result.findings} onAddressClick={onScan} />
          )}
        </motion.div>
      )}

      {/* ZONE 6: Analysis */}
      {addressData && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }} className="w-full">
          <AddressSummary address={addressData} />
        </motion.div>
      )}
      {addressUtxos && addressUtxos.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.25 }} className="w-full">
          <UtxoBubbleChart utxos={addressUtxos} />
        </motion.div>
      )}
      {findingsBlock}

      {/* ZONE 7: Actionable */}
      <div className="w-full flex flex-col gap-3 sm:gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.35 }} className="w-full">
          <Remediation findings={result.findings} grade={result.grade} />
        </motion.div>
        {isCoinJoin && (
          <>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.4 }} className="w-full">
              <CexRiskPanel
                query={query}
                inputType={inputType}
                txData={txData}
                isCoinJoin={isCoinJoin}
              />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.45 }} className="w-full">
              <ExchangeWarningPanel />
            </motion.div>
          </>
        )}
      </div>

      {/* ZONE 8: Address Deep-Dive (address only) */}
      {inputType === "address" && (
        <>
          {txBreakdown && txBreakdown.length >= 2 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.4 }} className="w-full">
              <PrivacyTimeline breakdown={txBreakdown} onScan={onScan ? (txid) => onScan(txid) : undefined} />
            </motion.div>
          )}
          {txBreakdown && txBreakdown.length > 0 && addressData && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.45 }} className="w-full">
              <TxBreakdownPanel
                breakdown={txBreakdown}
                targetAddress={query}
                totalTxCount={addressData.chain_stats.tx_count + addressData.mempool_stats.tx_count}
                onScan={onScan}
              />
            </motion.div>
          )}
          {addressTxs && addressTxs.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.5 }} className="w-full">
              <ClusterPanel
                targetAddress={query}
                txs={addressTxs}
                onAddressClick={onScan}
              />
            </motion.div>
          )}
        </>
      )}

      {/* ZONE 9: Diagnostics */}
      <div className="w-full flex flex-col gap-3 sm:gap-4">
        {!isCoinJoin && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.5 }} className="w-full">
            <CexRiskPanel
              query={query}
              inputType={inputType}
              txData={txData}
              isCoinJoin={false}
            />
          </motion.div>
        )}
        {result.findings.some((f) => f.scoreImpact !== 0) && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.55 }} className="w-full">
            <ScoreWaterfall
              findings={result.findings}
              finalScore={result.score}
              grade={result.grade}
              onFindingClick={(findingId) => {
                const el = document.querySelector(`[data-finding-id="${findingId}"]`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            />
          </motion.div>
        )}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.6 }} className="w-full">
          <ScoreBreakdown findings={result.findings} finalScore={result.score} />
          <ScoringExplainer />
        </motion.div>
      </div>

      {/* ZONE 10: Promotional */}
      <div className="w-full flex flex-col gap-3 sm:gap-4">
        {(result.grade === "F" || result.grade === "D" || result.grade === "A+" || result.grade === "B") && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.55 }}
            className="w-full rounded-xl border border-dashed border-card-border px-5 py-4 text-center"
          >
            <p className="text-sm text-muted">
              {result.grade === "D" || result.grade === "F"
                ? t("sharePrompt.bad", { defaultValue: "This transaction has serious privacy issues. Share it as a cautionary tale." })
                : t("sharePrompt.good", { defaultValue: "Strong privacy practices here. Share it as an example of how it should be done." })}
            </p>
            <button
              onClick={() => {
                const isBad = result.grade === "D" || result.grade === "F";
                const text = isBad
                  ? t("sharePrompt.tweetBad", {
                      defaultValue: "Privacy score: {{grade}} ({{score}}/100). This is what happens when you ignore coin control and reuse addresses. Chain analysis firms feast on transactions like this.",
                      grade: result.grade, score: result.score,
                    })
                  : t("sharePrompt.tweetGood", {
                      defaultValue: "Privacy score: {{grade}} ({{score}}/100). This is what proper Bitcoin privacy hygiene looks like.",
                      grade: result.grade, score: result.score,
                    });
                const shareUrl = `https://am-i.exposed/#${inputType === "txid" ? "tx" : "addr"}=${encodeURIComponent(query)}`;
                window.open(
                  `https://x.com/intent/tweet?text=${encodeURIComponent(`${text}\n\n${shareUrl}`)}`,
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
              className="mt-2 inline-flex items-center gap-1.5 text-sm text-bitcoin hover:text-bitcoin-hover px-4 py-2 rounded-lg border border-bitcoin/20 hover:border-bitcoin/40 bg-bitcoin/5 transition-colors cursor-pointer"
            >
              {t("sharePrompt.shareOnX", { defaultValue: "Share on X" })}
            </button>
          </motion.div>
        )}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.6 }} className="w-full">
          <TipJar />
          {inputType === "txid" && <CrossPromo />}
        </motion.div>
      </div>

      {/* ZONE 11: Footer */}
      <div className="w-full flex flex-col items-center gap-4">
        <div className="w-full flex flex-wrap items-center justify-center gap-4 pt-2 pb-4 text-sm">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-bitcoin hover:text-bitcoin-hover transition-colors px-4 py-2 rounded-lg border border-bitcoin/20 hover:border-bitcoin/40 bg-bitcoin/5"
          >
            {explorerLabel}
            <ExternalLink size={13} />
          </a>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.65 }} className="w-full bg-surface-inset rounded-lg px-4 py-3 text-sm text-muted leading-relaxed">
          {t("results.disclaimerStats", {
            findingCount: result.findings.length,
            heuristicCount: inputType === "txid" ? "13" : "4",
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
        </motion.div>

        <div className="text-xs text-muted pb-4 hidden sm:block">
          {t("results.pressEsc", { defaultValue: "Press" })} <kbd className="px-1.5 py-0.5 rounded bg-surface-elevated border border-card-border text-muted font-mono">Esc</kbd> {t("results.forNewScan", { defaultValue: "for new scan" })}
        </div>
      </div>
    </motion.div>
  );
}
