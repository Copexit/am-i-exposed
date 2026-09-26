"use client";

import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { ScoringResult, TxAnalysisResult } from "@/lib/types";
import type { MempoolTransaction, MempoolAddress, MempoolUtxo, MempoolOutspend } from "@/lib/api/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import type { BoltzmannWorkerResult } from "@/hooks/useBoltzmann";
import { ChartErrorBoundary } from "@/components/ui/ChartErrorBoundary";
import { DeepAnalysisTxid } from "@/components/results/DeepAnalysisTxid";
import { DeepAnalysisAddress } from "@/components/results/DeepAnalysisAddress";
const WIDE = "(min-width: 768px)";
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const GraphExplorerPanel = lazy(() => import("@/components/GraphExplorerPanel").then((m) => ({ default: m.GraphExplorerPanel })));

interface AnalystWorkspaceProps {
  query: string;
  inputType: "txid" | "address";
  result: ScoringResult;
  txData: MempoolTransaction | null;
  addressData: MempoolAddress | null;
  addressTxs: MempoolTransaction[] | null;
  addressUtxos?: MempoolUtxo[] | null;
  txBreakdown: TxAnalysisResult[] | null;
  outspends?: MempoolOutspend[] | null;
  backwardLayers?: TraceLayer[] | null;
  forwardLayers?: TraceLayer[] | null;
  boltzmannResult?: BoltzmannWorkerResult | null;
  onScan: (input: string) => void;
}

/** L3: the analyst workspace. Every tool classic reserved for Cypherpunk mode, for everyone. */
export function AnalystWorkspace(p: AnalystWorkspaceProps) {
  const { t } = useTranslation();
  const hasTx = p.inputType === "txid" && !!p.txData;
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true);
  const [openedGraph, setOpenedGraph] = useState(false);
  const showGraph = wide || openedGraph;
  if (!hasTx && p.inputType !== "address") return null;

  return (
    <section id="v2-analyst" aria-labelledby="v2-analyst-title" className="space-y-6 pt-10 border-t border-hairline">
      <div>
        <p className="v2-eyebrow mb-2">{t("v2.results.analystEyebrow", { defaultValue: "Analyst tools" })}</p>
        <h2 id="v2-analyst-title" className="text-xl font-semibold tracking-tight">
          {hasTx
            ? t("v2.results.analystTxTitle", { defaultValue: "Follow the coins" })
            : t("v2.results.analystAddrTitle", { defaultValue: "History, UTXOs and clustering" })}
        </h2>
        <p className="text-sm text-muted mt-1 max-w-[70ch]">
          {hasTx
            ? t("v2.results.analystTxSub", { defaultValue: "Expand the transaction graph hop by hop, trace change, compute linkability and follow taint to known entities." })
            : t("v2.results.analystAddrSub", { defaultValue: "Per-transaction grades over time, wallet fingerprint history, UTXOs and the cluster this address belongs to." })}
        </p>
      </div>

      {hasTx && p.txData && (
        <>
          {showGraph ? (
            <ChartErrorBoundary>
              <Suspense fallback={<div className="h-96 rounded-xl bg-surface-1 animate-pulse" />}>
                <GraphExplorerPanel tx={p.txData} onTxClick={p.onScan} backwardLayers={p.backwardLayers} forwardLayers={p.forwardLayers} outspends={p.outspends} boltzmannResult={p.boltzmannResult} />
              </Suspense>
            </ChartErrorBoundary>
          ) : (
            // Phones: the explorer is a desktop-scale canvas, opened on demand.
            <button
              type="button"
              onClick={() => setOpenedGraph(true)}
              className="w-full flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surface-1 px-4 min-h-[56px] text-left text-sm text-foreground hover:border-hairline-strong transition-colors"
            >
              {t("v2.results.openGraph", { defaultValue: "Open the transaction graph explorer" })}
              <span aria-hidden="true" className="text-bitcoin">→</span>
            </button>
          )}
          <DeepAnalysisTxid result={p.result} txData={p.txData} onScan={p.onScan} backwardLayers={p.backwardLayers} forwardLayers={p.forwardLayers} boltzmannResult={p.boltzmannResult} />
        </>
      )}

      {p.inputType === "address" && (
        <DeepAnalysisAddress
          query={p.query}
          addressUtxos={p.addressUtxos}
          txBreakdown={p.txBreakdown}
          addressTxs={p.addressTxs}
          addressData={p.addressData}
          onScan={p.onScan}
          proMode
        />
      )}
    </section>
  );
}
