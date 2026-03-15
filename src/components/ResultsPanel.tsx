"use client";

import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ExternalLink, Copy, Check, Info, AlertTriangle, Search, ChevronRight } from "lucide-react";
import { useState, useCallback, useRef, useEffect, lazy, Suspense, memo } from "react";
import { useDevMode } from "@/hooks/useDevMode";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import { getAddressType } from "@/lib/bitcoin/address-type";
import { ScoreDisplay } from "./ScoreDisplay";
import { FindingCard } from "./FindingCard";
import { AddressSummary } from "./AddressSummary";
import { ExportButton } from "./ExportButton";
import { TX_BASE_SCORE, ADDRESS_BASE_SCORE } from "@/lib/scoring/score";
import { ACTION_BTN_CLASS } from "@/lib/constants";


// Lazy-load heavy visx/d3 chart components - only needed after analysis completes
const ScoreWaterfall = lazy(() => import("./viz/ScoreWaterfall").then(m => ({ default: m.ScoreWaterfall })));
const SeverityRing = lazy(() => import("./viz/SeverityRing").then(m => ({ default: m.SeverityRing })));
const TxFlowDiagram = lazy(() => import("./viz/TxFlowDiagram").then(m => ({ default: m.TxFlowDiagram })));
const UtxoBubbleChart = lazy(() => import("./viz/UtxoBubbleChart").then(m => ({ default: m.UtxoBubbleChart })));
const PrivacyTimeline = lazy(() => import("./viz/PrivacyTimeline").then(m => ({ default: m.PrivacyTimeline })));
const CoinJoinStructure = lazy(() => import("./viz/CoinJoinStructure").then(m => ({ default: m.CoinJoinStructure })));
const FingerprintTimeline = lazy(() => import("./viz/FingerprintTimeline").then(m => ({ default: m.FingerprintTimeline })));
const GraphExplorerPanel = lazy(() => import("./GraphExplorerPanel").then(m => ({ default: m.GraphExplorerPanel })));
const TaintPathDiagram = lazy(() => import("./viz/TaintPathDiagram").then(m => ({ default: m.TaintPathDiagram })));
const LinkabilityHeatmap = lazy(() => import("./viz/LinkabilityHeatmap").then(m => ({ default: m.LinkabilityHeatmap })));
import { CHAIN_FINDING_IDS } from "./ChainAnalysisPanel";
import { FindingsTier } from "./FindingsTier";
import { ChartErrorBoundary } from "./ui/ChartErrorBoundary";
import { PrimaryRecommendation } from "./PrimaryRecommendation";
import { Remediation } from "./Remediation";
import { RecoveryFlow } from "./RecoveryFlow";
import { CommonMistakes } from "./CommonMistakes";
import { AnalystView } from "./AnalystView";
import { CexRiskPanel } from "./CexRiskPanel";
import { ExchangeWarningPanel } from "./ExchangeWarningPanel";
import { TxBreakdownPanel } from "./TxBreakdownPanel";
import { ClusterPanel } from "./ClusterPanel";
const TipJar = lazy(() => import("./TipJar").then(m => ({ default: m.TipJar })));
import { ShareButtons } from "./ShareButtons";
import { ShareCardButton } from "./ShareCardButton";
import { BookmarkButton } from "./BookmarkButton";
import { GlowCard } from "./ui/GlowCard";
import { copyToClipboard } from "@/lib/clipboard";
import { detectInputType, cleanInput } from "@/lib/analysis/detect-input";
import { getSummarySentiment } from "@/lib/scoring/score";
import { DestinationAlert } from "./DestinationAlert";
import type { ScoringResult, TxAnalysisResult, TxType } from "@/lib/types";
import type { MempoolTransaction, MempoolAddress, MempoolUtxo } from "@/lib/api/types";
import type { PreSendResult } from "@/lib/analysis/orchestrator";

const TX_TYPE_LABELS: Partial<Record<TxType, string>> = {
  "whirlpool-coinjoin": "Whirlpool",
  "wabisabi-coinjoin": "WabiSabi",
  "joinmarket-coinjoin": "JoinMarket",
  "generic-coinjoin": "CoinJoin",
  "stonewall": "Stonewall",
  "simplified-stonewall": "Simplified Stonewall",
  "tx0-premix": "TX0 Premix",
  "bip47-notification": "BIP47 Notification",
  "consolidation": "Consolidation",
  "exchange-withdrawal": "Exchange Withdrawal",
  "batch-payment": "Batch Payment",
  "self-transfer": "Self-transfer",
  "peel-chain": "Peel Chain",
  "coinbase": "Coinbase",
};

