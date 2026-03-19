"use client";

import { useState, useMemo } from "react";
import { SVG_COLORS } from "../shared/svgConstants";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { isCoinJoinTx } from "@/lib/analysis/heuristics/coinjoin";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { getScriptTypeColor } from "./scriptStyles";
import { probColor } from "../shared/linkabilityColors";
import { analyzeChangeDetection } from "@/lib/analysis/heuristics/change-detection";
import { CopyButton } from "@/components/ui/CopyButton";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

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
  const mat = boltzmannResult?.matLnkProbabilities;
  const detLinks = boltzmannResult?.deterministicLinks;

  // Per-input-output probability drill-down
  const [selectedInputIdx, setSelectedInputIdx] = useState<number | null>(null);

  // Change detection auto-suggestion
  // Collect all heuristic-suggested change output indices
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
    return tx.vin.reduce((acc, v, i) => {
      if (!v.is_coinbase) acc.push(i);
      return acc;
    }, [] as number[]);
  }, [tx]);

  const expandableOutputs = useMemo(() => {
    return tx.vout.reduce((acc, v, i) => {
      if (v.scriptpubkey_type !== "op_return" && v.value > 0) acc.push(i);
      return acc;
    }, [] as number[]);
  }, [tx]);

  const nonCoinbaseInputCount = tx.vin.filter((v) => !v.is_coinbase).length;
  const canComputeBoltzmann = !boltzmannResult && !computingBoltzmann && nonCoinbaseInputCount >= 2;

  return (
    <div className="p-2 space-y-3">
      {/* Auto-trace progress */}
      {autoTracing && autoTraceProgress && (
        <div className="flex items-center gap-2 px-1 py-1 rounded bg-bitcoin/10 border border-bitcoin/20">
          <div className="w-3 h-3 border-2 border-bitcoin/40 border-t-bitcoin rounded-full animate-spin shrink-0" />
          <span className="text-xs text-bitcoin">
            Tracing hop {autoTraceProgress.hop}...
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
            {boltzmannResult.entropy.toFixed(2)} bits
          </span>
          {isCoinJoinTx(tx) && boltzmannResult.efficiency > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-foreground/10 text-muted">
              {Math.round(Math.min(boltzmannResult.efficiency, 1) * 100)}% efficiency
            </span>
          )}
          {boltzmannResult.deterministicLinks.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-severity-critical/15 text-severity-critical">
              {boltzmannResult.deterministicLinks.length} deterministic
            </span>
          )}
          <span className="text-xs px-1.5 py-0.5 rounded bg-foreground/10 text-muted">
            {boltzmannResult.nbCmbn.toLocaleString("en-US")} interpretations
          </span>
        </div>
      )}
      {/* Boltzmann computing indicator */}
      {computingBoltzmann && (
        <div className="flex items-center gap-2 px-1">
          <div className="w-3 h-3 border-2 border-bitcoin/40 border-t-bitcoin rounded-full animate-spin" />
          <span className="text-xs text-muted">
            Computing linkability{boltzmannProgress != null ? ` (${Math.round(boltzmannProgress * 100)}%)` : "..."}
          </span>
        </div>
      )}
      {/* Compute button for eligible non-auto txs */}
      {canComputeBoltzmann && onComputeBoltzmann && (
        <button
          onClick={onComputeBoltzmann}
          className="w-full text-xs text-center py-1.5 rounded border border-card-border text-muted hover:text-foreground hover:border-muted transition-colors cursor-pointer"
        >
          Compute Linkability ({nonCoinbaseInputCount}in / {tx.vout.length}out)
        </button>
      )}

      {/* Inputs */}
      <div>
        <div className="flex items-center justify-between px-1 mb-1">
          <span className="text-xs font-medium text-muted">Inputs ({tx.vin.length})</span>
          {onExpandInput && expandableInputs.length > 0 && (
            <button
              onClick={() => { expandableInputs.slice(0, 5).forEach((i) => onExpandInput(tx.txid, i)); }}
              className="text-xs text-muted/70 hover:text-foreground transition-colors cursor-pointer"
              title="Expand first 5 unresolved inputs"
            >
              Expand all
            </button>
          )}
        </div>
        <div className="space-y-0.5">
          {tx.vin.map((vin, i) => {
            const addr = vin.is_coinbase ? "coinbase" : (vin.prevout?.scriptpubkey_address ?? "unknown");
            const value = vin.prevout?.value ?? 0;
            const scriptType = vin.prevout?.scriptpubkey_type ?? "unknown";
            const entity = !vin.is_coinbase && vin.prevout?.scriptpubkey_address
              ? matchEntitySync(vin.prevout.scriptpubkey_address) : null;

            return (
              <div key={i} className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-foreground/5 group">
                <span
                  className="w-1.5 h-4 rounded-sm shrink-0"
                  style={{ background: getScriptTypeColor(scriptType), opacity: 0.7 }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs text-foreground/70 truncate">
                      {vin.is_coinbase ? "coinbase" : truncateId(addr, 6)}
                    </span>
                    {!vin.is_coinbase && addr !== "unknown" && <CopyButton text={addr} variant="inline" />}
                  </div>
                  {entity && (
                    <div className="text-xs text-muted truncate">
                      <span style={{ color: SVG_COLORS.high }}>{entity.entityName}</span>
                      {entity.ofac && <span className="text-severity-critical ml-1">OFAC</span>}
                    </div>
                  )}
                </div>
                <span className="text-xs text-bitcoin/80 shrink-0 tabular-nums">{formatSats(value)}</span>
                {/* Linkability indicator - clickable to show per-output breakdown */}
                {mat && !vin.is_coinbase && (() => {
                  let maxP = 0;
                  for (let oi = 0; oi < mat.length; oi++) {
                    if (mat[oi]?.[i] !== undefined && mat[oi][i] > maxP) maxP = mat[oi][i];
                  }
                  if (maxP <= 0) return null;
                  const isDet = detLinks?.some(([, inIdx]) => inIdx === i);
                  const isSelected = selectedInputIdx === i;
                  return (
                    <button
                      className={`shrink-0 w-2.5 h-2.5 rounded-full cursor-pointer transition-all ${isSelected ? "ring-2 ring-foreground/40 scale-125" : ""}`}
                      style={{ backgroundColor: probColor(maxP), opacity: isDet ? 1 : 0.7 }}
                      title={`${Math.round(maxP * 100)}% max linkability${isDet ? " (deterministic)" : ""} - click to see per-output breakdown`}
                      onClick={(e) => { e.stopPropagation(); setSelectedInputIdx(isSelected ? null : i); }}
                    />
                  );
                })()}
                {onExpandInput && !vin.is_coinbase && (
                  <button
                    onClick={() => onExpandInput(tx.txid, i)}
                    className="opacity-0 group-hover:opacity-100 text-muted/60 hover:text-foreground transition-all cursor-pointer p-0.5"
                    title="Expand in graph"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-input linkability breakdown (shown when an input is selected) */}
      {selectedInputIdx !== null && mat && (
        <div className="mx-1 p-1.5 rounded bg-foreground/5 border border-card-border">
          <div className="text-xs text-muted mb-1">
            Input #{selectedInputIdx} linkability to each output:
          </div>
          <div className="space-y-0.5">
            {tx.vout.map((vout, oi) => {
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
          <span className="text-xs font-medium text-muted">Outputs ({tx.vout.length})</span>
          <div className="flex items-center gap-1.5">
            {/* Auto-trace from identified change output (section-level action) */}
            {onAutoTrace && !autoTracing && (
              <button
                onClick={() => {
                  // Find the first change-marked output, or first expandable output
                  const changeIdx = tx.vout.findIndex((_, i) => changeOutputs.has(`${tx.txid}:${i}`));
                  const targetIdx = changeIdx >= 0 ? changeIdx : expandableOutputs[0];
                  if (targetIdx !== undefined) onAutoTrace(tx.txid, targetIdx);
                }}
                className="text-xs text-bitcoin/50 hover:text-bitcoin transition-colors cursor-pointer"
                title="Auto-trace: follow change outputs forward"
              >
                Trace
              </button>
            )}
            {/* Linkability trace (section-level action) */}
            {onAutoTraceLinkability && !autoTracing && (
              <button
                onClick={() => {
                  const changeIdx = tx.vout.findIndex((_, i) => changeOutputs.has(`${tx.txid}:${i}`));
                  const targetIdx = changeIdx >= 0 ? changeIdx : expandableOutputs[0];
                  if (targetIdx !== undefined) onAutoTraceLinkability(tx.txid, targetIdx);
                }}
                className="text-xs text-severity-low/60 hover:text-severity-low transition-colors cursor-pointer"
                title="Linkability trace: follow until compound linkability < 5%"
              >
                Link trace
              </button>
            )}
            {onExpandOutput && expandableOutputs.length > 0 && (
              <button
                onClick={() => { expandableOutputs.slice(0, 5).forEach((i) => onExpandOutput(tx.txid, i)); }}
                className="text-xs text-muted/70 hover:text-foreground transition-colors cursor-pointer"
                title="Expand first 5 unresolved outputs"
              >
                Expand all
              </button>
            )}
          </div>
        </div>
        <div className="space-y-0.5">
          {tx.vout.map((vout, i) => {
            const addr = vout.scriptpubkey_address ?? (vout.scriptpubkey_type === "op_return" ? "OP_RETURN" : "unknown");
            const os = outspends?.[i];
            const isChange = changeOutputs.has(`${tx.txid}:${i}`);
            const entity = vout.scriptpubkey_address ? matchEntitySync(vout.scriptpubkey_address) : null;

            return (
              <div
                key={i}
                className={`flex items-center gap-1.5 px-1 py-1 rounded hover:bg-foreground/5 group ${
                  isChange ? "ring-1 ring-amber-500/30 bg-amber-500/5" : ""
                }`}
              >
                <span
                  className="w-1.5 h-4 rounded-sm shrink-0"
                  style={{ background: getScriptTypeColor(vout.scriptpubkey_type), opacity: 0.7 }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs text-foreground/70 truncate">{truncateId(addr, 6)}</span>
                    {vout.scriptpubkey_address && <CopyButton text={vout.scriptpubkey_address} variant="inline" />}
                  </div>
                  {entity && (
                    <div className="text-xs text-muted truncate">
                      <span style={{ color: SVG_COLORS.high }}>{entity.entityName}</span>
                      {entity.ofac && <span className="text-severity-critical ml-1">OFAC</span>}
                    </div>
                  )}
                </div>
                {/* Spend status */}
                <span className="shrink-0" title={os?.spent ? "Spent" : os?.spent === false ? "Unspent" : "Unknown"}>
                  {os?.spent === true && (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={SVG_COLORS.muted} strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                  {os?.spent === false && (
                    <svg width="8" height="8" viewBox="0 0 16 16"><polygon points="8,1 15,8 8,15 1,8" fill="none" stroke={getScriptTypeColor(vout.scriptpubkey_type)} strokeWidth="2" /></svg>
                  )}
                </span>
                <span className="text-xs text-bitcoin/80 shrink-0 tabular-nums">{formatSats(vout.value)}</span>
                {/* Change badge */}
                {isChange && (
                  <span className="shrink-0 text-[9px] font-semibold px-1 py-px rounded bg-amber-500/20 text-amber-500 leading-tight">
                    change
                  </span>
                )}
                {/* Per-output linkability from selected input */}
                {selectedInputIdx !== null && mat && (() => {
                  const prob = mat[i]?.[selectedInputIdx] ?? 0;
                  if (prob <= 0) return null;
                  return (
                    <span
                      className="shrink-0 w-2 h-2 rounded-full"
                      style={{ backgroundColor: probColor(prob) }}
                      title={`${Math.round(prob * 100)}% from input #${selectedInputIdx}`}
                    />
                  );
                })()}
                {/* Change toggle + auto-suggestion */}
                <button
                  onClick={() => onToggleChange(tx.txid, i)}
                  className={`shrink-0 w-3.5 h-3.5 rounded-sm border cursor-pointer transition-colors relative ${
                    isChange
                      ? "bg-amber-500/40 border-amber-500/60"
                      : "border-card-border hover:border-muted"
                  }`}
                  title={isChange ? "Unmark as change" : (suggestedChangeIndices.has(i) ? "Suggested change output - click to mark" : "Mark as change")}
                >
                  {/* Suggestion pulse dot */}
                  {!isChange && suggestedChangeIndices.has(i) && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  )}
                </button>
                {onExpandOutput && vout.scriptpubkey_type !== "op_return" && vout.value > 0 && (
                  <button
                    onClick={() => onExpandOutput(tx.txid, i)}
                    className="opacity-0 group-hover:opacity-100 text-muted/60 hover:text-foreground transition-all cursor-pointer p-0.5"
                    title="Expand in graph"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                  </button>
                )}
                {/* Per-output auto-trace */}
                {onAutoTrace && !autoTracing && vout.scriptpubkey_type !== "op_return" && vout.value > 0 && (
                  <button
                    onClick={() => onAutoTrace(tx.txid, i)}
                    className="opacity-0 group-hover:opacity-100 text-bitcoin/50 hover:text-bitcoin transition-all cursor-pointer p-0.5"
                    title="Auto-trace from this output"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 5l7 7-7 7" /><path d="M5 5l7 7-7 7" /></svg>
                  </button>
                )}
                {/* Per-output linkability trace */}
                {onAutoTraceLinkability && !autoTracing && vout.scriptpubkey_type !== "op_return" && vout.value > 0 && (
                  <button
                    onClick={() => onAutoTraceLinkability(tx.txid, i)}
                    className="opacity-0 group-hover:opacity-100 text-severity-low/60 hover:text-severity-low transition-all cursor-pointer p-0.5"
                    title="Linkability trace from this output"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07" /></svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
