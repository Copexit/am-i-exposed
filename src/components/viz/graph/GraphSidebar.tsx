"use client";

import { useState, useMemo } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, GRADE_HEX_SVG } from "../shared/svgConstants";
import { formatSats, calcVsize } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { analyzeTransactionSync } from "@/lib/analysis/analyze-sync";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { isRbfSignaling } from "@/lib/analysis/heuristics/tx-utils";
import { CopyButton } from "@/components/ui/CopyButton";
import { useBookmarks } from "@/hooks/useBookmarks";
import { IOTab } from "./IOTab";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { ScoringResult } from "@/lib/types";

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
  /** Collapse sidebar (hide it, but keep the node expanded). */
  onCollapse?: () => void;
  onFullScan: (txid: string) => void;
  /** Change graph root to this transaction (standalone graph page). */
  onSetAsRoot?: (txid: string) => void;
  onExpandInput?: (txid: string, inputIndex: number) => void;
  onExpandOutput?: (txid: string, outputIndex: number) => void;
  /** Set of change-marked outputs: "${txid}:${outputIndex}". */
  changeOutputs: Set<string>;
  onToggleChange: (txid: string, outputIndex: number) => void;
  /** Boltzmann result for this tx (if computed). */
  boltzmannResult?: BoltzmannWorkerResult | null;
  /** Whether Boltzmann is currently being computed for this tx. */
  computingBoltzmann?: boolean;
  /** Boltzmann computation progress (0-1). */
  boltzmannProgress?: number;
  /** Trigger Boltzmann computation for this tx. */
  onComputeBoltzmann?: () => void;
  /** Trigger auto-trace from a specific output. */
  onAutoTrace?: (txid: string, outputIndex: number) => void;
  /** Trigger compounding linkability trace. */
  onAutoTraceLinkability?: (txid: string, outputIndex: number) => void;
  /** Whether auto-trace is in progress. */
  autoTracing?: boolean;
  /** Auto-trace progress info. */
  autoTraceProgress?: { hop: number; txid: string; reason: string } | null;
}

// CopyButton imported from shared component