function ScoringExplainer({ isAddress }: { isAddress?: boolean }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const baseScore = isAddress ? "93" : "70";

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="scoring-explainer-panel"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
      >
        <Info size={12} aria-hidden="true" />
        {t("results.howScoringWorks", { defaultValue: "How scoring works" })}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden col-span-full"
          >
            <div id="scoring-explainer-panel" className="bg-surface-inset rounded-lg px-4 py-3 text-sm text-muted leading-relaxed space-y-2 mt-2">
              <p>
                {t("results.scoringExplainerP1", { defaultValue: "Scores start at " })}<strong className="text-foreground">{baseScore}/100</strong>{t("results.scoringExplainerP1b", { defaultValue: " (baseline) and are adjusted by each heuristic finding. Negative findings (address reuse, change detection, round amounts) lower the score. Positive findings (CoinJoin, high entropy, anonymity sets) raise it." })}
              </p>
              <p>
                <strong className="text-severity-good">A+ (90+)</strong>{" "}
                <strong className="text-severity-low">B (75-89)</strong>{" "}
                <strong className="text-severity-medium">C (50-74)</strong>{" "}
                <strong className="text-severity-high">D (25-49)</strong>{" "}
                <strong className="text-severity-critical">F (&lt;25)</strong>
              </p>
              <p>
                {t("results.scoringExplainerP3", { defaultValue: "The engine runs 32 heuristics based on published chain analysis research. Scores are clamped to 0-100. CoinJoin transactions receive adjusted scoring that accounts for their privacy-enhancing properties." })}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
const ADDRESS_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  p2tr:    { label: "Taproot",  color: "bg-severity-good/20 text-severity-good border-severity-good/30" },
  p2wpkh:  { label: "SegWit",   color: "bg-severity-low/20 text-severity-low border-severity-low/30" },
  p2wsh:   { label: "SegWit",   color: "bg-severity-low/20 text-severity-low border-severity-low/30" },
  p2sh:    { label: "P2SH",     color: "bg-severity-medium/20 text-severity-medium border-severity-medium/30" },
  p2pkh:   { label: "Legacy",   color: "bg-muted/15 text-muted border-muted/30" },
};

