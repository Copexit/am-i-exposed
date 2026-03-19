"use client";

import { useState, useMemo } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, GRADE_HEX_SVG } from "../shared/svgConstants";
import { formatSats, calcVsize } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { analyzeTransactionSync } from "@/lib/analysis/analyze-sync";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { CopyButton } from "@/components/ui/CopyButton";
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
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="text-muted hover:text-foreground transition-colors p-0.5 cursor-pointer"
              title="Collapse sidebar"
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
            <div className="text-xs font-medium text-foreground">{result.score}/100</div>
            {result.txType && result.txType !== "unknown" && (
              <div className="text-xs text-muted truncate">{result.txType.replace(/-/g, " ")}</div>
            )}
          </div>
          <div className="text-xs text-muted shrink-0">{formatSats(totalValue)}</div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-card-border shrink-0">
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

      {/* Full scan button */}
      <div className="px-3 py-2 border-t border-card-border shrink-0">
        <button
          onClick={() => onFullScan(tx.txid)}
          className="w-full text-xs text-center py-2 rounded-lg border border-card-border text-muted hover:text-foreground hover:border-muted transition-colors cursor-pointer"
        >
          {t("graphExplorer.analysis.fullScan", { defaultValue: "Full Scan" })}
        </button>
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
