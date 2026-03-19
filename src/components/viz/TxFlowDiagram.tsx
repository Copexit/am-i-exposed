"use client";

import { useState } from "react";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { formatSats, calcFeeRate } from "@/lib/format";
import { useFullscreen } from "@/hooks/useFullscreen";
import { FlowChart, MAX_DISPLAY } from "./FlowChart";
import type { TxFlowDiagramProps } from "./FlowChart";

export type { TxFlowDiagramProps };

export function TxFlowDiagram({ tx, findings, onAddressClick, usdPrice, outspends, boltzmannResult, isCoinJoinOverride, onExitLinkability }: TxFlowDiagramProps) {
  const { t, i18n } = useTranslation();
  useTheme(); // re-render on theme change for SVG_COLORS
  const [showAllInputs, setShowAllInputs] = useState(false);
  const [showAllOutputs, setShowAllOutputs] = useState(false);
  const { isExpanded, expand, collapse } = useFullscreen();
  const [linkabilityMode, setLinkabilityMode] = useState(!!isCoinJoinOverride);
  const hasLinkability = !!boltzmannResult;

  const displayInCount = showAllInputs ? tx.vin.length : Math.min(tx.vin.length, MAX_DISPLAY);
  const displayOutCount = showAllOutputs ? tx.vout.length : Math.min(tx.vout.length, MAX_DISPLAY);
  const maxSide = Math.max(displayInCount, displayOutCount);
  const chartHeight = Math.max(160, maxSide * 40 + 40);
  const MAX_VISIBLE_HEIGHT = 500;
  const needsScroll = chartHeight > MAX_VISIBLE_HEIGHT;

  return (
    <>
      <div className="w-full glass rounded-xl p-4 sm:p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted uppercase tracking-wider">
          <span>{t("tx.inputCount", { count: tx.vin.length, defaultValue: `${tx.vin.length} inputs` })}</span>
          <div className="flex items-center gap-2 order-last sm:order-none w-full sm:w-auto justify-center">
            {hasLinkability && (
              <button
                onClick={() => setLinkabilityMode(prev => !prev)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                  linkabilityMode
                    ? "border-bitcoin/50 bg-bitcoin/10 text-bitcoin"
                    : "border-card-border text-muted hover:text-foreground hover:border-muted"
                }`}
                title={t("viz.flow.linkabilityToggle", { defaultValue: "Color links by Boltzmann linkability probability" })}
              >
                <span className="flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                  {t("viz.flow.linkability", { defaultValue: "Linkability" })}
                </span>
              </button>
            )}
            <span className="flex items-center gap-2">
              <span className="text-xs">{t("viz.flow.title", { defaultValue: "Transaction flow" })}</span>
              {isCoinJoinOverride && onExitLinkability && (
                <button
                  onClick={onExitLinkability}
                  className="text-[10px] px-2 py-0.5 rounded-full border border-card-border text-muted hover:text-foreground hover:border-muted transition-colors cursor-pointer"
                  title="Back to CoinJoin structure"
                >
                  CJ view
                </button>
              )}
            </span>
            <button
              onClick={() => { setShowAllInputs(true); setShowAllOutputs(true); expand(); }}
              className="text-muted hover:text-foreground transition-colors p-0.5 rounded cursor-pointer"
              title={t("viz.flow.expand", { defaultValue: "Expand to full view" })}
              aria-label={t("viz.flow.expand", { defaultValue: "Expand to full view" })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
            </button>
          </div>
          <span>{t("tx.outputCount", { count: tx.vout.length, defaultValue: `${tx.vout.length} outputs` })}</span>
        </div>

        <ParentSize style={{ height: "auto" }}>
          {({ width }) => {
            if (width < 1) return null;
            return (
              <div
                style={{
                  maxHeight: needsScroll ? MAX_VISIBLE_HEIGHT : undefined,
                  overflowY: needsScroll ? "auto" : undefined,
                }}
              >
                <FlowChart
                  width={width}
                  height={chartHeight}
                  tx={tx}
                  findings={findings}
                  onAddressClick={onAddressClick}
                  usdPrice={usdPrice}
                  outspends={outspends}
                  boltzmannResult={boltzmannResult}
                  showAllInputs={showAllInputs}
                  showAllOutputs={showAllOutputs}
                  onToggleShowAllInputs={() => setShowAllInputs(true)}
                  onToggleShowAllOutputs={() => setShowAllOutputs(true)}
                  linkabilityMode={linkabilityMode}
                />
              </div>
            );
          }}
        </ParentSize>

        {/* Fee + size info */}
        <div className="flex items-center justify-between text-sm text-muted border-t border-card-border pt-2">
          <span>
            {t("tx.fee", {
              amount: formatSats(tx.fee, i18n.language),
              rate: calcFeeRate(tx),
              defaultValue: `Fee: ${formatSats(tx.fee, i18n.language)} (${calcFeeRate(tx)} sat/vB)`,
            })}
          </span>
          <span>{tx.weight.toLocaleString(i18n.language)} WU</span>
        </div>
      </div>

      {/* Fullscreen modal overlay */}
      {isExpanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("viz.flow.fullscreen", { defaultValue: "Transaction flow fullscreen" })}
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex flex-col"
          onClick={(e) => { if (e.target === e.currentTarget) collapse(); }}
        >
          <div className="flex items-center justify-between p-4 text-sm text-muted">
            <span>{t("tx.inputCount", { count: tx.vin.length, defaultValue: `${tx.vin.length} inputs` })}</span>
            <span className="text-xs uppercase tracking-wider">{t("viz.flow.title", { defaultValue: "Transaction flow" })}</span>
            <div className="flex items-center gap-3">
              <span>{t("tx.outputCount", { count: tx.vout.length, defaultValue: `${tx.vout.length} outputs` })}</span>
              <button
                onClick={collapse}
                className="text-muted hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-surface-inset"
                aria-label={t("common.close", { defaultValue: "Close" })}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto px-4 pb-4">
            <ParentSize>
              {({ width }) => {
                if (width < 1) return null;
                const expandedMaxSide = Math.max(
                  tx.vin.length,
                  tx.vout.length,
                );
                const expandedHeight = Math.max(400, expandedMaxSide * 40 + 40);
                return (
                  <FlowChart
                    width={width}
                    height={expandedHeight}
                    tx={tx}
                    findings={findings}
                    onAddressClick={onAddressClick}
                    usdPrice={usdPrice}
                    outspends={outspends}
                    boltzmannResult={boltzmannResult}
                    showAllInputs={true}
                    showAllOutputs={true}
                    onToggleShowAllInputs={() => {}}
                    onToggleShowAllOutputs={() => {}}
                    linkabilityMode={linkabilityMode}
                  />
                );
              }}
            </ParentSize>
          </div>
        </div>
      )}
    </>
  );
}