function AddressTypeBadge({ address }: { address: string }) {
  const { t } = useTranslation();
  const addrType = getAddressType(address);
  const config = ADDRESS_TYPE_CONFIG[addrType];
  if (!config) return null;

  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${config.color}`}>
      {t(`results.addressType.${config.label}`, { defaultValue: config.label })}
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

function ScoreWaterfallCollapsible({
  findings,
  score,
  grade,
  baseScore,
  onFindingClick,
  delay,
}: {
  findings: ScoringResult["findings"];
  score: number;
  grade: ScoringResult["grade"];
  baseScore: number;
  onFindingClick: (id: string) => void;
  delay: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="w-full"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-1 py-2 text-left group cursor-pointer"
        aria-expanded={open}
      >
        <ChevronRight
          size={14}
          className={`text-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        <span className="text-sm font-medium text-muted uppercase tracking-wider">
          {t("results.scoreImpact", { defaultValue: "Score impact" })}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="pt-1">
              <ChartErrorBoundary>
                <Suspense fallback={null}>
                  <ScoreWaterfall
                    findings={findings}
                    finalScore={score}
                    grade={grade}
                    baseScore={baseScore}
                    onFindingClick={onFindingClick}
                  />
                </Suspense>
              </ChartErrorBoundary>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function InlineSearchBar({ onScan, initialValue }: { onScan: (input: string) => void; initialValue?: string }) {
  const { t } = useTranslation();
  const { network } = useNetwork();
  const [value, setValue] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = cleanInput(value);
    if (!cleaned) return;
    const type = detectInputType(cleaned, network);
    if (type === "invalid") {
      setError(t("input.errorInvalid", { defaultValue: "Invalid address or txid" }));
      return;
    }
    setError(null);
    onScan(cleaned);
  }, [value, network, onScan, t]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    const cleaned = cleanInput(pasted.trim());
    if (!cleaned) return;
    const type = detectInputType(cleaned, network);
    if (type !== "invalid") {
      e.preventDefault();
      setValue("");
      setError(null);
      onScan(cleaned);
    }
  }, [network, onScan]);

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative flex items-center">
        <Search size={14} className="absolute left-3 text-muted/60 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onPaste={handlePaste}
          placeholder={t("input.placeholderScan", { defaultValue: "Paste a Bitcoin address or transaction ID" })}
          spellCheck={false}
          autoComplete="off"
          aria-label={t("input.placeholderScan", { defaultValue: "Paste a Bitcoin address or transaction ID" })}
          className="w-full rounded-lg border border-card-border bg-surface-elevated/50 pl-8 pr-16 py-2 min-h-[44px]
            font-mono text-sm text-foreground placeholder:text-muted/50
            focus:border-bitcoin/40 focus:shadow-[0_0_8px_rgba(247,147,26,0.1)]
            focus-visible:outline-2 focus-visible:outline-bitcoin/50
            transition-all duration-150"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="absolute right-1.5 px-3 py-1 text-xs font-semibold rounded-md
            bg-bitcoin/80 text-black hover:bg-bitcoin transition-colors
            disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        >
          {t("input.buttonScan", { defaultValue: "Scan" })}
        </button>
      </div>
      {error && <p className="text-danger text-xs mt-1">{error}</p>}
    </form>
  );
}

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
  onBack,
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
  const isCoinJoin = result.findings.some(isCoinJoinFinding);
  const fingerprintFinding = result.findings.find((f) => f.id === "h11-wallet-fingerprint");
  const detectedWallet = fingerprintFinding?.params?.walletGuess as string | undefined;
  const [queryCopied, setQueryCopied] = useState(false);
  const [cjLinkabilityView, setCjLinkabilityView] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimerRef.current), []);
  // Reset CJ linkability view when query changes
  useEffect(() => { const t = setTimeout(() => setCjLinkabilityView(false), 0); return () => clearTimeout(t); }, [query]);

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

  // Trace layers are passed directly to GraphExplorerPanel for multi-hop pre-population

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
      className="flex flex-col items-center gap-5 sm:gap-6 w-full max-w-3xl lg:max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px]"
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

      {/* === TWO-COLUMN DASHBOARD (xl+: main + sidebar) === */}
      <div className="w-full flex flex-col xl:flex-row xl:gap-8 xl:items-start gap-5 sm:gap-6">

      {/* -- MAIN CONTENT COLUMN (first in DOM = left on desktop, top on mobile) -- */}
      <div className="w-full xl:flex-1 xl:min-w-0 flex flex-col gap-5 sm:gap-6">

      {/* Hero info card (in left column) */}
      <GlowCard className="w-full p-4 sm:p-5 space-y-4">
        <div className="space-y-1">
          <button
            onClick={() => {
              copyToClipboard(query);
              setQueryCopied(true);
              clearTimeout(copyTimerRef.current);
              copyTimerRef.current = setTimeout(() => setQueryCopied(false), 2000);
            }}
            className="inline-flex items-start gap-2 font-mono text-sm text-foreground/90 break-all leading-relaxed text-left hover:text-foreground transition-colors cursor-pointer group/copy"
            title={t("common.copy", { defaultValue: "Copy" })}
            aria-label={t("common.copyToClipboard", { defaultValue: "Copy to clipboard" })}
          >
            <span className="break-all">{query}</span>
            {queryCopied ? (
              <Check size={14} className="shrink-0 mt-1 text-severity-good" />
            ) : (
              <Copy size={14} className="shrink-0 mt-1 text-muted opacity-0 group-hover/copy:opacity-100 transition-opacity" />
            )}
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            {inputType === "txid" && result.txType && result.txType !== "simple-payment" && result.txType !== "unknown" && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded border border-card-border bg-surface-elevated text-muted">
                {TX_TYPE_LABELS[result.txType] ?? result.txType.replace(/-/g, " ")}
              </span>
            )}
            {inputType === "address" && <AddressTypeBadge address={query} />}
            {inputType === "txid" && txData?.status?.confirmed && txData.status.block_height != null && (
              <span className="text-xs text-muted flex items-center gap-2">
                <span>
                  {t("results.blockHeight", {
                    height: txData.status.block_height.toLocaleString(),
                    defaultValue: "Block #{{height}}",
                  })}
                </span>
                {txData.status.block_time != null && (
                  <>
                    <span className="text-foreground/20">|</span>
                    <span>{new Date(txData.status.block_time * 1000).toLocaleString()}</span>
                  </>
                )}
              </span>
            )}
            {inputType === "txid" && txData && !txData.status?.confirmed && (
              <span className="text-xs text-severity-medium">{t("results.unconfirmed", { defaultValue: "Unconfirmed (mempool)" })}</span>
            )}
          </div>
        </div>

        {/* Score display - mobile only (desktop shows in sidebar) */}
        <div className="border-t border-card-border pt-4 xl:hidden">
          <div className="flex items-center justify-center gap-6">
            <ScoreDisplay score={result.score} grade={result.grade} findings={result.findings} />
          </div>
        </div>
      </GlowCard>

      {/* Transaction Structure (full width) */}
      {txData && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.16 }} className="w-full">
          <ChartErrorBoundary>
            <Suspense fallback={null}>
              {result.findings.some((f) => isCoinJoinFinding(f) && f.scoreImpact >= 15) && !cjLinkabilityView ? (
                <CoinJoinStructure tx={txData} findings={result.findings} onAddressClick={onScan} usdPrice={usdPrice} outspends={outspends}
                  linkabilityAvailable={boltzmannResult != null}
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
      {issues.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }} className="w-full space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-base font-medium text-muted uppercase tracking-wider">
              {t("results.findingsHeading", { count: visibleFindings.length, defaultValue: "Findings ({{count}})" })}
            </h2>
            <FindingSummary findings={visibleFindings} />
          </div>
          <div className="space-y-3">
            {issues.map((finding, i) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                index={i}
                defaultExpanded={finding.severity === "critical" || (finding.severity === "high" && !issues.some(f => f.severity === "critical"))}
                badge={CHAIN_FINDING_IDS.has(finding.id) ? t("results.chainBadge", { defaultValue: "Chain" }) : undefined}
                onTxClick={onScan}
              />
            ))}
          </div>
        </motion.div>
      )}

      {/* Deep Analysis (txid only) */}
      {inputType === "txid" && (
        <>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.42 }} className="w-full">
            <ChartErrorBoundary>
              <Suspense fallback={null}>
                <TaintPathDiagram findings={result.findings} backwardLayers={backwardLayers} forwardLayers={forwardLayers} onTxClick={onScan} />
              </Suspense>
            </ChartErrorBoundary>
          </motion.div>
          {txData && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.43 }} className="w-full">
              <ChartErrorBoundary>
                <Suspense fallback={null}>
                  <LinkabilityHeatmap tx={txData} boltzmannResult={boltzmannResult} />
                </Suspense>
              </ChartErrorBoundary>
            </motion.div>
          )}
          {txData && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.45 }} className="w-full">
              <ChartErrorBoundary>
                <Suspense fallback={null}>
                  <GraphExplorerPanel tx={txData} findings={result.findings} onTxClick={onScan} backwardLayers={backwardLayers} forwardLayers={forwardLayers} outspends={outspends} boltzmannResult={boltzmannResult} />
                </Suspense>
              </ChartErrorBoundary>
            </motion.div>
          )}
        </>
      )}

      {/* ZONE 12: Address Deep-Dive (address only) */}
      {inputType === "address" && (
        <>
          {addressUtxos && addressUtxos.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.42 }} className="w-full">
              <ChartErrorBoundary><Suspense fallback={null}><UtxoBubbleChart utxos={addressUtxos} /></Suspense></ChartErrorBoundary>
            </motion.div>
          )}
          {txBreakdown && txBreakdown.length >= 2 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.44 }} className="w-full">
              <ChartErrorBoundary><Suspense fallback={null}><PrivacyTimeline breakdown={txBreakdown} onScan={onScan} /></Suspense></ChartErrorBoundary>
            </motion.div>
          )}
          {addressTxs && addressTxs.length >= 3 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.46 }} className="w-full">
              <GlowCard className="p-5 sm:p-6">
                <Suspense fallback={null}>
                  <ChartErrorBoundary><FingerprintTimeline address={query} txs={addressTxs} onScan={onScan} /></ChartErrorBoundary>
                </Suspense>
              </GlowCard>
            </motion.div>
          )}
          {txBreakdown && txBreakdown.length > 0 && addressData && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.48 }} className="w-full">
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

      </div>{/* end main content column */}

      {/* -- SIDEBAR (second in DOM = right on desktop, bottom on mobile) -- */}
      <div className="w-full xl:w-[380px] 2xl:w-[420px] xl:shrink-0 flex flex-col gap-5 sm:gap-6">

      {/* Score display */}
      <GlowCard className="w-full p-4 sm:p-5">
        <div className="flex items-center justify-center gap-6">
          <ScoreDisplay score={result.score} grade={result.grade} findings={result.findings} />
          {result.findings.length > 3 && (
            <ChartErrorBoundary><Suspense fallback={null}><SeverityRing findings={result.findings} size={120} /></Suspense></ChartErrorBoundary>
          )}
        </div>
      </GlowCard>

      {/* Alerts */}
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

      {/* Recommendations */}
      <div className="w-full flex flex-col gap-3 sm:gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }} className="w-full">
          <PrimaryRecommendation
            findings={result.findings}
            grade={result.grade}
            walletGuess={detectedWallet ?? null}
          />
        </motion.div>
        {devMode && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.12 }} className="w-full">
            <Remediation findings={result.findings} grade={result.grade} />
          </motion.div>
        )}
        {devMode && (result.grade === "D" || result.grade === "F") && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.14 }} className="w-full">
            <RecoveryFlow grade={result.grade} />
          </motion.div>
        )}
      </div>

      {/* Additional findings, strengths, score waterfall (sidebar) */}
      {details.length > 0 && (
        <FindingsTier
          findings={details}
          label={t("results.additionalFindings", { count: details.length, defaultValue: "Additional findings ({{count}})" })}
          defaultOpen={false}
          grade={result.grade}
          delay={0.25}
          onTxClick={onScan}
        />
      )}

      {strengths.length > 0 && (
        <FindingsTier
          findings={strengths}
          label={t("results.privacyStrengths", { count: strengths.length, defaultValue: "Privacy strengths ({{count}})" })}
          defaultOpen={false}
          grade={result.grade}
          delay={0.3}
          onTxClick={onScan}
        />
      )}

      {result.findings.some((f) => f.scoreImpact !== 0) && (
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
      <div className="w-full flex flex-col gap-3 sm:gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.52 }} className="w-full">
          <CexRiskPanel
            query={query}
            inputType={inputType}
            txData={txData}
            isCoinJoin={isCoinJoin}
          />
        </motion.div>
        {isCoinJoin && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.54 }} className="w-full">
            <ExchangeWarningPanel />
          </motion.div>
        )}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.56 }} className="w-full">
          <CommonMistakes findings={result.findings} grade={result.grade} />
        </motion.div>
      </div>

      {/* ZONE 14: Diagnostics (sidebar) */}
      {inputType === "txid" && result.findings.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.58 }} className="w-full">
          <AnalystView findings={result.findings} grade={result.grade} />
        </motion.div>
      )}

      </div>{/* end sidebar */}

      </div>{/* end two-column wrapper */}

      {/* ZONE 16: Footer */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.65 }} className="w-full space-y-2 pb-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <ScoringExplainer isAddress={inputType === "address"} />
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-bitcoin hover:text-bitcoin-hover transition-colors"
          >
            {explorerLabel}
            <ExternalLink size={12} />
          </a>
        </div>

        <p className="text-xs text-muted/70 leading-relaxed">
          {t("results.disclaimerStats", {
            findingCount: result.findings.length,
            heuristicCount: inputType === "txid" ? "31" : "6",
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
                : (() => { try { return new URL(config.mempoolBaseUrl).hostname; } catch { return "custom API"; } })(),
            defaultValue: "API queries were sent to {{hostname}}.",
          })}{" "}
          {t("results.disclaimerHeuristic", { defaultValue: "Scores are heuristic-based estimates, not definitive privacy assessments." })}
        </p>
      </motion.div>
    </motion.div>
  );
});
