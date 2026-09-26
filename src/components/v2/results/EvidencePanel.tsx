"use client";

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { ScoringResult } from "@/lib/types";
import type { MempoolTransaction, MempoolAddress, MempoolOutspend } from "@/lib/api/types";
import type { PreSendResult } from "@/lib/analysis/orchestrator";
import type { BoltzmannWorkerResult } from "@/hooks/useBoltzmann";
import type { ResultViewModel } from "@/lib/view/tx-view-model";
import type { RevealState } from "@/components/v2/scan/useRevealTimeline";
import { ChartErrorBoundary } from "@/components/ui/ChartErrorBoundary";
import { AddressSummary } from "@/components/AddressSummary";
import { DestinationAlert } from "@/components/DestinationAlert";
const TxStage = lazy(() => import("@/components/v2/stage/TxStage").then((m) => ({ default: m.TxStage })));

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
    <section id="v2-evidence" aria-labelledby="v2-evidence-title" className="space-y-4">
      <div>
        <p className="v2-eyebrow mb-2">{inputType === "txid" ? t("v2.results.evidenceTxEyebrow", { defaultValue: "Transaction" }) : t("v2.results.evidenceAddrEyebrow", { defaultValue: "Address" })}</p>
        <h2 id="v2-evidence-title" className="text-xl font-semibold tracking-tight">
          {inputType === "txid"
            ? t("v2.results.evidenceTxTitle", { defaultValue: "What moved, and what it reveals" })
            : t("v2.results.evidenceAddrTitle", { defaultValue: "What this address holds and reveals" })}
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
