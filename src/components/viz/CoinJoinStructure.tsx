"use client";

import { useState } from "react";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { formatSats, calcFeeRate } from "@/lib/format";
import { CoinJoinChart } from "./CoinJoinChart";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { Finding } from "@/lib/types";

interface CoinJoinStructureProps {
  tx: MempoolTransaction;
  findings: Finding[];
  onAddressClick?: (address: string) => void;
  /** USD per BTC at the time the transaction was confirmed (mainnet only). */
  usdPrice?: number | null;
  /** Per-output spend status. */
  outspends?: MempoolOutspend[] | null;
  /** Whether Boltzmann linkability data is available for this CoinJoin. */
  linkabilityAvailable?: boolean;
  /** Callback to switch to TxFlowDiagram with linkability coloring. */
  onToggleLinkability?: () => void;
}

const MAX_DISPLAY = 50;
const MIN_NODE_SPACING = 30; // min px per output node for readable labels

export function CoinJoinStructure({ tx, findings, onAddressClick, usdPrice, outspends, linkabilityAvailable, onToggleLinkability }: CoinJoinStructureProps) {
  const { t, i18n } = useTranslation();
  useTheme(); // re-render on theme change for SVG_COLORS
  const [showAllInputs, setShowAllInputs] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Only render for CoinJoin txs
  const isCoinJoin = findings.some((f) => f.id.startsWith("h4-"));
  if (!isCoinJoin) return null;

  // For very large CoinJoins (50+ inputs), aggregate inputs into a summary node
  const aggregateInputs = tx.vin.length > MAX_DISPLAY;
  const displayInCount = aggregateInputs ? 1 : (showAllInputs ? tx.vin.length : Math.min(tx.vin.length, MAX_DISPLAY));

  // Dynamic output node limit based on available height
  const baseMaxHeight = expanded ? 900 : 500;
  const maxOutputNodes = Math.max(6, Math.floor((baseMaxHeight - 60) / MIN_NODE_SPACING) - 2);
  const estimatedOutputNodes = Math.min(maxOutputNodes + 1, tx.vout.length + 1);
  const nodeCount = displayInCount + 1 + estimatedOutputNodes;
  const chartHeight = Math.max(240, Math.min(baseMaxHeight, nodeCount * MIN_NODE_SPACING + 60));

  // Show expand button when there are more output tiers than the default can show
  const uniqueOutputValues = new Set(tx.vout.map((o) => o.value));
  const canExpand = aggregateInputs && uniqueOutputValues.size > maxOutputNodes && !expanded;

  return (
    <div className="w-full glass rounded-xl p-4 sm:p-6 space-y-3">
      <div className="flex items-center justify-between text-sm text-muted uppercase tracking-wider">
        <span>
          {t("tx.inputCount", { count: tx.vin.length, defaultValue: `${tx.vin.length} inputs` })}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-bitcoin">
            {t("viz.coinjoin.title", { defaultValue: "CoinJoin structure" })}
          </span>
          {linkabilityAvailable && onToggleLinkability && (
            <button
              onClick={onToggleLinkability}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-foreground/5 text-muted hover:bg-foreground/10 hover:text-foreground transition-colors cursor-pointer"
              title="Switch to linkability view"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
              Linkability
            </button>
          )}
        </span>
        <span>
          {t("tx.outputCount", { count: tx.vout.length, defaultValue: `${tx.vout.length} outputs` })}
        </span>
      </div>

      <div style={{ minHeight: 240 }}>
        <ParentSize>
          {({ width }) => {
            if (width < 1) return null;
            return (
              <CoinJoinChart
                width={width}
                height={chartHeight}
                tx={tx}
                onAddressClick={onAddressClick}
                usdPrice={usdPrice}
                outspends={outspends}
                showAllInputs={showAllInputs}
                onToggleShowAllInputs={() => setShowAllInputs(true)}
                aggregateInputs={aggregateInputs}
                maxOutputNodes={maxOutputNodes}
              />
            );
          }}
        </ParentSize>
      </div>

      {/* Fee + size info */}
      <div className="flex items-center justify-between text-sm text-muted border-t border-card-border pt-2">
        <span>
          {t("tx.fee", {
            amount: formatSats(tx.fee, i18n.language),
            rate: calcFeeRate(tx),
            defaultValue: `Fee: ${formatSats(tx.fee, i18n.language)} (${calcFeeRate(tx)} sat/vB)`,
          })}
        </span>
        <div className="flex items-center gap-3">
          {(canExpand || expanded) && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="text-xs text-bitcoin/70 hover:text-bitcoin transition-colors cursor-pointer"
            >
              {expanded
                ? t("viz.coinjoin.collapse", { defaultValue: "Show less" })
                : t("viz.coinjoin.expand", { defaultValue: "Show all tiers" })}
            </button>
          )}
          <span>{tx.weight.toLocaleString(i18n.language)} WU</span>
        </div>
      </div>
    </div>
  );
}
