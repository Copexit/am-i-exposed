"use client";

import { useMemo, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Sankey } from "@visx/sankey";
import { Group } from "@visx/group";
import { useTranslation } from "react-i18next";
import { SVG_COLORS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, anchorTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { formatSats, formatUsdValue } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { CoinJoinNode } from "./CoinJoinNode";
import {
  buildDenomGroups,
  buildConsolidationData,
  buildInputConsolidation,
  buildCoinJoinGraph,
} from "./buildCoinJoinGraph";
import type { CoinJoinNodeDatum, ConsolidationGroup } from "./buildCoinJoinGraph";
import type { LinkDatum } from "./shared/sankeyTypes";
import type { SankeyComputedNode, SankeyComputedLink } from "./shared/sankeyTypes";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";

interface TooltipData {
  label: string;
  value: number;
  tierCount?: number;
  lang: string;
  spentCount?: number;
  unspentCount?: number;
  consolidatedCount?: number;
  /** Per-child-tx groups of consolidated output indices for this tier. */
  consolidationGroups?: ConsolidationGroup[];
  /** Parent txid shared with other inputs (input-side). */
  sharedParentTxid?: string;
  /** How many inputs share this parent. */
  sharedParentCount?: number;
}

const NODE_WIDTH = 14;
const NODE_PADDING = 10;

export interface CoinJoinChartProps {
  tx: MempoolTransaction;
  onAddressClick?: (address: string) => void;
  /** USD per BTC at the time the transaction was confirmed (mainnet only). */
  usdPrice?: number | null;
  /** Per-output spend status. */
  outspends?: MempoolOutspend[] | null;
  width: number;
  height: number;
  showAllInputs: boolean;
  onToggleShowAllInputs: () => void;
  aggregateInputs: boolean;
  maxOutputNodes: number;
}

export function CoinJoinChart({
  width,
  height,
  tx,
  onAddressClick,
  usdPrice,
  outspends,
  showAllInputs,
  onToggleShowAllInputs,
  aggregateInputs,
  maxOutputNodes,
}: CoinJoinChartProps) {
  const { t, i18n } = useTranslation();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const { tooltipOpen, tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip, handleTouch } =
    useChartTooltip<TooltipData>();

  // Group outputs by denomination tier
  const denomGroups = useMemo(() => buildDenomGroups(tx.vout), [tx.vout]);

  // Detect post-mix consolidation
  const consolidationData = useMemo(
    () => buildConsolidationData(outspends, tx.vout),
    [outspends, tx.vout],
  );

  // Detect input-side consolidation
  const inputConsolidation = useMemo(
    () => buildInputConsolidation(tx.vin),
    [tx.vin],
  );

  const { graph, hiddenInputCount } = useMemo(
    () => buildCoinJoinGraph(tx, {
      showAllInputs,
      aggregateInputs,
      maxOutputNodes,
      denomGroups,
      consolidationData,
      inputConsolidation,
      t,
      lang: i18n.language,
    }),
    [tx, showAllInputs, denomGroups, consolidationData, inputConsolidation, aggregateInputs, maxOutputNodes, t, i18n],
  );

  const marginH = width < 500 ? 80 : 150;
  const MARGIN = { top: 12, right: marginH, bottom: 24, left: marginH };
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  if (innerWidth < 100 || innerHeight < 60) return null;

  const showNodeTooltip = (n: SankeyComputedNode<CoinJoinNodeDatum>, e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    // Compute spent/unspent counts for tier nodes
    let spentCount: number | undefined;
    let unspentCount: number | undefined;
    if (outspends && n.tierValue != null) {
      let s = 0, u = 0;
      for (const [oi, vout] of tx.vout.entries()) {
        if (vout.value === n.tierValue) {
          if (outspends[oi]?.spent) s++; else u++;
        }
      }
      spentCount = s;
      unspentCount = u;
    }
    // Get consolidation group details for this tier
    const tierGroups = n.tierValue != null
      ? consolidationData.groups.get(n.tierValue)
      : undefined;

    showTooltip({
      tooltipData: {
        label: n.fullAddress ?? n.label,
        value: n.value,
        tierCount: n.tierCount,
        lang: i18n.language,
        spentCount,
        unspentCount,
        consolidatedCount: n.consolidatedCount,
        consolidationGroups: tierGroups,
        sharedParentTxid: n.sharedParentTxid,
        sharedParentCount: n.sharedParentCount,
      },
      ...anchorTooltip(e.currentTarget as Element, container),
    });
  };

  return (
    <div className="relative" ref={containerRef} onTouchStart={handleTouch}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={t("viz.coinjoin.aria", {
          inputs: tx.vin.length,
          outputs: tx.vout.length,
          defaultValue: `CoinJoin structure: ${tx.vin.length} inputs mixed into ${tx.vout.length} outputs`,
        })}
      >
        <ChartDefs />

        <Sankey<CoinJoinNodeDatum, LinkDatum>
          root={graph}
          size={[innerWidth, innerHeight]}
          nodeWidth={NODE_WIDTH}
          nodePadding={NODE_PADDING}
          nodeId={(d) => d.id}
          iterations={32}
        >
          {({ graph: computed, createPath }) => (
            <Group top={MARGIN.top} left={MARGIN.left}>
              {/* Links */}
              {(computed.links ?? []).map((link, i) => {
                const path = createPath(link);
                const pathD = path ?? "";
                const cl = link as SankeyComputedLink<CoinJoinNodeDatum, LinkDatum>;
                const sourceNode = cl.source;
                const targetNode = cl.target;
                const intoMixer = targetNode.id === "mixer";
                const outOfMixer = sourceNode.id === "mixer";
                const linkStroke = intoMixer
                  ? "url(#grad-cj-link-in)"
                  : outOfMixer
                    ? "url(#grad-cj-link-out)"
                    : SVG_COLORS.muted;

                // Single aggregated input link is very wide - needs higher opacity to be visible
                const isAggInputLink = aggregateInputs && intoMixer;
                const linkOpacity = isAggInputLink ? 0.45 : 0.25;

                return (
                  <motion.path
                    key={`link-${i}`}
                    d={pathD}
                    fill="none"
                    stroke={linkStroke}
                    strokeWidth={Math.max(1, cl.width ?? 1)}
                    strokeOpacity={linkOpacity}
                    initial={reducedMotion ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{
                      delay: 0.3 + i * 0.01,
                      duration: 0.6,
                      ease: [0.4, 0, 0.2, 1],
                    }}
                  />
                );
              })}

              {/* Nodes */}
              {(computed.nodes ?? []).map((node, i) => {
                const n = node as SankeyComputedNode<CoinJoinNodeDatum>;

                return (
                  <CoinJoinNode
                    key={n.id}
                    node={n}
                    index={i}
                    margin={{ left: MARGIN.left, right: MARGIN.right }}
                    reducedMotion={reducedMotion}
                    lang={i18n.language}
                    onAddressClick={onAddressClick}
                    onMouseEnter={(e: React.MouseEvent) => showNodeTooltip(n, e)}
                    onMouseLeave={() => hideTooltip()}
                    consolidationData={consolidationData}
                    outspends={outspends}
                    t={t}
                  />
                );
              })}
            </Group>
          )}
        </Sankey>
      </svg>

      {tooltipOpen && tooltipData && (
        <ChartTooltip top={tooltipTop ?? 0} left={tooltipLeft ?? 0} containerRef={containerRef}>
          <div className="space-y-0.5">
            <p className="font-mono text-xs" style={{ color: SVG_COLORS.foreground }}>
              {tooltipData.label}
            </p>
            <p className="text-xs" style={{ color: SVG_COLORS.muted }}>
              {formatSats(tooltipData.value, tooltipData.lang)}
              {usdPrice != null && ` (${formatUsdValue(tooltipData.value, usdPrice)})`}
            </p>
            {tooltipData.tierCount != null && tooltipData.tierCount > 0 && (
              <p className="text-xs" style={{ color: SVG_COLORS.bitcoin }}>
                {t("viz.coinjoin.tier", { count: tooltipData.tierCount, defaultValue: `${tooltipData.tierCount} equal outputs` })}
              </p>
            )}
            {tooltipData.spentCount != null && tooltipData.unspentCount != null && (
              <p className="text-xs" style={{ color: SVG_COLORS.muted }}>
                <span style={{ color: SVG_COLORS.good }}>{tooltipData.unspentCount} {t("viz.flow.unspentShort", { defaultValue: "unspent" })}</span>
                {" / "}
                <span style={{ color: SVG_COLORS.critical }}>{tooltipData.spentCount} {t("viz.flow.spentShort", { defaultValue: "spent" })}</span>
              </p>
            )}
            {tooltipData.consolidationGroups && tooltipData.consolidationGroups.length > 0 && (
              <div className="border-t border-card-border pt-1 mt-1 space-y-0.5">
                <p className="text-xs font-semibold" style={{ color: SVG_COLORS.critical }}>
                  {tooltipData.consolidatedCount} of {tooltipData.tierCount} re-linked:
                </p>
                {tooltipData.consolidationGroups.map((g) => (
                  <p key={g.childTxid} className="text-xs font-mono" style={{ color: SVG_COLORS.critical }}>
                    #{g.outputIndices.join(", #")} {"\u2192"} {truncateId(g.childTxid, 6)}
                  </p>
                ))}
              </div>
            )}
            {tooltipData.sharedParentTxid && (
              <p className="text-xs font-semibold border-t border-card-border pt-1 mt-1" style={{ color: SVG_COLORS.critical }}>
                {tooltipData.sharedParentCount} inputs from {truncateId(tooltipData.sharedParentTxid, 6)}
              </p>
            )}
          </div>
        </ChartTooltip>
      )}

      {/* Expand button for hidden inputs only */}
      {hiddenInputCount > 0 && (
        <div className="px-2 mt-1">
          <button
            onClick={onToggleShowAllInputs}
            className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            {t("tx.moreItems", { count: hiddenInputCount, defaultValue: `+${hiddenInputCount} more` })}
          </button>
        </div>
      )}
    </div>
  );
}
