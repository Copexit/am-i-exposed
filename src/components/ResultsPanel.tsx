"use client";

import { motion } from "motion/react";
import { useState, useCallback, useEffect, lazy, Suspense, memo } from "react";
import { useDevMode } from "@/hooks/useDevMode";
import { useExperienceMode } from "@/hooks/useExperienceMode";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import { AddressSummary } from "./AddressSummary";
import { ExportButton } from "./ExportButton";
import { TX_BASE_SCORE, ADDRESS_BASE_SCORE } from "@/lib/scoring/score";
import { ChartErrorBoundary } from "./ui/ChartErrorBoundary";
import { FindingsTier } from "./FindingsTier";
import { AnalystView } from "./AnalystView";
import { ShareButtons } from "./ShareButtons";
import { ShareCardButton } from "./ShareCardButton";
import { BookmarkButton } from "./BookmarkButton";


// Lazy-load heavy chart components
const TxFlowDiagram = lazy(() => import("./viz/TxFlowDiagram").then(m => ({ default: m.TxFlowDiagram })));
const CoinJoinStructure = lazy(() => import("./viz/CoinJoinStructure").then(m => ({ default: m.CoinJoinStructure })));
const TipJar = lazy(() => import("./TipJar").then(m => ({ default: m.TipJar })));

// Extracted sub-components
import { InlineSearchBar } from "./results/InlineSearchBar";
import { HeroInfoCard } from "./results/HeroInfoCard";
import { ScoreAlertBlock } from "./results/ScoreAlertBlock";
import { FindingsSection } from "./results/FindingsSection";
import { DeepAnalysisTxid } from "./results/DeepAnalysisTxid";
import { DeepAnalysisAddress } from "./results/DeepAnalysisAddress";
import { SidebarRecommendations } from "./results/SidebarRecommendations";
import { PrimaryRecommendation } from "./PrimaryRecommendation";
import { SidebarWarnings } from "./results/SidebarWarnings";
import { ScoreWaterfallCollapsible } from "./results/ScoreWaterfallCollapsible";
import { ResultsFooter } from "./results/ResultsFooter";

import type { ScoringResult, TxAnalysisResult } from "@/lib/types";
import type { MempoolTransaction, MempoolAddress, MempoolUtxo } from "@/lib/api/types";
import type { PreSendResult } from "@/lib/analysis/orchestrator";

interface ResultsPanelProps {
  query: string;
  inputType: "txid" | "address";
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
  /** USD per BTC at the time the transaction was confirmed (mainnet only). */
  usdPrice?: number | null;
  /** Per-output spend status from the API. */
  outspends?: import("@/lib/api/types").MempoolOutspend[] | null;
  /** Backward trace layers from chain analysis. */
  backwardLayers?: import("@/lib/analysis/chain/recursive-trace").TraceLayer[] | null;
  /** Forward trace layers from chain analysis. */
  forwardLayers?: import("@/lib/analysis/chain/recursive-trace").TraceLayer[] | null;
  /** Boltzmann link probability result. */
  boltzmannResult?: import("@/hooks/useBoltzmann").BoltzmannWorkerResult | null;
}

