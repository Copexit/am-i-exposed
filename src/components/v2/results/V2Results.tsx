"use client";

import { useCallback, useMemo, useState, lazy, Suspense } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { ScoringResult, TxAnalysisResult } from "@/lib/types";
import type { MempoolTransaction, MempoolAddress, MempoolUtxo, MempoolOutspend } from "@/lib/api/types";
import type { PreSendResult } from "@/lib/analysis/orchestrator";
import { getTxHeuristicSteps, getAddressHeuristicSteps } from "@/lib/analysis/orchestrator";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import type { BoltzmannWorkerResult } from "@/hooks/useBoltzmann";
import { TX_BASE_SCORE, ADDRESS_BASE_SCORE } from "@/lib/scoring/score";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { buildResultViewModel } from "@/lib/view/tx-view-model";
import { useNetwork } from "@/context/NetworkContext";
import { useDevMode } from "@/hooks/useDevMode";
import { InlineSearchBar } from "@/components/results/InlineSearchBar";
import { ResultsFooter } from "@/components/results/ResultsFooter";
import { useRevealTimeline } from "@/components/v2/scan/useRevealTimeline";
import { VerdictBand } from "./VerdictBand";
import { ResultActions } from "./ResultActions";
import { SectionNav } from "./SectionNav";
import { TipRow } from "./TipRow";
import { FindingsList } from "./FindingsList";
import { EvidencePanel } from "./EvidencePanel";
import { ExplainRail } from "./ExplainRail";
import { AnalystWorkspace } from "./AnalystWorkspace";
import { ContextSection } from "./ContextSection";
const V2PsbtBanner = lazy(() => import("@/components/v2/flows/V2PsbtBanner").then((m) => ({ default: m.V2PsbtBanner })));

export interface V2ResultsProps {
  query: string;
  inputType: "txid" | "address";
  result: ScoringResult;
  txData: MempoolTransaction | null;
  addressData: MempoolAddress | null;
  addressTxs: MempoolTransaction[] | null;
  addressUtxos?: MempoolUtxo[] | null;
  txBreakdown: TxAnalysisResult[] | null;
  preSendResult?: PreSendResult | null;
  onScan: (input: string) => void;
  onBack: () => void;
  durationMs?: number | null;
  usdPrice?: number | null;
  outspends?: MempoolOutspend[] | null;
  backwardLayers?: TraceLayer[] | null;
  forwardLayers?: TraceLayer[] | null;
  boltzmannResult?: BoltzmannWorkerResult | null;
  /** Play the Reveal (fresh scans); false for cached results. */
  reveal: boolean;
  /** PSBT scans: shown as a banner above the verdict. */
  psbt?: { inputCount: number; outputCount: number; fee: number; feeRate: number; complete: boolean } | null;
}

const entityName = (address: string) => matchEntitySync(address)?.entityName ?? null;

/**
 * v2 results: one progressive layout for everyone.
 * L0 verdict, L1 evidence (transaction + findings), L2 explain rail,
 * L3 analyst workspace. Everything reads from one view model.
 */
