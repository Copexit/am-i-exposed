"use client";

import { useEffect, useState, useRef } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, GRADE_HEX_SVG } from "./viz/shared/svgConstants";
import { formatSats } from "@/lib/format";
import { analyzeTransactionSync } from "@/lib/analysis/analyze-sync";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { extractTxAddresses } from "@/lib/analysis/cex-risk/extract-addresses";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";

interface GraphNodeAnalysisProps {
  tx: MempoolTransaction;
  onClose: () => void;
  onFullScan: (txid: string) => void;
  position: { x: number; y: number };
}

/** Severity order for sorting (lower = more severe). */
const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, good: 4 };

const SEV_DOT: Record<string, string> = {
  critical: SVG_COLORS.critical,
  high: SVG_COLORS.high,
  medium: SVG_COLORS.medium,
  low: SVG_COLORS.low,
  good: SVG_COLORS.good,
};

/**
 * Floating analysis card that appears when clicking a graph node.
 * Runs the full heuristic suite on the in-memory transaction data
 * and shows grade, score, top findings, and entity matches.
 */
export function GraphNodeAnalysis({
  tx,
  onClose,
  onFullScan,
  position,
}: GraphNodeAnalysisProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [result] = useState<ScoringResult | null>(() => analyzeTransactionSync(tx));

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Resolve entity matches
  const entityMatches = extractTxAddresses(tx)
    .map((addr) => matchEntitySync(addr))
    .filter((m): m is NonNullable<typeof m> => m !== null);

  // Position the panel centered above the clicked node
  const left = position.x;
  const top = position.y;

  const topFindings = result?.findings
    .filter((f) => f.severity !== "good")
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))
    .slice(0, 3) ?? [];

  const goodFindings = result?.findings
    .filter((f) => f.severity === "good")
    .slice(0, 2) ?? [];

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      style={{
        position: "absolute",
        left,
        top,
        width: 320,
        transform: "translate(-50%, -100%)",
        marginTop: -8,
        zIndex: 60,
        pointerEvents: "auto",
      }}
      className="rounded-xl border border-white/10 bg-[#1c1c20]/95 backdrop-blur-xl shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="font-mono text-xs text-white/60 truncate">{tx.txid.slice(0, 16)}...</span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/80 transition-colors p-0.5 cursor-pointer"
          aria-label={t("common.close", { defaultValue: "Close" })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Score + Grade */}
      {result ? (
        <div className="px-3 py-2 space-y-2">
          <div className="flex items-center gap-3">
            {/* Grade circle */}
            <div
              className="flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold"
              style={{
                background: `${GRADE_HEX_SVG[result.grade]}20`,
                color: GRADE_HEX_SVG[result.grade],
                border: `2px solid ${GRADE_HEX_SVG[result.grade]}50`,
              }}
            >
              {result.grade}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white/90">
                {t("graphExplorer.analysis.score", { score: result.score, defaultValue: "Score: {{score}}/100" })}
              </div>
              {result.txType && result.txType !== "unknown" && (
                <div className="text-xs text-white/50 truncate">
                  {result.txType.replace(/-/g, " ")}
                </div>
              )}
            </div>
            <div className="text-xs text-white/40">
              {formatSats(tx.vout.reduce((s, o) => s + o.value, 0))}
            </div>
          </div>

          {/* Entity matches */}
          {entityMatches.length > 0 && (
            <div className="space-y-1">
              {entityMatches.slice(0, 2).map((m) => (
                <div key={m.address} className="flex items-center gap-1.5 text-xs">
                  {m.ofac && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill={SVG_COLORS.critical}>
                      <path d="M8 1l7 13H1L8 1zm0 4v4m0 2v1" stroke="#0c0c0e" strokeWidth="1.5" fill="none" />
                      <path d="M8 1l7 13H1L8 1z" fill={SVG_COLORS.critical} fillOpacity="0.3" />
                    </svg>
                  )}
                  <span style={{ color: SVG_COLORS.high }} className="truncate">{m.entityName}</span>
                  <span className="text-white/30">({m.category})</span>
                </div>
              ))}
            </div>
          )}

          {/* Top findings */}
          {topFindings.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-white/5">
              {topFindings.map((f) => (
                <div key={f.id} className="flex items-start gap-1.5 text-xs">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                    style={{ backgroundColor: SEV_DOT[f.severity] ?? SEV_DOT.low }}
                  />
                  <span className="text-white/70 line-clamp-1">{f.title}</span>
                </div>
              ))}
            </div>
          )}

          {/* Good findings */}
          {goodFindings.length > 0 && (
            <div className="space-y-1">
              {goodFindings.map((f) => (
                <div key={f.id} className="flex items-start gap-1.5 text-xs">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                    style={{ backgroundColor: SVG_COLORS.good }}
                  />
                  <span className="text-white/50 line-clamp-1">{f.title}</span>
                </div>
              ))}
            </div>
          )}

          {/* Full Scan button */}
          <button
            onClick={() => onFullScan(tx.txid)}
            className="w-full text-xs text-center py-1.5 rounded-lg border border-white/10 text-white/60 hover:text-white/90 hover:border-white/20 transition-colors cursor-pointer mt-1"
          >
            {t("graphExplorer.analysis.fullScan", { defaultValue: "Full Scan" })}
          </button>
        </div>
      ) : (
        <div className="px-3 py-4 text-xs text-white/40 text-center animate-pulse">
          {t("graphExplorer.analysis.analyzing", { defaultValue: "Analyzing..." })}
        </div>
      )}
    </motion.div>
  );
}
