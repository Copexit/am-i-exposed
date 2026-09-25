"use client";

import { useTranslation } from "react-i18next";
import { SVG_COLORS } from "../shared/svgConstants";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { getScriptTypeColor } from "./scriptStyles";
import { probColor } from "../shared/linkabilityColors";
import { CopyButton } from "@/components/ui/CopyButton";
import type { MempoolVin, MempoolVout, MempoolOutspend } from "@/lib/api/types";
import { isOpReturnOutput } from "@/lib/analysis/heuristics/tx-utils";

// ---------- InputRow ----------

export interface InputRowProps {
  vin: MempoolVin;
  index: number;
  txid: string;
  mat?: number[][] | null;
  detLinks?: [number, number][];
  selectedInputIdx: number | null;
  onSelectInput: (idx: number | null) => void;
  onExpandInput?: (txid: string, inputIndex: number) => void;
}

export function InputRow({
  vin, index, txid, mat, detLinks, selectedInputIdx, onSelectInput, onExpandInput,
}: InputRowProps) {
  const { t } = useTranslation();
  const addr = vin.is_coinbase ? t("graph.coinbase", { defaultValue: "coinbase" }) : (vin.prevout?.scriptpubkey_address ?? t("graph.unknown", { defaultValue: "unknown" }));
  const value = vin.prevout?.value ?? 0;
  const scriptType = vin.prevout?.scriptpubkey_type ?? "unknown";
  const entity = !vin.is_coinbase && vin.prevout?.scriptpubkey_address
    ? matchEntitySync(vin.prevout.scriptpubkey_address) : null;

  return (
    <div className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-foreground/5 group">
      <span
        className="w-1.5 h-4 rounded-sm shrink-0"
        style={{ background: getScriptTypeColor(scriptType), opacity: 0.7 }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs text-foreground/70 truncate">
            {vin.is_coinbase ? t("graph.coinbase", { defaultValue: "coinbase" }) : truncateId(addr, 6)}
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
      {/* Linkability indicator */}
      {mat && !vin.is_coinbase && (() => {
        let maxP = 0;
        for (const row of mat) {
          const p = row[index];
          if (p !== undefined && p > maxP) maxP = p;
        }
        if (maxP <= 0) return null;
        const isDet = detLinks?.some(([, inIdx]) => inIdx === index);
        const isSelected = selectedInputIdx === index;
        return (
          <button
            className={`shrink-0 w-2.5 h-2.5 rounded-full cursor-pointer transition-all ${isSelected ? "ring-2 ring-foreground/40 scale-125" : ""}`}
            style={{ backgroundColor: probColor(maxP), opacity: isDet ? 1 : 0.7 }}
            title={`${Math.round(maxP * 100)}% max linkability${isDet ? " (deterministic)" : ""} - click to see per-output breakdown`}
            onClick={(e) => { e.stopPropagation(); onSelectInput(isSelected ? null : index); }}
          />
        );
      })()}
      {onExpandInput && !vin.is_coinbase && (
        <button
          onClick={() => onExpandInput(txid, index)}
          className="opacity-0 group-hover:opacity-100 text-muted/60 hover:text-foreground transition-all cursor-pointer p-0.5"
          title={t("graph.expandInGraph", { defaultValue: "Expand in graph" })}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </button>
      )}
    </div>
  );
}

// ---------- OutputRow ----------

export interface OutputRowProps {
  vout: MempoolVout;
  index: number;
  txid: string;
  outspend?: MempoolOutspend;
  isChange: boolean;
  suggestedChange: boolean;
  selectedInputIdx: number | null;
  mat?: number[][] | null;
  onToggleChange: (txid: string, outputIndex: number) => void;
  onExpandOutput?: (txid: string, outputIndex: number) => void;
  onAutoTrace?: (txid: string, outputIndex: number) => void;
  onAutoTraceLinkability?: (txid: string, outputIndex: number) => void;
  autoTracing?: boolean;
}

export function OutputRow({
  vout,
  index,
  txid,
  outspend,
  isChange,
  suggestedChange,
  selectedInputIdx,
  mat,
  onToggleChange,
  onExpandOutput,
  onAutoTrace,
  onAutoTraceLinkability,
  autoTracing,
}: OutputRowProps) {
  const { t } = useTranslation();
  const addr = vout.scriptpubkey_address ?? (isOpReturnOutput(vout) ? t("graph.opReturn", { defaultValue: "OP_RETURN" }) : t("graph.unknown", { defaultValue: "unknown" }));
  const entity = vout.scriptpubkey_address ? matchEntitySync(vout.scriptpubkey_address) : null;
  const canExpand = !isOpReturnOutput(vout) && vout.value > 0 && outspend?.spent !== false;

  return (
    <div
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
      <span className="shrink-0" title={outspend?.spent ? t("graph.ioTab.spent", { defaultValue: "Spent" }) : outspend?.spent === false ? t("graph.ioTab.unspent", { defaultValue: "Unspent" }) : t("graph.ioTab.unknown", { defaultValue: "Unknown" })}>
        {outspend?.spent === true && (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={SVG_COLORS.muted} strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
        )}
        {outspend?.spent === false && (
          <svg width="8" height="8" viewBox="0 0 16 16"><polygon points="8,1 15,8 8,15 1,8" fill="none" stroke={getScriptTypeColor(vout.scriptpubkey_type)} strokeWidth="2" /></svg>
        )}
      </span>
      <span className="text-xs text-bitcoin/80 shrink-0 tabular-nums">{formatSats(vout.value)}</span>
      {/* Change badge */}
      {isChange && (
        <span className="shrink-0 text-[9px] font-semibold px-1 py-px rounded bg-amber-500/20 text-amber-500 leading-tight">
          {t("graph.change", { defaultValue: "change" })}
        </span>
      )}
      {/* Per-output linkability from selected input */}
      {selectedInputIdx !== null && mat && (() => {
        const prob = mat[index]?.[selectedInputIdx] ?? 0;
        if (prob <= 0) return null;
        return (
          <span
            className="shrink-0 w-2 h-2 rounded-full"
            style={{ backgroundColor: probColor(prob) }}
            title={t("graph.ioTab.linkabilityFromInput", { prob: Math.round(prob * 100), idx: selectedInputIdx, defaultValue: "{{prob}}% from input #{{idx}}" })}
          />
        );
      })()}
      {/* Change toggle + auto-suggestion */}
      <button
        onClick={() => onToggleChange(txid, index)}
        className={`shrink-0 w-3.5 h-3.5 rounded-sm border cursor-pointer transition-colors relative ${
          isChange
            ? "bg-amber-500/40 border-amber-500/60"
            : "border-card-border hover:border-muted"
        }`}
        title={isChange ? t("graph.ioTab.unmarkAsChange", { defaultValue: "Unmark as change" }) : (suggestedChange ? t("graph.ioTab.suggestedChange", { defaultValue: "Suggested change output - click to mark" }) : t("graph.ioTab.markAsChange", { defaultValue: "Mark as change" }))}
      >
        {/* Suggestion pulse dot */}
        {!isChange && suggestedChange && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        )}
      </button>
      {onExpandOutput && canExpand && (
        <button
          onClick={() => onExpandOutput(txid, index)}
          className="opacity-0 group-hover:opacity-100 text-muted/60 hover:text-foreground transition-all cursor-pointer p-0.5"
          title={t("graph.expandInGraph", { defaultValue: "Expand in graph" })}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </button>
      )}
      {/* Per-output auto-trace */}
      {onAutoTrace && !autoTracing && canExpand && (
        <button
          onClick={() => onAutoTrace(txid, index)}
          className="opacity-0 group-hover:opacity-100 text-bitcoin/50 hover:text-bitcoin transition-all cursor-pointer p-0.5"
          title={t("graph.ioTab.autoTraceFromOutput", { defaultValue: "Auto-trace from this output" })}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 5l7 7-7 7" /><path d="M5 5l7 7-7 7" /></svg>
        </button>
      )}
      {/* Per-output linkability trace */}
      {onAutoTraceLinkability && !autoTracing && canExpand && (
        <button
          onClick={() => onAutoTraceLinkability(txid, index)}
          className="opacity-0 group-hover:opacity-100 text-severity-low/60 hover:text-severity-low transition-all cursor-pointer p-0.5"
          title={t("graph.ioTab.linkabilityTraceFromOutput", { defaultValue: "Linkability trace from this output" })}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07" /></svg>
        </button>
      )}
    </div>
  );
}