export const ResultsPanel = memo(function ResultsPanel({
  query,
  inputType,
  result,
  txData,
  addressData,
  addressTxs,
  txBreakdown,
  addressUtxos,
  preSendResult,
  onBack: _onBack,
  onScan,
  durationMs,
  usdPrice,
  outspends,
  backwardLayers,
  forwardLayers,
  boltzmannResult,
}: ResultsPanelProps) {
  const { config, customApiUrl, isUmbrel } = useNetwork();
  const { t } = useTranslation();
  const { devMode } = useDevMode();
  const { proMode } = useExperienceMode();
  const isCoinJoin = result.findings.some(isCoinJoinFinding);
  const fingerprintFinding = result.findings.find((f) => f.id === "h11-wallet-fingerprint");
  const detectedWallet = fingerprintFinding?.params?.walletGuess as string | undefined;
  const [cjLinkabilityView, setCjLinkabilityView] = useState(false);
  // Reset CJ linkability view when query changes
  useEffect(() => { const t = setTimeout(() => setCjLinkabilityView(false), 0); return () => clearTimeout(t); }, [query]);
  // Pro mode: auto-switch to linkability view when Boltzmann is computed
  useEffect(() => {
    if (proMode && boltzmannResult != null) {
      const t = setTimeout(() => setCjLinkabilityView(true), 0);
      return () => clearTimeout(t);
    }
  }, [proMode, boltzmannResult]);

  const handleFindingClick = useCallback((findingId: string) => {
    const el = document.querySelector(`[data-finding-id="${findingId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const explorerUrl = `${config.explorerUrl}/${inputType === "txid" ? "tx" : "address"}/${encodeURIComponent(query)}`;
  const explorerLabel = customApiUrl
    ? t("results.viewOnCustom", { hostname: new URL(config.explorerUrl).hostname, defaultValue: "View on {{hostname}}" })
    : isUmbrel
      ? t("results.viewOnLocal", { defaultValue: "View on local mempool" })
      : t("results.viewOnMempool", { defaultValue: "View on mempool.space" });

  // Hide findings that were suppressed for CoinJoin context (scoreImpact=0, context=coinjoin)
  // Also hide chain-trace-summary (metadata-only for TaintPathDiagram)
  const visibleFindings = result.findings.filter(
    (f) => !(f.scoreImpact === 0 && String(f.params?.context ?? "").includes("coinjoin"))
      && f.id !== "chain-trace-summary",
  );

  // Split findings into three severity tiers for progressive disclosure
  const issues = visibleFindings.filter((f) => f.severity === "critical" || f.severity === "high");
  const details = visibleFindings.filter((f) => f.severity === "medium" || f.severity === "low");
  const strengths = visibleFindings.filter((f) => f.severity === "good");

  return (
    <motion.div
      data-testid="results-panel"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      id="results-panel"
      className={`flex flex-col items-center gap-5 sm:gap-6 w-full ${proMode ? "max-w-3xl lg:max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px]" : "max-w-3xl"}`}
    >
      {/* ZONE 1: Search bar + action buttons (shared row on desktop) */}
      <div className="w-full flex flex-col xl:flex-row xl:items-center gap-3">
        {onScan && <div className="w-full xl:flex-1 xl:min-w-0"><InlineSearchBar onScan={onScan} initialValue={query} /></div>}
        <div className="flex items-center gap-2 flex-wrap xl:shrink-0">
          <BookmarkButton query={query} inputType={inputType} grade={result.grade} score={result.score} />
          <ExportButton targetId="results-panel" query={query} result={result} inputType={inputType} />
          <ShareCardButton grade={result.grade} score={result.score} query={query} inputType={inputType} findingCount={result.findings.length} />
          <ShareButtons grade={result.grade} score={result.score} query={query} inputType={inputType} findingCount={result.findings.length} />
        </div>
      </div>

      {/* === TWO-COLUMN DASHBOARD (xl+ in Pro, single-column in Simple) === */}
      <div className={`w-full flex flex-col ${proMode ? "xl:flex-row xl:gap-8 xl:items-start" : ""} gap-5 sm:gap-6`}>

      {/* -- MAIN CONTENT COLUMN (first in DOM = left on desktop, top on mobile) -- */}
      <div className={`w-full ${proMode ? "xl:flex-1 xl:min-w-0" : ""} flex flex-col gap-5 sm:gap-6`}>

      {/* Hero info card */}
      <HeroInfoCard query={query} inputType={inputType} result={result} txData={txData} />

      {/* Score + alerts + top recommendation - inline in Simple, mobile-only in Pro (Pro desktop shows in sidebar) */}
      <div className={`${proMode ? "xl:hidden" : ""} flex flex-col gap-5`}>
        <ScoreAlertBlock result={result} inputType={inputType} preSendResult={preSendResult} proMode={proMode} />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.12 }}>
          <PrimaryRecommendation findings={result.findings} grade={result.grade} walletGuess={detectedWallet ?? null} />
        </motion.div>
      </div>

      {/* Transaction Structure (full width) */}
      {txData && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.16 }} className="w-full">
          <ChartErrorBoundary>
            <Suspense fallback={null}>
              {result.findings.some((f) => isCoinJoinFinding(f) && f.scoreImpact >= 15) && !cjLinkabilityView ? (
                <CoinJoinStructure tx={txData} findings={result.findings} onAddressClick={onScan} usdPrice={usdPrice} outspends={outspends}
                  linkabilityAvailable={proMode && boltzmannResult != null}
                  onToggleLinkability={() => setCjLinkabilityView(true)}
                />
              ) : (
                <TxFlowDiagram tx={txData} findings={result.findings} onAddressClick={onScan} usdPrice={usdPrice} outspends={outspends} boltzmannResult={boltzmannResult}
                  isCoinJoinOverride={cjLinkabilityView}
                  onExitLinkability={() => setCjLinkabilityView(false)}
                />
              )}
            </Suspense>
          </ChartErrorBoundary>
        </motion.div>
      )}

      {/* Address summary (address only) */}
      {addressData && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.16 }} className="w-full">
          <AddressSummary address={addressData} findings={result?.findings} />
        </motion.div>
      )}

      {/* Findings */}
      <FindingsSection issues={issues} visibleFindings={visibleFindings} onTxClick={onScan} delay={0.2} proMode={proMode} />

      {/* Deep Analysis (txid only, Pro mode) */}
      {proMode && inputType === "txid" && (
        <DeepAnalysisTxid
          result={result}
          txData={txData}
          onScan={onScan}
          backwardLayers={backwardLayers}
          forwardLayers={forwardLayers}
          outspends={outspends}
          boltzmannResult={boltzmannResult}
        />
      )}

      {/* Address Deep-Dive (address only) */}
      {inputType === "address" && (
        <DeepAnalysisAddress
          query={query}
          addressUtxos={addressUtxos}
          txBreakdown={txBreakdown}
          addressTxs={addressTxs}
          addressData={addressData}
          onScan={onScan}
          proMode={proMode}
        />
      )}

      </div>{/* end main content column */}

      {/* -- SIDEBAR (second in DOM = right on desktop in Pro, flows below in Simple) -- */}
      <div className={`w-full ${proMode ? "xl:w-[380px] 2xl:w-[420px] xl:shrink-0" : ""} flex flex-col gap-5 sm:gap-6`}>

      {/* Score + alerts - desktop sidebar only in Pro (Simple shows inline above) */}
      {proMode && (
        <div className="hidden xl:flex flex-col gap-5">
          <ScoreAlertBlock result={result} inputType={inputType} preSendResult={preSendResult} proMode={proMode} />
        </div>
      )}

      {/* Recommendations - sidebar PrimaryRecommendation only in Pro (Simple shows inline above) */}
      {proMode && <SidebarRecommendations result={result} detectedWallet={detectedWallet ?? null} devMode={devMode} />}

      {/* Additional findings, strengths, score waterfall (sidebar, Pro only) */}
      {proMode && details.length > 0 && (
        <FindingsTier
          findings={details}
          label={t("results.additionalFindings", { count: details.length, defaultValue: "Additional findings ({{count}})" })}
          defaultOpen={true}
          grade={result.grade}
          delay={0.25}
          onTxClick={onScan}
          proMode={proMode}
        />
      )}

      {proMode && strengths.length > 0 && (
        <FindingsTier
          findings={strengths}
          label={t("results.privacyStrengths", { count: strengths.length, defaultValue: "Privacy strengths ({{count}})" })}
          defaultOpen={true}
          grade={result.grade}
          delay={0.3}
          onTxClick={onScan}
          proMode={proMode}
        />
      )}

      {proMode && result.findings.some((f) => f.scoreImpact !== 0) && (
        <ScoreWaterfallCollapsible
          findings={result.findings}
          score={result.score}
          grade={result.grade}
          baseScore={addressData ? ADDRESS_BASE_SCORE : TX_BASE_SCORE}
          onFindingClick={handleFindingClick}
          delay={0.35}
        />
      )}

      {/* Contextual Warnings (sidebar) */}
      <SidebarWarnings
        query={query}
        inputType={inputType}
        txData={txData}
        isCoinJoin={isCoinJoin}
        result={result}
      />

      {/* Diagnostics (sidebar) */}
      {inputType === "txid" && result.findings.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.58 }} className="w-full">
          <AnalystView findings={result.findings} grade={result.grade} />
        </motion.div>
      )}

      </div>{/* end sidebar */}

      </div>{/* end two-column wrapper */}

      {/* Footer */}
      <ResultsFooter
        inputType={inputType}
        result={result}
        txBreakdown={txBreakdown}
        durationMs={proMode ? durationMs : null}
        explorerUrl={explorerUrl}
        explorerLabel={explorerLabel}
        mempoolBaseUrl={config.mempoolBaseUrl}
      />
    </motion.div>
  );
});