export function GraphSidebar({
  tx,
  outspends,
  onClose,
  onCollapse,
  onFullScan,
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
  onSetAsRoot,
}: GraphSidebarProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("io");
  const { bookmarks, addBookmark, removeBookmark } = useBookmarks();

  const result = useMemo<ScoringResult | null>(() => analyzeTransactionSync(tx), [tx]);
  const isBookmarked = bookmarks.some((b) => b.input === tx.txid);

  const vsize = calcVsize(tx.weight);
  const feeRate = vsize > 0 ? (tx.fee / vsize).toFixed(1) : "0";
  const totalValue = tx.vout.reduce((s, o) => s + o.value, 0);

  const tabClass = (tab: Tab) =>
    `px-3 py-1.5 text-xs rounded-t transition-colors cursor-pointer ${
      activeTab === tab
        ? "text-foreground border-b-2 border-bitcoin"
        : "text-muted hover:text-foreground/70"
    }`;

  return (
    <motion.div
      initial={{ x: SIDEBAR_WIDTH }}
      animate={{ x: 0 }}
      exit={{ x: SIDEBAR_WIDTH }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="w-80 h-full border-l border-card-border bg-card-bg/95 backdrop-blur-xl flex flex-col overflow-hidden shrink-0"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-foreground/70 truncate">{truncateId(tx.txid, 10)}</span>
          <CopyButton text={tx.txid} variant="inline" />
          <button
            onClick={(e) => { e.stopPropagation(); window.open(`${window.location.origin}${window.location.pathname}#tx=${tx.txid}`, "_blank"); }}
            className="text-muted/60 hover:text-foreground transition-colors cursor-pointer"
            title={t("graph.openInNewTab", { defaultValue: "Open in new tab" })}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isBookmarked) {
                removeBookmark(tx.txid);
              } else {
                addBookmark({
                  input: tx.txid,
                  type: "txid",
                  grade: result?.grade ?? "?",
                  score: result?.score ?? 0,
                  label: "",
                });
              }
            }}
            className={`transition-colors cursor-pointer ${isBookmarked ? "text-bitcoin" : "text-muted/60 hover:text-foreground"}`}
            title={isBookmarked
              ? t("graph.bookmarked", { defaultValue: "Bookmarked" })
              : t("graph.bookmark", { defaultValue: "Bookmark transaction" })}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="text-muted hover:text-foreground transition-colors p-0.5 cursor-pointer"
              title={t("graph.collapseSidebar", { defaultValue: "Collapse sidebar" })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          )}
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors p-0.5 cursor-pointer"
            aria-label={t("common.close", { defaultValue: "Close" })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Score bar */}
      {result && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-card-border shrink-0">
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
            <div
              className="text-xs font-medium text-foreground"
              title={t("graph.quickScoreHint", { defaultValue: "Quick score from on-chain heuristics only. Chain analysis is not included. Scan the transaction for the full grade." })}
            >
              {t("graph.quickScore", { score: result.score, defaultValue: "Quick score: {{score}}/100" })}
            </div>
            {result.txType && result.txType !== "unknown" && (
              <div className="text-xs text-muted truncate">{t(`txType.${result.txType}`, { defaultValue: result.txType.replace(/-/g, " ") })}</div>
            )}
          </div>
          <div className="text-xs text-muted shrink-0">{formatSats(totalValue)}</div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-card-border shrink-0">
        <button className={tabClass("io")} onClick={() => setActiveTab("io")}>I/O</button>
        <button className={tabClass("analysis")} onClick={() => setActiveTab("analysis")}>{t("graph.tabAnalysis", { defaultValue: "Analysis" })}</button>
        <button className={tabClass("technical")} onClick={() => setActiveTab("technical")}>{t("graph.tabTechnical", { defaultValue: "Technical" })}</button>
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
            boltzmannResult={boltzmannResult}
            computingBoltzmann={computingBoltzmann}
            boltzmannProgress={boltzmannProgress}
            onComputeBoltzmann={onComputeBoltzmann}
            onAutoTrace={onAutoTrace}
            onAutoTraceLinkability={onAutoTraceLinkability}
            autoTracing={autoTracing}
            autoTraceProgress={autoTraceProgress}
          />
        )}
        {activeTab === "analysis" && result && (
          <AnalysisTab result={result} tx={tx} />
        )}
        {activeTab === "technical" && (
          <TechnicalTab tx={tx} feeRate={feeRate} vsize={vsize} />
        )}
      </div>

      {/* Action buttons */}
      <div className="px-3 py-2 border-t border-card-border shrink-0 flex gap-2">
        <button
          onClick={() => onFullScan(tx.txid)}
          className="flex-1 text-xs text-center py-2 rounded-lg border border-card-border text-muted hover:text-foreground hover:border-muted transition-colors cursor-pointer"
        >
          {t("graphExplorer.analysis.fullScan", { defaultValue: "Full Scan" })}
        </button>
        {onSetAsRoot && (
          <button
            onClick={() => onSetAsRoot(tx.txid)}
            className="flex-1 text-xs text-center py-2 rounded-lg border border-card-border text-muted hover:text-foreground hover:border-muted transition-colors cursor-pointer"
          >
            {t("graphPage.setAsRoot", { defaultValue: "Set as root" })}
          </button>
        )}
      </div>
    </motion.div>
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
          <div className="text-xs font-medium text-muted">Entities</div>
          {entityMatches.map((m) => (
            <div key={m.address} className="flex items-center gap-1.5 text-xs">
              {m.ofac && (
                <span className="text-severity-critical font-bold">!</span>
              )}
              <span style={{ color: SVG_COLORS.high }} className="truncate">{m.entityName}</span>
              <span className="text-muted/70">({m.category})</span>
            </div>
          ))}
        </div>
      )}

      {/* Problems */}
      {topFindings.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted">Problems ({topFindings.length})</div>
          {topFindings.map((f) => (
            <div key={f.id} className="flex items-start gap-1.5 text-xs py-0.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                style={{ backgroundColor: SEV_DOT[f.severity] ?? SEV_DOT.low }}
              />
              <span className="text-foreground/70">{f.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* Good findings */}
      {goodFindings.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted">Positives ({goodFindings.length})</div>
          {goodFindings.map((f) => (
            <div key={f.id} className="flex items-start gap-1.5 text-xs py-0.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                style={{ backgroundColor: SVG_COLORS.good }}
              />
              <span className="text-muted">{f.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Technical Tab ───────────────────────────────────────────────

function TechnicalTab({ tx, feeRate, vsize }: { tx: MempoolTransaction; feeRate: string; vsize: number }) {
  const { t } = useTranslation();
  const hasSegwit = tx.vin.some((v) => v.witness && v.witness.length > 0);
  const hasTaproot = tx.vin.some((v) => v.prevout?.scriptpubkey_type === "v1_p2tr") ||
    tx.vout.some((v) => v.scriptpubkey_type === "v1_p2tr");
  const isRbf = isRbfSignaling(tx.vin);
  const rows: Array<{ label: string; value: string | number; highlight?: boolean }> = [
    { label: t("graph.technical.version", { defaultValue: "Version" }), value: tx.version },
    { label: t("graph.technical.locktime", { defaultValue: "Locktime" }), value: tx.locktime === 0 ? t("graph.technical.locktimeNone", { defaultValue: "0 (none)" }) : tx.locktime < 500_000_000 ? `${tx.locktime} ${t("graph.technical.locktimeBlockHeight", { defaultValue: "(block height)" })}` : `${tx.locktime} ${t("graph.technical.locktimeTimestamp", { defaultValue: "(timestamp)" })}` },
    { label: t("graph.technical.size", { defaultValue: "Size" }), value: `${tx.size} ${t("graph.technical.bytes", { defaultValue: "bytes" })}` },
    { label: t("graph.technical.weight", { defaultValue: "Weight" }), value: `${tx.weight} ${t("graph.technical.wu", { defaultValue: "WU" })}` },
    { label: t("graph.technical.virtualSize", { defaultValue: "Virtual size" }), value: `${vsize} ${t("graph.technical.vb", { defaultValue: "vB" })}` },
    { label: t("graph.technical.fee", { defaultValue: "Fee" }), value: formatSats(tx.fee) },
    { label: t("graph.technical.feeRate", { defaultValue: "Fee rate" }), value: `${feeRate} ${t("graph.technical.satVb", { defaultValue: "sat/vB" })}` },
    { label: t("graph.technical.segwit", { defaultValue: "SegWit" }), value: hasSegwit ? "Yes" : "No" },
    { label: t("graph.technical.taproot", { defaultValue: "Taproot" }), value: hasTaproot ? "Yes" : "No" },
    { label: t("graph.technical.rbfSignaling", { defaultValue: "RBF signaling" }), value: isRbf ? t("graph.technical.rbfYes", { defaultValue: "Yes (BIP125)" }) : "No", highlight: isRbf },
    { label: t("graph.technical.confirmed", { defaultValue: "Confirmed" }), value: tx.status?.confirmed ? t("graph.technical.confirmedBlock", { height: tx.status.block_height, defaultValue: "Block {{height}}" }) : t("graph.technical.unconfirmed", { defaultValue: "Unconfirmed" }), highlight: !tx.status?.confirmed },
  ];

  return (
    <div className="p-3">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-foreground/5">
              <td className="py-1.5 text-muted pr-3">{r.label}</td>
              <td className={`py-1.5 font-mono ${r.highlight ? "text-severity-medium" : "text-foreground/70"}`}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
