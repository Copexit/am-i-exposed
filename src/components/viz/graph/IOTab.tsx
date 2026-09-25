"use client";

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { isCoinJoinTx } from "@/lib/analysis/heuristics/coinjoin";
import { probColor } from "../shared/linkabilityColors";
import { analyzeChangeDetection } from "@/lib/analysis/heuristics/change-detection";
import { InputRow, OutputRow } from "./OutputRow";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import { isOpReturnOutput } from "@/lib/analysis/heuristics/tx-utils";

export interface IOTabProps {
  tx: MempoolTransaction;
  outspends?: MempoolOutspend[];
  onExpandInput?: (txid: string, inputIndex: number) => void;
  onExpandOutput?: (txid: string, outputIndex: number) => void;
  changeOutputs: Set<string>;
  onToggleChange: (txid: string, outputIndex: number) => void;
  boltzmannResult?: BoltzmannWorkerResult | null;
  computingBoltzmann?: boolean;
  boltzmannProgress?: number;
  onComputeBoltzmann?: () => void;
  onAutoTrace?: (txid: string, outputIndex: number) => void;
  onAutoTraceLinkability?: (txid: string, outputIndex: number) => void;
  autoTracing?: boolean;
  autoTraceProgress?: { hop: number; txid: string; reason: string } | null;
}

