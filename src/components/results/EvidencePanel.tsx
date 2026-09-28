"use client";

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { ScoringResult } from "@/lib/types";
import type { MempoolTransaction, MempoolAddress, MempoolOutspend } from "@/lib/api/types";
import type { PreSendResult } from "@/lib/analysis/orchestrator";
import type { BoltzmannWorkerResult } from "@/hooks/useBoltzmann";
import type { ResultViewModel } from "@/lib/view/tx-view-model";
import type { RevealState } from "@/components/scan/useRevealTimeline";
import { ChartErrorBoundary } from "@/components/ui/ChartErrorBoundary";
import { AddressSummary } from "@/components/AddressSummary";
import { DestinationAlert } from "@/components/DestinationAlert";
const TxStage = lazy(() => import("@/components/stage/TxStage").then((m) => ({ default: m.TxStage })));

interface EvidencePanelProps {
  inputType: "txid" | "address";
  vm: ResultViewModel;
  result: ScoringResult;
  txData: MempoolTransaction | null;
  addressData: MempoolAddress | null;
  preSendResult?: PreSendResult | null;
  usdPrice?: number | null;
  outspends?: MempoolOutspend[] | null;
  boltzmannResult?: BoltzmannWorkerResult | null;
  onScan: (input: string) => void;
  onFindingClick: (id: string) => void;
  highlightId: string | null;
  reveal: RevealState;
}

/** L1: the transaction (or address) the findings are about. */
export function EvidencePanel({ inputType, vm, result, txData, addressData, preSendResult, usdPrice, outspends, boltzmannResult, onScan, onFindingClick, highlightId, reveal }: EvidencePanelProps) {
  const { t } = useTranslation();

  return (
    <section id="evidence" aria-labelledby="evidence-title" className="space-y-4">
      <div>
        <p className="eyebrow mb-2">{inputType === "txid" ? t("results.evidenceTxEyebrow", { defaultValue: "Transaction" }) : t("results.evidenceAddrEyebrow", { defaultValue: "Address" })}</p>
        <h2 id="evidence-title" className="text-xl font-semibold tracking-tight">
          {inputType === "txid"
            ? t("results.evidenceTxTitle", { defaultValue: "What moved, and what it reveals" })
            : t("results.evidenceAddrTitle", { defaultValue: "What this address holds and reveals" })}
        </h2>
      </div>

      {txData && (
        <ChartErrorBoundary>
          <Suspense fallback={<div className="h-72 rounded-xl bg-surface-1 animate-pulse" />}>
            <TxStage
              tx={txData}
              vm={vm}
              outspends={outspends}
              usdPrice={usdPrice}
              boltzmannResult={boltzmannResult}
              onAddressClick={onScan}
              onTxClick={onScan}
              onFindingClick={onFindingClick}
              highlightFindingId={highlightId}
              reveal={{ isRevealed: reveal.isRevealed, playing: reveal.playing }}
            />
          </Suspense>
        </ChartErrorBoundary>
      )}

      {addressData && <AddressSummary address={addressData} findings={result.findings} />}
      {inputType === "address" && preSendResult && <DestinationAlert preSendResult={preSendResult} />}
    </section>
  );
}
