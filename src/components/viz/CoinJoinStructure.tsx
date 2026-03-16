"use client";

import { useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Sankey } from "@visx/sankey";
import { Group } from "@visx/group";
import { Text } from "@visx/text";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { SVG_COLORS, ANIMATION_DEFAULTS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { formatSats, formatUsdValue, calcFeeRate } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import type { SankeyExtraProperties, SankeyGraph } from "d3-sankey";
import type { SankeyComputedNode, SankeyComputedLink } from "./shared/sankeyTypes";

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

interface NodeDatum extends SankeyExtraProperties {
  id: string;
  label: string;
  fullAddress?: string;
  value: number;
  side: "input" | "output" | "mixer";
  tierValue?: number;
  tierCount?: number;
  /** Number of outputs in this tier that were consolidated (spent together post-mix). */
  consolidatedCount?: number;
  /** Parent txid shared with other inputs (input-side consolidation). */
  sharedParentTxid?: string;
  /** How many inputs share this parent txid. */
  sharedParentCount?: number;
  /** Known entity name for this address. */
  entityName?: string;
}

interface LinkDatum extends SankeyExtraProperties {
  source: string;
  target: string;
  value: number;
}

/** A group of outputs that were consolidated (spent in the same child tx). */
interface ConsolidationGroup {
  childTxid: string;
  outputIndices: number[];
}

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

interface CoinJoinChartProps extends Omit<CoinJoinStructureProps, "findings"> {
  width: number;
  height: number;
  showAllInputs: boolean;
  onToggleShowAllInputs: () => void;
  aggregateInputs: boolean;
  maxOutputNodes: number;
}

function CoinJoinChart({
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
  const denomGroups = useMemo(() => {
    const valueCounts = new Map<number, number>();
    for (const out of tx.vout) {
      valueCounts.set(out.value, (valueCounts.get(out.value) ?? 0) + 1);
    }
    // Equal-value groups with 2+ outputs are "tiers"
    const tiers: { value: number; count: number }[] = [];
    const others: number[] = [];
    for (const [value, count] of valueCounts) {
      if (count >= 2) {
        tiers.push({ value, count });
      } else {
        others.push(value);
      }
    }
    tiers.sort((a, b) => b.value - a.value);
    return { tiers, otherValues: others };
  }, [tx.vout]);

  // Detect post-mix consolidation: outputs spent together in the same child tx
  const consolidationData = useMemo(() => {
    const empty = { counts: new Map<number, number>(), groups: new Map<number, ConsolidationGroup[]>() };
    if (!outspends) return empty;

    // Group output indices by spending txid
    const byChild = new Map<string, number[]>();
    for (let i = 0; i < outspends.length; i++) {
      const os = outspends[i];
      if (os?.spent && os.txid) {
        const group = byChild.get(os.txid) ?? [];
        group.push(i);
        byChild.set(os.txid, group);
      }
    }

    // Find groups where 2+ outputs share a spending tx
    const consolidatedGroups: ConsolidationGroup[] = [];
    const consolidated = new Set<number>();
    for (const [childTxid, indices] of byChild) {
      if (indices.length >= 2) {
        consolidatedGroups.push({ childTxid, outputIndices: indices });
        for (const idx of indices) consolidated.add(idx);
      }
    }

    // Aggregate per tier value
    const counts = new Map<number, number>();
    const groups = new Map<number, ConsolidationGroup[]>();
    for (const idx of consolidated) {
      const val = tx.vout[idx]?.value;
      if (val != null) counts.set(val, (counts.get(val) ?? 0) + 1);
    }
    for (const group of consolidatedGroups) {
      // Assign this group to all tier values it touches
      const tierValues = new Set(group.outputIndices.map((i) => tx.vout[i]?.value).filter((v): v is number => v != null));
      for (const tv of tierValues) {
        const list = groups.get(tv) ?? [];
        list.push(group);
        groups.set(tv, list);
      }
    }
    return { counts, groups };
  }, [outspends, tx.vout]);

  // Detect input-side consolidation: inputs from the same parent tx
  const inputConsolidation = useMemo(() => {
    const byParent = new Map<string, number[]>();
    for (let i = 0; i < tx.vin.length; i++) {
      const parentTxid = tx.vin[i]?.txid;
      if (!parentTxid) continue;
      const group = byParent.get(parentTxid) ?? [];
      group.push(i);
      byParent.set(parentTxid, group);
    }
    // Map: inputIndex -> { parentTxid, groupSize } for groups with 2+ inputs
    const result = new Map<number, { parentTxid: string; count: number }>();
    for (const [parentTxid, indices] of byParent) {
      if (indices.length >= 2) {
        for (const idx of indices) {
          result.set(idx, { parentTxid, count: indices.length });
        }
      }
    }
    return result;
  }, [tx.vin]);

  const { graph, hiddenInputCount } = useMemo(() => {
    const nodes: NodeDatum[] = [];
    const links: LinkDatum[] = [];
    let hiddenIn = 0;

    const totalInputValue = tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);

    if (aggregateInputs) {
      // Single summary node for all inputs
      const aggConsolidated = inputConsolidation.size;
      nodes.push({
        id: "in-agg",
        label: t("viz.coinjoin.inputSummary", {
          count: tx.vin.length,
          defaultValue: `${tx.vin.length} participants`,
        }),
        value: Math.max(totalInputValue, 1),
        side: "input",
        consolidatedCount: aggConsolidated > 0 ? aggConsolidated : undefined,
      });
    } else {
      const displayInputs = showAllInputs ? tx.vin : tx.vin.slice(0, MAX_DISPLAY);
      hiddenIn = tx.vin.length - displayInputs.length;

      for (let i = 0; i < displayInputs.length; i++) {
        const vin = displayInputs[i];
        const addr = vin.prevout?.scriptpubkey_address;
        const val = vin.prevout?.value ?? 0;
        const ic = inputConsolidation.get(i);
        const entity = addr ? matchEntitySync(addr) : null;
        nodes.push({
          id: `in-${i}`,
          label: truncateId(addr ?? "?", 5),
          fullAddress: addr,
          value: Math.max(val, 1),
          side: "input",
          sharedParentTxid: ic?.parentTxid,
          sharedParentCount: ic?.count,
          entityName: entity?.entityName,
        });
      }
    }
    nodes.push({
      id: "mixer",
      label: t("viz.coinjoin.mixingZone", { defaultValue: "Mixing zone" }),
      value: Math.max(totalInputValue, 1),
      side: "mixer",
    });
    // Output nodes: group by denomination tier, capped for readability
    const outputNodes: NodeDatum[] = [];

    // Sort tiers by count (largest anonymity set first)
    const sortedTiers = [...denomGroups.tiers].sort((a, b) => b.count - a.count);
    const displayTiers = sortedTiers.slice(0, maxOutputNodes - 1); // reserve 1 for summary
    const remainingTiers = sortedTiers.slice(maxOutputNodes - 1);

    for (const tier of displayTiers) {
      const cc = consolidationData.counts.get(tier.value) ?? 0;
      outputNodes.push({
        id: `tier-${tier.value}`,
        label: `${tier.count}x ${formatSats(tier.value, i18n.language)}`,
        value: tier.value * tier.count,
        side: "output",
        tierValue: tier.value,
        tierCount: tier.count,
        consolidatedCount: cc > 0 ? cc : undefined,
      });
    }

    // Aggregate remaining tiers + "other" unique outputs into a single summary
    const remainingTierOutputCount = remainingTiers.reduce((s, tier) => s + tier.count, 0);
    const remainingTierValue = remainingTiers.reduce((s, tier) => s + tier.value * tier.count, 0);
    const otherTotalValue = denomGroups.otherValues.reduce((s, v) => s + v, 0);
    const otherCount = denomGroups.otherValues.length;
    const aggregatedCount = remainingTierOutputCount + otherCount;
    const aggregatedValue = remainingTierValue + otherTotalValue;

    if (aggregatedCount > 0) {
      outputNodes.push({
        id: "other-agg",
        label: t("viz.coinjoin.otherOutputs", {
          count: aggregatedCount,
          defaultValue: `${aggregatedCount} other outputs`,
        }),
        value: Math.max(aggregatedValue, 1),
        side: "output",
      });
      // These outputs are represented in the aggregate node, not hidden
    }

    nodes.push(...outputNodes);

    // Links: all inputs -> mixer
    if (aggregateInputs) {
      links.push({
        source: "in-agg",
        target: "mixer",
        value: Math.max(1, totalInputValue),
      });
    } else {
      const linkInputs = showAllInputs ? tx.vin : tx.vin.slice(0, MAX_DISPLAY);
      for (let i = 0; i < linkInputs.length; i++) {
        links.push({
          source: `in-${i}`,
          target: "mixer",
          value: Math.max(1, linkInputs[i].prevout?.value ?? 1),
        });
      }
    }

    // Links: mixer -> outputs (use string IDs)
    for (const outNode of outputNodes) {
      links.push({
        source: "mixer",
        target: outNode.id,
        value: Math.max(1, outNode.value),
      });
    }

    const g: SankeyGraph<NodeDatum, LinkDatum> = { nodes, links };
    return { graph: g, hiddenInputCount: hiddenIn };
  }, [tx, showAllInputs, denomGroups, consolidationData, inputConsolidation, aggregateInputs, maxOutputNodes, t, i18n]);

  const marginH = width < 500 ? 80 : 150;
  const MARGIN = { top: 12, right: marginH, bottom: 24, left: marginH };
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  if (innerWidth < 100 || innerHeight < 60) return null;

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

        <Sankey<NodeDatum, LinkDatum>
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
                const cl = link as SankeyComputedLink<NodeDatum, LinkDatum>;
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
                const n = node as SankeyComputedNode<NodeDatum>;
                const nodeWidth = n.x1 - n.x0;
                const nodeHeight = Math.max(2, n.y1 - n.y0);
                const isMixer = n.side === "mixer";
                const isInput = n.side === "input";
                const isClickable = !!n.fullAddress && !!onAddressClick;

                const isTier = !!n.tierCount;
                const isConsolidated = (n.consolidatedCount ?? 0) > 0;
                const isInputConsolidated = isInput && !!n.sharedParentTxid;
                // Check available vertical space to avoid label overlap
                const hasLabelSpace = nodeHeight >= 14;
                const hasSubLabelSpace = nodeHeight >= 24;

                let fillColor: string;
                let glowFilter: string | undefined;
                if (isMixer) {
                  fillColor = "url(#grad-mixer)";
                  glowFilter = "url(#glow-medium)";
                } else if (isInput) {
                  fillColor = "url(#grad-input)";
                } else if (isTier) {
                  fillColor = "url(#grad-mixer)";
                  glowFilter = "url(#glow-subtle)";
                } else {
                  fillColor = "url(#grad-output)";
                }

                const labelX = isInput ? n.x0 - 8 : n.x1 + 10;
                const labelAnchor = isInput ? "end" : "start";
                // Labels render in the margin area, so use margin width (not node position)
                const labelMaxWidth = isInput ? MARGIN.left - 8 : MARGIN.right - 8;

                // Expand hitbox for easier hover/touch
                const hitboxPad = 70;
                const hitboxX = isInput ? n.x0 - hitboxPad : n.x0;
                const hitboxW = nodeWidth + hitboxPad;
                const hitboxH = Math.max(nodeHeight, 18);
                const hitboxY = n.y0 - (hitboxH - nodeHeight) / 2;

                const showNodeTooltip = (e: React.MouseEvent) => {
                  const container = containerRef.current;
                  if (!container) return;
                  const containerRect = container.getBoundingClientRect();
                  const elemRect = (e.currentTarget as Element).getBoundingClientRect();
                  // Compute spent/unspent counts for tier nodes
                  let spentCount: number | undefined;
                  let unspentCount: number | undefined;
                  if (outspends && n.tierValue != null) {
                    let s = 0, u = 0;
                    for (let oi = 0; oi < tx.vout.length; oi++) {
                      if (tx.vout[oi].value === n.tierValue) {
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
                    tooltipLeft: elemRect.left - containerRect.left + elemRect.width / 2,
                    tooltipTop: elemRect.top - containerRect.top,
                  });
                };

                return (
                  <Group key={n.id}>
                    {/* Invisible expanded hitbox for hover/touch */}
                    {!isMixer && (
                      <rect
                        x={hitboxX}
                        y={hitboxY}
                        width={hitboxW}
                        height={hitboxH}
                        fill="transparent"
                        cursor={isClickable ? "pointer" : "default"}
                        tabIndex={isClickable ? 0 : undefined}
                        role={isClickable ? "button" : undefined}
                        aria-label={isClickable ? t("viz.cj.scanAddress", { address: n.fullAddress, defaultValue: `Scan ${n.fullAddress}` }) : undefined}
                        className={isClickable ? "outline-none focus-visible:outline-2 focus-visible:outline-bitcoin" : ""}
                        onClick={() => {
                          if (n.fullAddress && onAddressClick) onAddressClick(n.fullAddress);
                        }}
                        onKeyDown={(e: React.KeyboardEvent) => {
                          if ((e.key === "Enter" || e.key === " ") && n.fullAddress && onAddressClick) {
                            e.preventDefault();
                            onAddressClick(n.fullAddress);
                          }
                        }}
                        onMouseEnter={showNodeTooltip}
                        onMouseLeave={() => hideTooltip()}
                      />
                    )}

                    <motion.rect
                      x={n.x0}
                      y={n.y0}
                      width={nodeWidth}
                      height={nodeHeight}
                      fill={fillColor}
                      filter={glowFilter}
                      rx={isMixer ? 0 : 3}
                      stroke={isMixer ? SVG_COLORS.good : (isConsolidated || isInputConsolidated) ? SVG_COLORS.critical : undefined}
                      strokeOpacity={isMixer ? 0.5 : (isConsolidated || isInputConsolidated) ? 0.8 : undefined}
                      strokeWidth={isMixer ? 1 : (isConsolidated || isInputConsolidated) ? 1.5 : undefined}
                      initial={reducedMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{
                        delay: i * ANIMATION_DEFAULTS.stagger,
                        duration: ANIMATION_DEFAULTS.duration,
                      }}
                      style={isMixer ? undefined : { pointerEvents: "none" as const }}
                      onMouseEnter={isMixer ? showNodeTooltip : undefined}
                      onMouseLeave={isMixer ? () => hideTooltip() : undefined}
                    />

                    {/* Red damage bar overlay for consolidated tiers */}
                    {isConsolidated && isTier && n.tierCount && (
                      <rect
                        x={n.x0 + 1}
                        y={n.y1 - Math.max(2, nodeHeight * (n.consolidatedCount! / n.tierCount))}
                        width={nodeWidth - 2}
                        height={Math.max(2, nodeHeight * (n.consolidatedCount! / n.tierCount))}
                        fill={SVG_COLORS.critical}
                        fillOpacity={0.4}
                        rx={2}
                        style={{ pointerEvents: "none" as const }}
                      />
                    )}

                    {/* Mixer pattern overlay */}
                    {isMixer && (
                      <rect
                        x={n.x0}
                        y={n.y0}
                        width={nodeWidth}
                        height={nodeHeight}
                        fill="url(#mixer-pattern-v2)"
                      />
                    )}

                    {/* Mixer label */}
                    {isMixer && (
                      <Text
                        x={n.x0 + nodeWidth / 2}
                        y={n.y0 + nodeHeight / 2}
                        textAnchor="middle"
                        verticalAnchor="middle"
                        fontSize={13}
                        fill={SVG_COLORS.foreground}
                        fillOpacity={0.9}
                        angle={-90}
                      >
                        {t("viz.coinjoin.mixingZone", { defaultValue: "Mixing zone" })}
                      </Text>
                    )}

                    {/* Label - clickable for addresses */}
                    {!isMixer && labelMaxWidth > 30 && hasLabelSpace && (
                      <Text
                        x={labelX}
                        y={n.y0 + nodeHeight / 2 - (hasSubLabelSpace ? 4 : 0)}
                        textAnchor={labelAnchor}
                        verticalAnchor="middle"
                        fontSize={11}
                        fontFamily="var(--font-geist-mono), monospace"
                        fill={isClickable ? SVG_COLORS.bitcoin : n.tierCount ? SVG_COLORS.bitcoin : SVG_COLORS.foreground}
                        style={{ cursor: isClickable ? "pointer" : "default", textDecoration: isClickable ? "underline" : "none", pointerEvents: "none" as const }}
                        width={Math.min(labelMaxWidth, 140)}
                      >
                        {n.label}
                      </Text>
                    )}

                    {/* Entity / value label or consolidation warning below address for inputs and non-tier outputs */}
                    {!isMixer && !isTier && labelMaxWidth > 30 && hasSubLabelSpace && (
                      isInputConsolidated ? (
                        <Text
                          x={labelX}
                          y={n.y0 + nodeHeight / 2 + 10}
                          textAnchor={labelAnchor}
                          verticalAnchor="middle"
                          fontSize={9}
                          fontWeight={600}
                          fill={SVG_COLORS.critical}
                          style={{ pointerEvents: "none" as const }}
                        >
                          {`${n.sharedParentCount} from ${truncateId(n.sharedParentTxid!, 5)}`}
                        </Text>
                      ) : n.entityName ? (
                        <Text
                          x={labelX}
                          y={n.y0 + nodeHeight / 2 + 10}
                          textAnchor={labelAnchor}
                          verticalAnchor="middle"
                          fontSize={9}
                          fontWeight={700}
                          fill={SVG_COLORS.critical}
                          style={{ pointerEvents: "none" as const }}
                          width={Math.min(labelMaxWidth, 140)}
                        >
                          {n.entityName}
                        </Text>
                      ) : (
                        <Text
                          x={labelX}
                          y={n.y0 + nodeHeight / 2 + 10}
                          textAnchor={labelAnchor}
                          verticalAnchor="middle"
                          fontSize={10}
                          fill={SVG_COLORS.muted}
                          style={{ pointerEvents: "none" as const }}
                        >
                          {formatSats(n.value, i18n.language)}
                        </Text>
                      )
                    )}

                    {/* Consolidation warning for tier outputs */}
                    {!isMixer && isTier && labelMaxWidth > 30 && hasSubLabelSpace && isConsolidated && (
                      <Text
                        x={labelX}
                        y={n.y0 + nodeHeight / 2 + 10}
                        textAnchor={labelAnchor}
                        verticalAnchor="middle"
                        fontSize={9}
                        fontWeight={600}
                        fill={SVG_COLORS.critical}
                        style={{ pointerEvents: "none" as const }}
                      >
                        {`${n.consolidatedCount} of ${n.tierCount} re-linked`}
                      </Text>
                    )}
                  </Group>
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