export function V2Results(props: V2ResultsProps) {
  const {
    query, inputType, result, txData, addressData, addressTxs, addressUtxos, txBreakdown,
    preSendResult, onScan, onBack, durationMs, usdPrice, outspends, backwardLayers,
    forwardLayers, boltzmannResult, reveal, psbt,
  } = props;
  const { t } = useTranslation();
  const { config, customApiUrl, isUmbrel } = useNetwork();
  const { devMode } = useDevMode();

  const baseScore = inputType === "address" ? ADDRESS_BASE_SCORE : TX_BASE_SCORE;
  const vm = useMemo(
    () => buildResultViewModel({ result, baseScore, tx: txData, outspends, entityName }),
    [result, baseScore, txData, outspends],
  );
  const checkCount = useMemo(
    () => (inputType === "address" ? getAddressHeuristicSteps() : getTxHeuristicSteps()).length,
    [inputType],
  );
  const timeline = useRevealTimeline(vm.waterfall, checkCount, { enabled: reveal });

  // Cross-highlighting between stage, waterfall, matrix and findings.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(
    () => new Set(vm.groups.leaks.slice(0, 1).map((f) => f.id as string)),
  );
  const toggle = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const openFinding = useCallback((id: string) => {
    setOpenIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    // Wait a frame so a collapsed group can open before scrolling.
    requestAnimationFrame(() => {
      document.querySelector(`#v2-findings [data-finding-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  const explorerUrl = `${config.explorerUrl}/${inputType === "txid" ? "tx" : "address"}/${encodeURIComponent(query)}`;
  const explorerLabel = customApiUrl
    ? t("results.viewOnCustom", { hostname: new URL(config.explorerUrl).hostname, defaultValue: "View on {{hostname}}" })
    : isUmbrel
      ? t("results.viewOnLocal", { defaultValue: "View on local mempool" })
      : t("results.viewOnMempool", { defaultValue: "View on mempool.space" });

  const settled = !timeline.playing;

  return (
    <motion.div
      data-testid="results-panel"
      id="results-panel"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="w-full"
    >
      <div className="mx-auto w-full max-w-[1360px] px-4 sm:px-6 lg:px-8 pt-5 pb-16 space-y-10">
        {/* Rescan + actions */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors self-start lg:self-auto min-h-[44px]"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            {t("v2.results.newScan", { defaultValue: "New scan" })}
          </button>
          <div className="flex-1 min-w-0"><InlineSearchBar onScan={onScan} initialValue={query} /></div>
          <ResultActions query={query} inputType={inputType} result={result} vm={vm} />
        </div>

        {psbt && <Suspense fallback={null}><V2PsbtBanner {...psbt} /></Suspense>}

        <VerdictBand query={query} inputType={inputType} vm={vm} txData={txData} reveal={timeline} checkCount={checkCount} onRetry={() => onScan(query)} />

        <SectionNav hasAnalyst={inputType === "txid" ? !!txData : true} inputType={inputType} grade={vm.grade} score={vm.score} />

        <div className="grid gap-10 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] items-start">
          <div className="min-w-0 space-y-10">
            <EvidencePanel
              inputType={inputType}
              vm={vm}
              result={result}
              txData={txData}
              addressData={addressData}
              preSendResult={preSendResult}
              usdPrice={usdPrice}
              outspends={outspends}
              boltzmannResult={boltzmannResult}
              onScan={onScan}
              onFindingClick={openFinding}
              highlightId={hoverId}
              reveal={timeline}
            />
            <motion.div initial={false} animate={{ opacity: settled ? 1 : 0.35 }} transition={{ duration: 0.4 }}>
              <FindingsList
                visible={vm.visible}
                openIds={openIds}
                onToggle={toggle}
                highlightId={hoverId}
                onHover={setHoverId}
                onTxClick={onScan}
              />
            </motion.div>
          </div>
          <ExplainRail
            vm={vm}
            isRevealed={timeline.isRevealed}
            highlightId={hoverId}
            onHover={setHoverId}
            onOpen={openFinding}
          />
        </div>

        <AnalystWorkspace
          query={query}
          inputType={inputType}
          result={result}
          txData={txData}
          addressData={addressData}
          addressTxs={addressTxs}
          addressUtxos={addressUtxos}
          txBreakdown={txBreakdown}
          outspends={outspends}
          backwardLayers={backwardLayers}
          forwardLayers={forwardLayers}
          boltzmannResult={boltzmannResult}
          onScan={onScan}
        />

        <ContextSection query={query} inputType={inputType} vm={vm} txData={txData} devMode={devMode} />

        <ResultsFooter
          inputType={inputType}
          result={result}
          txBreakdown={txBreakdown}
          durationMs={durationMs}
          explorerUrl={explorerUrl}
          explorerLabel={explorerLabel}
          mempoolBaseUrl={config.mempoolBaseUrl}
          findingCount={vm.visible.length}
          checkCount={checkCount}
        />
        <TipRow />
      </div>
    </motion.div>
  );
}