export function IOTab({
  tx,
  outspends,
  onExpandInput,
  onExpandOutput,
  changeOutputs,
  onToggleChange,
  boltzmannResult,
  computingBoltzmann,
  boltzmannProgress,
  onComputeBoltzmann,
  onAutoTrace,
  onAutoTraceLinkability,
  autoTracing,
  autoTraceProgress,
}: IOTabProps) {
  const { t } = useTranslation();
  const mat = boltzmannResult?.matLnkProbabilities;
  const detLinks = boltzmannResult?.deterministicLinks;

  // Per-input-output probability drill-down
  const [selectedInputIdx, setSelectedInputIdx] = useState<number | null>(null);

  // Change detection auto-suggestion
  const suggestedChangeIndices = useMemo(() => {
    const indices = new Set<number>();
    const result = analyzeChangeDetection(tx);
    for (const finding of result.findings) {
      if (finding.id === "h2-change-detected" && finding.params) {
        const idx = finding.params.changeIndex;
        if (typeof idx === "number") indices.add(idx);
      }
      if ((finding.id === "h2-same-address-io" || finding.id === "h2-self-send") && finding.params) {
        const indicesStr = finding.params.selfSendIndices;
        if (typeof indicesStr === "string" && indicesStr.length > 0) {
          for (const s of indicesStr.split(",")) {
            const n = parseInt(s, 10);
            if (!isNaN(n)) indices.add(n);
          }
        }
      }
    }
    return indices;
  }, [tx]);

  // Count expandable inputs/outputs for bulk expand
  const expandableInputs = useMemo(() => {
    return tx.vin.flatMap((v, i) => (v.is_coinbase ? [] : [i]));
  }, [tx]);

  const expandableOutputs = useMemo(() => {
    return tx.vout.flatMap((v, i) => {
      if (isOpReturnOutput(v) || v.value === 0) return [];
      const os = outspends?.[i];
      if (os && os.spent === false) return [];
      return [i];
    });
  }, [tx, outspends]);

  const nonCoinbaseInputCount = tx.vin.filter((v) => !v.is_coinbase).length;
  const canComputeBoltzmann = !boltzmannResult && !computingBoltzmann && nonCoinbaseInputCount >= 2;

  return (
    <div className="p-2 space-y-3">
      {/* Auto-trace progress */}
      {autoTracing && autoTraceProgress && (
        <div className="flex items-center gap-2 px-1 py-1 rounded bg-bitcoin/10 border border-bitcoin/20">
          <div className="w-3 h-3 border-2 border-bitcoin/40 border-t-bitcoin rounded-full animate-spin shrink-0" />
          <span className="text-xs text-bitcoin">
            {t("graph.ioTab.tracingHop", { hop: autoTraceProgress.hop, defaultValue: "Tracing hop {{hop}}..." })}
            {autoTraceProgress.reason !== "expanding" && autoTraceProgress.reason !== "starting" && (
              <span className="text-muted ml-1">({autoTraceProgress.reason})</span>
            )}
          </span>
        </div>
      )}

      {/* Boltzmann summary (when available) */}
      {boltzmannResult && (
        <div className="flex flex-wrap gap-1.5 px-1">
          <span className="text-xs px-1.5 py-0.5 rounded bg-foreground/10 text-muted">
            {boltzmannResult.entropy.toFixed(2)} {t("graph.ioTab.bits", { defaultValue: "bits" })}
          </span>
          {isCoinJoinTx(tx) && boltzmannResult.efficiency > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-foreground/10 text-muted">
              {Math.round(Math.min(boltzmannResult.efficiency, 1) * 100)}% {t("graph.ioTab.efficiency", { defaultValue: "efficiency" })}
            </span>
          )}
          {boltzmannResult.deterministicLinks.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-severity-critical/15 text-severity-critical">
              {boltzmannResult.deterministicLinks.length} {t("graph.ioTab.deterministic", { defaultValue: "deterministic" })}
            </span>
          )}
          <span className="text-xs px-1.5 py-0.5 rounded bg-foreground/10 text-muted">
            {boltzmannResult.nbCmbn.toLocaleString("en-US")} {t("graph.ioTab.interpretations", { defaultValue: "interpretations" })}
          </span>
        </div>
      )}
      {/* Boltzmann computing indicator */}
      {computingBoltzmann && (
        <div className="flex items-center gap-2 px-1">
          <div className="w-3 h-3 border-2 border-bitcoin/40 border-t-bitcoin rounded-full animate-spin" />
          <span className="text-xs text-muted">
            {t("graph.ioTab.computingLinkability", { defaultValue: "Computing linkability" })}{boltzmannProgress != null ? ` (${Math.round(boltzmannProgress * 100)}%)` : "..."}
          </span>
        </div>
      )}
      {/* Compute button for eligible non-auto txs */}
      {canComputeBoltzmann && onComputeBoltzmann && (
        <button
          onClick={onComputeBoltzmann}
          className="w-full text-xs text-center py-1.5 rounded border border-card-border text-muted hover:text-foreground hover:border-muted transition-colors cursor-pointer"
        >
          {t("graph.ioTab.computeLinkability", { inputs: nonCoinbaseInputCount, outputs: tx.vout.length, defaultValue: "Compute Linkability ({{inputs}}in / {{outputs}}out)" })}
        </button>
      )}

      {/* Inputs */}
      <div>
        <div className="flex items-center justify-between px-1 mb-1">
          <span className="text-xs font-medium text-muted">{t("graph.ioTab.inputsCount", { count: tx.vin.length, defaultValue: "Inputs ({{count}})" })}</span>
          {onExpandInput && expandableInputs.length > 0 && (
            <button
              onClick={() => { expandableInputs.slice(0, 5).forEach((i) => onExpandInput(tx.txid, i)); }}
              className="text-xs text-muted/70 hover:text-foreground transition-colors cursor-pointer"
              title={t("graph.ioTab.expandFirst5Inputs", { defaultValue: "Expand first 5 unresolved inputs" })}
            >
              {t("graph.ioTab.expandAll", { defaultValue: "Expand all" })}
            </button>
          )}
        </div>
        <div className="space-y-0.5">
          {tx.vin.map((vin, i) => (
            <InputRow
              key={i}
              vin={vin}
              index={i}
              txid={tx.txid}
              mat={mat}
              detLinks={detLinks}
              selectedInputIdx={selectedInputIdx}
              onSelectInput={setSelectedInputIdx}
              onExpandInput={onExpandInput}
            />
          ))}
        </div>
      </div>

      {/* Per-input linkability breakdown */}
      {selectedInputIdx !== null && mat && (
        <div className="mx-1 p-1.5 rounded bg-foreground/5 border border-card-border">
          <div className="text-xs text-muted mb-1">
            {t("graph.ioTab.linkabilityBreakdown", { idx: selectedInputIdx, defaultValue: "Input #{{idx}} linkability to each output:" })}
          </div>
          <div className="space-y-0.5">
            {tx.vout.map((_vout, oi) => {
              const prob = mat[oi]?.[selectedInputIdx] ?? 0;
              const isDet = detLinks?.some(([o, inp]) => o === oi && inp === selectedInputIdx);
              return (
                <div key={oi} className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted/70 w-4 text-right shrink-0">#{oi}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-foreground/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${prob * 100}%`, backgroundColor: probColor(prob) }}
                    />
                  </div>
                  <span className={`w-8 text-right tabular-nums shrink-0 ${isDet ? "text-severity-critical font-bold" : "text-muted"}`}>
                    {prob > 0 ? `${Math.round(prob * 100)}%` : "-"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Outputs */}
      <div>
        <div className="flex items-center justify-between px-1 mb-1">
          <span className="text-xs font-medium text-muted">{t("graph.ioTab.outputsCount", { count: tx.vout.length, defaultValue: "Outputs ({{count}})" })}</span>
          <div className="flex items-center gap-1.5">
            {onAutoTrace && !autoTracing && (
              <button
                onClick={() => {
                  const changeIdx = tx.vout.findIndex((_, i) => changeOutputs.has(`${tx.txid}:${i}`));
                  const targetIdx = changeIdx >= 0 ? changeIdx : expandableOutputs[0];
                  if (targetIdx !== undefined) onAutoTrace(tx.txid, targetIdx);
                }}
                className="text-xs text-bitcoin/50 hover:text-bitcoin transition-colors cursor-pointer"
                title={t("graph.ioTab.traceTooltip", { defaultValue: "Auto-trace: follow change outputs forward" })}
              >
                {t("graph.ioTab.trace", { defaultValue: "Trace" })}
              </button>
            )}
            {onAutoTraceLinkability && !autoTracing && (
              <button
                onClick={() => {
                  const changeIdx = tx.vout.findIndex((_, i) => changeOutputs.has(`${tx.txid}:${i}`));
                  const targetIdx = changeIdx >= 0 ? changeIdx : expandableOutputs[0];
                  if (targetIdx !== undefined) onAutoTraceLinkability(tx.txid, targetIdx);
                }}
                className="text-xs text-severity-low/60 hover:text-severity-low transition-colors cursor-pointer"
                title={t("graph.ioTab.linkTraceTooltip", { defaultValue: "Linkability trace: follow until compound linkability < 5%" })}
              >
                {t("graph.ioTab.linkTrace", { defaultValue: "Link trace" })}
              </button>
            )}
            {onExpandOutput && expandableOutputs.length > 0 && (
              <button
                onClick={() => { expandableOutputs.slice(0, 5).forEach((i) => onExpandOutput(tx.txid, i)); }}
                className="text-xs text-muted/70 hover:text-foreground transition-colors cursor-pointer"
                title={t("graph.ioTab.expandFirst5Outputs", { defaultValue: "Expand first 5 unresolved outputs" })}
              >
                {t("graph.ioTab.expandAll", { defaultValue: "Expand all" })}
              </button>
            )}
          </div>
        </div>
        <div className="space-y-0.5">
          {tx.vout.map((vout, i) => (
            <OutputRow
              key={i}
              vout={vout}
              index={i}
              txid={tx.txid}
              outspend={outspends?.[i]}
              isChange={changeOutputs.has(`${tx.txid}:${i}`)}
              suggestedChange={suggestedChangeIndices.has(i)}
              selectedInputIdx={selectedInputIdx}
              mat={mat}
              onToggleChange={onToggleChange}
              onExpandOutput={onExpandOutput}
              onAutoTrace={onAutoTrace}
              onAutoTraceLinkability={onAutoTraceLinkability}
              autoTracing={autoTracing}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
