"use client";

import { motion } from "motion/react";
import { useCallback, lazy, Suspense, memo } from "react";
import { useDevMode } from "@/hooks/useDevMode";
import { useExperienceMode } from "@/hooks/useExperienceMode";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import { useCjLinkabilityView } from "@/hooks/useCjLinkabilityView";
import { AddressSummary } from "./AddressSummary";
import { ExportButton } from "./ExportButton";
import { ChartErrorBoundary } from "./ui/ChartErrorBoundary";
import { ShareButtons } from "./ShareButtons";
import { ShareCardButton } from "./ShareCardButton";
import { BookmarkButton } from "./BookmarkButton";

// Lazy-load heavy chart components
const TxFlowDiagram = lazy(() => import("./viz/TxFlowDiagram").then(m => ({ default: m.TxFlowDiagram })));
const CoinJoinStructure = lazy(() => import("./viz/CoinJoinStructure").then(m => ({ default: m.CoinJoinStructure })));
const GraphExplorerPanel = lazy(() => import("./GraphExplorerPanel").then(m => ({ default: m.GraphExplorerPanel })));

// Extracted sub-components
import { InlineSearchBar } from "./results/InlineSearchBar";
import { HeroInfoCard } from "./results/HeroInfoCard";
import { ScoreAlertBlock } from "./results/ScoreAlertBlock";
import { FindingsSection } from "./results/FindingsSection";
import { DeepAnalysisTxid } from "./results/DeepAnalysisTxid";
import { DeepAnalysisAddress } from "./results/DeepAnalysisAddress";
import { PrimaryRecommendation } from "./PrimaryRecommendation";
import { ResultsFooter } from "./results/ResultsFooter";
import { ResultsSidebar } from "./results/ResultsSidebar";
import { FindingFilterBar } from "./results/FindingFilterBar";
import { useFindingFilters } from "@/hooks/useFindingFilters";

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
  const filters = useFindingFilters();
  const isCoinJoin = result.findings.some(isCoinJoinFinding);
  const fingerprintFinding = result.findings.find((f) => f.id === "h11-wallet-fingerprint");
  const detectedWallet = fingerprintFinding?.params?.walletGuess as string | undefined;
  const [cjLinkabilityView, setCjLinkabilityView] = useCjLinkabilityView(query, isCoinJoin, proMode, boltzmannResult);

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

  // Apply adversary/temporality filters (cypherpunk only), then split by severity
  const filtered = proMode ? filters.apply(visibleFindings) : visibleFindings;
  const criticalFindings = filtered.filter((f) => f.severity === "critical");
  const highFindings = filtered.filter((f) => f.severity === "high");
  const details = filtered.filter((f) => f.severity === "medium" || f.severity === "low");
  const strengths = filtered.filter((f) => f.severity === "good");

  return (
    <motion.div
      data-testid="results-panel"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      id="results-panel"
      className={`flex flex-col items-center gap-5 sm:gap-6 w-full ${proMode ? "max-w-3xl lg:max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px]" : "max-w-3xl"}`}
    >
      {/* ZONE 1: Search bar + action buttons */}
      <div className={`w-full flex flex-col ${proMode ? "xl:flex-row xl:items-center" : ""} gap-3`}>
        {onScan && <div className={`w-full ${proMode ? "xl:flex-1 xl:min-w-0" : ""}`}><InlineSearchBar onScan={onScan} initialValue={query} /></div>}
        <div className="flex items-center gap-2 flex-wrap xl:shrink-0">
          {proMode && <BookmarkButton query={query} inputType={inputType} grade={result.grade} score={result.score} />}
          <ExportButton targetId="results-panel" query={query} result={result} inputType={inputType} />
          <ShareCardButton grade={result.grade} score={result.score} query={query} inputType={inputType} findingCount={result.findings.length} />
          <ShareButtons grade={result.grade} score={result.score} query={query} inputType={inputType} findingCount={result.findings.length} />
        </div>
      </div>

      {/* === TWO-COLUMN DASHBOARD === */}
      <div className={`w-full flex flex-col ${proMode ? "xl:flex-row xl:gap-8 xl:items-start" : ""} gap-5 sm:gap-6`}>

      {/* -- MAIN CONTENT COLUMN -- */}
      <div className={`w-full ${proMode ? "xl:flex-1 xl:min-w-0" : ""} flex flex-col gap-5 sm:gap-6`}>

      <HeroInfoCard query={query} inputType={inputType} result={result} txData={txData} />

      {/* Score + alerts + top recommendation - inline in Simple, mobile-only in Pro */}
      <div className={`${proMode ? "xl:hidden" : ""} flex flex-col gap-5`}>
        <ScoreAlertBlock result={result} inputType={inputType} preSendResult={preSendResult} proMode={proMode} />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.12 }}>
          <PrimaryRecommendation findings={result.findings} grade={result.grade} walletGuess={detectedWallet ?? null} />
        </motion.div>
      </div>

      {/* Transaction Structure */}
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
                  isCoinJoinOverride={cjLinkabilityView && isCoinJoin}
                  onExitLinkability={() => setCjLinkabilityView(false)}
                />
              )}
            </Suspense>
          </ChartErrorBoundary>
        </motion.div>
      )}

      {proMode && <FindingFilterBar filters={filters} />}

      {criticalFindings.length > 0 && (
        <FindingsSection issues={criticalFindings} onTxClick={onScan} delay={0.17} proMode={proMode} />
      )}

      {proMode && inputType === "txid" && txData && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.18 }} className="w-full">
          <ChartErrorBoundary>
            <Suspense fallback={null}>
              <GraphExplorerPanel tx={txData} onTxClick={onScan} backwardLayers={backwardLayers} forwardLayers={forwardLayers} outspends={outspends} boltzmannResult={boltzmannResult} />
            </Suspense>
          </ChartErrorBoundary>
        </motion.div>
      )}

      {addressData && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.16 }} className="w-full">
          <AddressSummary address={addressData} findings={result?.findings} />
        </motion.div>
      )}

      {highFindings.length > 0 && (
        <FindingsSection issues={highFindings} onTxClick={onScan} delay={0.2} proMode={proMode} />
      )}

      {proMode && inputType === "txid" && (
        <DeepAnalysisTxid result={result} txData={txData} onScan={onScan} backwardLayers={backwardLayers} forwardLayers={forwardLayers} boltzmannResult={boltzmannResult} />
      )}

      {inputType === "address" && (
        <DeepAnalysisAddress query={query} addressUtxos={addressUtxos} txBreakdown={txBreakdown} addressTxs={addressTxs} addressData={addressData} onScan={onScan} proMode={proMode} />
      )}

      </div>{/* end main content column */}

      {/* -- SIDEBAR -- */}
      <ResultsSidebar
        query={query}
        inputType={inputType}
        result={result}
        txData={txData}
        addressData={addressData}
        preSendResult={preSendResult}
        proMode={proMode}
        devMode={devMode}
        isCoinJoin={isCoinJoin}
        detectedWallet={detectedWallet ?? null}
        details={details}
        strengths={strengths}
        onScan={onScan}
        onFindingClick={handleFindingClick}
      />

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
