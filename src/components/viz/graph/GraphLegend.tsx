"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SVG_COLORS } from "../shared/svgConstants";
import { ENTITY_CATEGORY_COLORS } from "./constants";
import { SCRIPT_TYPE_LEGEND } from "./scriptStyles";
import type { NodeFilter } from "./types";

interface GraphLegendProps {
  filter: NodeFilter;
  onToggleFilter: (key: keyof NodeFilter) => void;
  fingerprintMode: boolean;
  changeOutputs: Set<string>;
}

export function GraphLegend({ filter, onToggleFilter, fingerprintMode, changeOutputs }: GraphLegendProps) {
  const { t } = useTranslation();
  const [legendOpen, setLegendOpen] = useState(false);

  return (
    <div className="absolute top-0 left-0 z-20 w-[240px] rounded-lg border border-card-border bg-card-bg/95 backdrop-blur-xl overflow-hidden shadow-lg">
      <button
        onClick={() => setLegendOpen(!legendOpen)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] text-muted hover:text-foreground transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          {t("graphLegend.title", { defaultValue: "Legend" })}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          className={`transition-transform duration-200 ${legendOpen ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {legendOpen && (
        <div className="px-2 pb-2 space-y-1.5 text-[10px] text-muted border-t border-card-border/50 pt-1.5">
          {/* Node types (clickable filters) */}
          <div className="font-medium text-muted uppercase tracking-wider text-[9px]">{t("graphLegend.nodes", { defaultValue: "Nodes" })}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm border-2 shrink-0" style={{ borderColor: SVG_COLORS.bitcoin, background: "transparent" }} />
              {t("graphLegend.rootTx", { defaultValue: "Root tx" })}
            </span>
            <button onClick={() => onToggleFilter("showCoinJoin")} className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${filter.showCoinJoin ? "opacity-100" : "opacity-40 line-through"}`}>
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SVG_COLORS.good }} />
              {t("graphLegend.coinjoin", { defaultValue: "CoinJoin" })}
            </button>
            <button onClick={() => onToggleFilter("showStandard")} className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${filter.showStandard ? "opacity-100" : "opacity-40 line-through"}`}>
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SVG_COLORS.low }} />
              {t("graphLegend.standard", { defaultValue: "Standard" })}
            </button>
          </div>

          {/* Entity categories (clickable filter) */}
          <div className="font-medium text-muted uppercase tracking-wider text-[9px] mt-1">{t("graphLegend.entities", { defaultValue: "Entities" })}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {([
              ["exchange", t("graphLegend.entity.exchange", { defaultValue: "Exchange" })],
              ["darknet", t("graphLegend.entity.darknet", { defaultValue: "Darknet" })],
              ["scam", t("graphLegend.entity.scam", { defaultValue: "Scam" })],
              ["mixer", t("graphLegend.entity.mixer", { defaultValue: "Mixer" })],
              ["gambling", t("graphLegend.entity.gambling", { defaultValue: "Gambling" })],
              ["mining", t("graphLegend.entity.mining", { defaultValue: "Mining" })],
              ["payment", t("graphLegend.entity.payment", { defaultValue: "Payment" })],
              ["p2p", t("graphLegend.entity.p2p", { defaultValue: "P2P" })],
            ] as [keyof typeof ENTITY_CATEGORY_COLORS, string][]).map(([cat, label]) => (
              <button
                key={cat}
                onClick={() => onToggleFilter("showEntity")}
                className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${filter.showEntity ? "opacity-100" : "opacity-40 line-through"}`}
              >
                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: ENTITY_CATEGORY_COLORS[cat] }} />
                <span className="text-muted">{label}</span>
              </button>
            ))}
          </div>

          {/* Edge types */}
          <div className="font-medium text-muted uppercase tracking-wider text-[9px] mt-1">{t("graphLegend.edges", { defaultValue: "Edges" })}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {SCRIPT_TYPE_LEGEND.map((s) => (
              <span key={s.type} className="flex items-center gap-1.5">
                <span className="inline-block w-4 h-0.5 rounded shrink-0" style={{
                  background: s.color, opacity: 0.8,
                  ...(s.dash ? { borderBottom: `1.5px dashed ${s.color}`, background: "transparent" } : {}),
                }} />
                <span className="text-muted">{s.label}</span>
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 rounded shrink-0" style={{ background: SVG_COLORS.critical, opacity: 0.7 }} />
              <span className="text-muted">{t("graphLegend.consolidation", { defaultValue: "Consolidation" })}</span>
            </span>
            {changeOutputs.size > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-4 h-0.5 rounded shrink-0" style={{ background: "#d97706", opacity: 0.8 }} />
                <span className="text-muted">{t("graphLegend.change", { defaultValue: "Change" })}</span>
              </span>
            )}
          </div>

          {/* Fingerprint mode items */}
          {fingerprintMode && (
            <>
              <div className="font-medium text-muted uppercase tracking-wider text-[9px] mt-1">{t("graphLegend.fingerprint", { defaultValue: "Fingerprint" })}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3.5 h-2.5 shrink-0" style={{ background: "var(--card-border)", border: "1.5px solid var(--muted)", borderRadius: 4 }} />
                  <span className="text-muted">v2, lock=0</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3.5 h-2.5 shrink-0" style={{ background: "var(--surface-inset)", border: "1.5px solid var(--muted)", borderRadius: 4 }} />
                  <span className="text-muted">v2, lock!=0</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3.5 h-2.5 shrink-0" style={{ background: "var(--card-border)", border: "1.5px solid var(--muted)", borderRadius: 0 }} />
                  <span className="text-muted">v1, lock=0</span>
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
