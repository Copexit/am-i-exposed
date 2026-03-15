"use client";

import { useState, useMemo, useCallback } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, GRADE_HEX_SVG } from "../shared/svgConstants";
import { formatSats, calcVsize } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { analyzeTransactionSync } from "@/lib/analysis/analyze-sync";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { getScriptTypeColor } from "./scriptStyles";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { ScoringResult, Finding } from "@/lib/types";

export const SIDEBAR_WIDTH = 320;

/** Severity order for sorting. */
const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, good: 4 };

const SEV_DOT: Record<string, string> = {
  critical: SVG_COLORS.critical,
  high: SVG_COLORS.high,
  medium: SVG_COLORS.medium,
  low: SVG_COLORS.low,
  good: SVG_COLORS.good,
};

type Tab = "io" | "analysis" | "technical";

interface GraphSidebarProps {
  tx: MempoolTransaction;
  outspends?: MempoolOutspend[];
  onClose: () => void;
  onFullScan: (txid: string) => void;
  onExpandInput?: (txid: string, inputIndex: number) => void;
  onExpandOutput?: (txid: string, outputIndex: number) => void;
  /** Set of change-marked outputs: "${txid}:${outputIndex}". */
  changeOutputs: Set<string>;
  onToggleChange: (txid: string, outputIndex: number) => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="text-white/30 hover:text-white/60 transition-colors cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title="Copy"
    >
      {copied ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}

export function GraphSidebar({
  tx,
  outspends,
  onClose,
  onFullScan,
  onExpandInput,
  onExpandOutput,
  changeOutputs,
  onToggleChange,
}: GraphSidebarProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("io");

  const result = useMemo<ScoringResult | null>(() => analyzeTransactionSync(tx), [tx]);

  const vsize = calcVsize(tx.weight);
  const feeRate = vsize > 0 ? (tx.fee / vsize).toFixed(1) : "0";
  const totalValue = tx.vout.reduce((s, o) => s + o.value, 0);

  const tabClass = (tab: Tab) =>
    `px-3 py-1.5 text-xs rounded-t transition-colors cursor-pointer ${
      activeTab === tab
        ? "text-white/90 border-b-2 border-bitcoin"
        : "text-white/40 hover:text-white/60"
    }`;

  return (
    <motion.div
      initial={{ x: SIDEBAR_WIDTH }}
      animate={{ x: 0 }}
      exit={{ x: SIDEBAR_WIDTH }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="w-80 h-full border-l border-white/10 bg-[#1c1c20]/95 backdrop-blur-xl flex flex-col overflow-hidden shrink-0"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-white/60 truncate">{truncateId(tx.txid, 10)}</span>
          <CopyButton text={tx.txid} />
        </div>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/80 transition-colors p-0.5 cursor-pointer shrink-0"
          aria-label={t("common.close", { defaultValue: "Close" })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Score bar */}
      {result && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold shrink-0"
            style={{
              background: `${GRADE_HEX_SVG[result.grade]}20`,
              color: GRADE_HEX_SVG[result.grade],
              border: `2px solid ${GRADE_HEX_SVG[result.grade]}50`,
            }}
          >
            {result.grade}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-white/80">{result.score}/100</div>
            {result.txType && result.txType !== "unknown" && (
              <div className="text-xs text-white/40 truncate">{result.txType.replace(/-/g, " ")}</div>
            )}
          </div>
          <div className="text-xs text-white/40 shrink-0">{formatSats(totalValue)}</div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-white/5 shrink-0">
        <button className={tabClass("io")} onClick={() => setActiveTab("io")}>I/O</button>
        <button className={tabClass("analysis")} onClick={() => setActiveTab("analysis")}>Analysis</button>
        <button className={tabClass("technical")} onClick={() => setActiveTab("technical")}>Technical</button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === "io" && (
          <IOTab
            tx={tx}
            outspends={outspends}
            onExpandInput={onExpandInput}
            onExpandOutput={onExpandOutput}
            changeOutputs={changeOutputs}
            onToggleChange={onToggleChange}
          />
        )}
        {activeTab === "analysis" && result && (
          <AnalysisTab result={result} tx={tx} />
        )}
        {activeTab === "technical" && (
          <TechnicalTab tx={tx} feeRate={feeRate} vsize={vsize} />
        )}
      </div>

      {/* Full scan button */}
      <div className="px-3 py-2 border-t border-white/5 shrink-0">
        <button
          onClick={() => onFullScan(tx.txid)}
          className="w-full text-xs text-center py-2 rounded-lg border border-white/10 text-white/60 hover:text-white/90 hover:border-white/20 transition-colors cursor-pointer"
        >
          {t("graphExplorer.analysis.fullScan", { defaultValue: "Full Scan" })}
        </button>
      </div>
    </motion.div>
  );
}

// ─── I/O Tab ─────────────────────────────────────────────────────

function IOTab({
  tx,
  outspends,
  onExpandInput,
  onExpandOutput,
  changeOutputs,
  onToggleChange,
}: {
  tx: MempoolTransaction;
  outspends?: MempoolOutspend[];
  onExpandInput?: (txid: string, inputIndex: number) => void;
  onExpandOutput?: (txid: string, outputIndex: number) => void;
  changeOutputs: Set<string>;
  onToggleChange: (txid: string, outputIndex: number) => void;
}) {
  return (
    <div className="p-2 space-y-3">
      {/* Inputs */}
      <div>
        <div className="text-xs font-medium text-white/50 px-1 mb-1">
          Inputs ({tx.vin.length})
        </div>
        <div className="space-y-0.5">
          {tx.vin.map((vin, i) => {
            const addr = vin.is_coinbase ? "coinbase" : (vin.prevout?.scriptpubkey_address ?? "unknown");
            const value = vin.prevout?.value ?? 0;
            const scriptType = vin.prevout?.scriptpubkey_type ?? "unknown";
            const entity = !vin.is_coinbase && vin.prevout?.scriptpubkey_address
              ? matchEntitySync(vin.prevout.scriptpubkey_address) : null;

            return (
              <div key={i} className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-white/3 group">
                <span
                  className="w-1.5 h-4 rounded-sm shrink-0"
                  style={{ background: getScriptTypeColor(scriptType), opacity: 0.7 }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs text-white/60 truncate">
                      {vin.is_coinbase ? "coinbase" : truncateId(addr, 6)}
                    </span>
                    {!vin.is_coinbase && addr !== "unknown" && <CopyButton text={addr} />}
                  </div>
                  {entity && (
                    <div className="text-xs text-white/40 truncate">
                      <span style={{ color: SVG_COLORS.high }}>{entity.entityName}</span>
                      {entity.ofac && <span className="text-red-400 ml-1">OFAC</span>}
                    </div>
                  )}
                </div>
                <span className="text-xs text-bitcoin/80 shrink-0 tabular-nums">{formatSats(value)}</span>
                {onExpandInput && !vin.is_coinbase && (
                  <button
                    onClick={() => onExpandInput(tx.txid, i)}
                    className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-white/70 transition-all cursor-pointer p-0.5"
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

      {/* Outputs */}
      <div>
        <div className="text-xs font-medium text-white/50 px-1 mb-1">
          Outputs ({tx.vout.length})
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
                className={`flex items-center gap-1.5 px-1 py-1 rounded hover:bg-white/3 group ${
                  isChange ? "ring-1 ring-orange-400/30 bg-orange-400/5" : ""
                }`}
              >
                <span
                  className="w-1.5 h-4 rounded-sm shrink-0"
                  style={{ background: getScriptTypeColor(vout.scriptpubkey_type), opacity: 0.7 }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs text-white/60 truncate">{truncateId(addr, 6)}</span>
                    {vout.scriptpubkey_address && <CopyButton text={vout.scriptpubkey_address} />}
                  </div>
                  {entity && (
                    <div className="text-xs text-white/40 truncate">
                      <span style={{ color: SVG_COLORS.high }}>{entity.entityName}</span>
                      {entity.ofac && <span className="text-red-400 ml-1">OFAC</span>}
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
                {/* Change toggle */}
                <button
                  onClick={() => onToggleChange(tx.txid, i)}
                  className={`shrink-0 w-3.5 h-3.5 rounded-sm border cursor-pointer transition-colors ${
                    isChange
                      ? "bg-orange-400/40 border-orange-400/60"
                      : "border-white/15 hover:border-white/30"
                  }`}
                  title={isChange ? "Unmark as change" : "Mark as change"}
                />
                {onExpandOutput && vout.scriptpubkey_type !== "op_return" && vout.value > 0 && (
                  <button
                    onClick={() => onExpandOutput(tx.txid, i)}
                    className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-white/70 transition-all cursor-pointer p-0.5"
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
    </div>
  );
}

// ─── Analysis Tab ────────────────────────────────────────────────

function AnalysisTab({ result, tx }: { result: ScoringResult; tx: MempoolTransaction }) {
  const topFindings = result.findings
    .filter((f) => f.severity !== "good")
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3));

  const goodFindings = result.findings.filter((f) => f.severity === "good");

  // Entity matches
  const entityMatches = useMemo(() => {
    const addrs = new Set<string>();
    for (const v of tx.vin) {
      if (!v.is_coinbase && v.prevout?.scriptpubkey_address) addrs.add(v.prevout.scriptpubkey_address);
    }
    for (const o of tx.vout) {
      if (o.scriptpubkey_address) addrs.add(o.scriptpubkey_address);
    }
    return [...addrs].map((a) => matchEntitySync(a)).filter((m): m is NonNullable<typeof m> => m !== null);
  }, [tx]);

  return (
    <div className="p-3 space-y-3">
      {/* Entity matches */}
      {entityMatches.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-white/50">Entities</div>
          {entityMatches.map((m) => (
            <div key={m.address} className="flex items-center gap-1.5 text-xs">
              {m.ofac && (
                <span className="text-red-400 font-bold">!</span>
              )}
              <span style={{ color: SVG_COLORS.high }} className="truncate">{m.entityName}</span>
              <span className="text-white/30">({m.category})</span>
            </div>
          ))}
        </div>
      )}

      {/* Problems */}
      {topFindings.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-white/50">Problems ({topFindings.length})</div>
          {topFindings.map((f) => (
            <div key={f.id} className="flex items-start gap-1.5 text-xs py-0.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                style={{ backgroundColor: SEV_DOT[f.severity] ?? SEV_DOT.low }}
              />
              <span className="text-white/70">{f.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* Good findings */}
      {goodFindings.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-white/50">Positives ({goodFindings.length})</div>
          {goodFindings.map((f) => (
            <div key={f.id} className="flex items-start gap-1.5 text-xs py-0.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                style={{ backgroundColor: SVG_COLORS.good }}
              />
              <span className="text-white/50">{f.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Technical Tab ───────────────────────────────────────────────

function TechnicalTab({ tx, feeRate, vsize }: { tx: MempoolTransaction; feeRate: string; vsize: number }) {
  const hasSegwit = tx.vin.some((v) => v.witness && v.witness.length > 0);
  const hasTaproot = tx.vin.some((v) => v.prevout?.scriptpubkey_type === "v1_p2tr") ||
    tx.vout.some((v) => v.scriptpubkey_type === "v1_p2tr");
  const isRbf = tx.vin.some((v) => v.sequence < 0xfffffffe);

  const rows: Array<{ label: string; value: string | number; highlight?: boolean }> = [
    { label: "Version", value: tx.version },
    { label: "Locktime", value: tx.locktime === 0 ? "0 (none)" : tx.locktime < 500_000_000 ? `${tx.locktime} (block height)` : `${tx.locktime} (timestamp)` },
    { label: "Size", value: `${tx.size} bytes` },
    { label: "Weight", value: `${tx.weight} WU` },
    { label: "Virtual size", value: `${vsize} vB` },
    { label: "Fee", value: formatSats(tx.fee) },
    { label: "Fee rate", value: `${feeRate} sat/vB` },
    { label: "SegWit", value: hasSegwit ? "Yes" : "No" },
    { label: "Taproot", value: hasTaproot ? "Yes" : "No" },
    { label: "RBF signaling", value: isRbf ? "Yes (BIP125)" : "No", highlight: isRbf },
    { label: "Confirmed", value: tx.status?.confirmed ? `Block ${tx.status.block_height}` : "Unconfirmed", highlight: !tx.status?.confirmed },
  ];

  return (
    <div className="p-3">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-white/3">
              <td className="py-1.5 text-white/40 pr-3">{r.label}</td>
              <td className={`py-1.5 font-mono ${r.highlight ? "text-amber-400/80" : "text-white/70"}`}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
