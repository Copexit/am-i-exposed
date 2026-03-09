"use client";

import { useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Sankey } from "@visx/sankey";
import { Group } from "@visx/group";
import { Text } from "@visx/text";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, ANIMATION_DEFAULTS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { formatSats, formatUsdValue } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import type { SankeyExtraProperties, SankeyGraph } from "d3-sankey";

interface CoinJoinStructureProps {
  tx: MempoolTransaction;
  findings: Finding[];
  onAddressClick?: (address: string) => void;
  /** USD per BTC at the time the transaction was confirmed (mainnet only). */
  usdPrice?: number | null;
  /** Per-output spend status. */
  outspends?: MempoolOutspend[] | null;
}

interface NodeDatum extends SankeyExtraProperties {
  id: string;
  label: string;
  fullAddress?: string;
  value: number;
  side: "input" | "output" | "mixer";
  tierValue?: number;
  tierCount?: number;
}

interface LinkDatum extends SankeyExtraProperties {
  source: string;
  target: string;
  value: number;
}

interface TooltipData {
  label: string;
  value: number;
  tierCount?: number;
  lang: string;
  spentCount?: number;
  unspentCount?: number;
}

const NODE_WIDTH = 14;
const NODE_PADDING = 10;
const MAX_DISPLAY = 50;
const MAX_OUTPUT_NODES = 20;

export function CoinJoinStructure({ tx, findings, onAddressClick, usdPrice, outspends }: CoinJoinStructureProps) {
  const { t, i18n } = useTranslation();
  const [showAllInputs, setShowAllInputs] = useState(false);

  // Only render for CoinJoin txs
  const isCoinJoin = findings.some((f) => f.id.startsWith("h4-"));
  if (!isCoinJoin) return null;

  // For very large CoinJoins (50+ inputs), aggregate inputs into a summary node
  const aggregateInputs = tx.vin.length > MAX_DISPLAY;
  const displayInCount = aggregateInputs ? 1 : (showAllInputs ? tx.vin.length : Math.min(tx.vin.length, MAX_DISPLAY));
  const estimatedOutputNodes = Math.min(MAX_OUTPUT_NODES + 2, tx.vout.length + 2);
  const nodeCount = displayInCount + estimatedOutputNodes;
  const chartHeight = Math.max(240, Math.min(500, nodeCount * 22 + 60));

  return (
    <div className="w-full glass rounded-xl p-4 sm:p-6 space-y-3">
      <div className="flex items-center justify-between text-sm text-muted uppercase tracking-wider">
        <span>
          {t("tx.inputCount", { count: tx.vin.length, defaultValue: `${tx.vin.length} inputs` })}
        </span>
        <span className="text-xs text-bitcoin">
          {t("viz.coinjoin.title", { defaultValue: "CoinJoin structure" })}
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
            rate: cjFeeRate(tx),
            defaultValue: `Fee: ${formatSats(tx.fee, i18n.language)} (${cjFeeRate(tx)} sat/vB)`,
          })}
        </span>
        <span>{tx.weight.toLocaleString(i18n.language)} WU</span>
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

  const { graph, hiddenInputCount } = useMemo(() => {
    const nodes: NodeDatum[] = [];
    const links: LinkDatum[] = [];
    let hiddenIn = 0;

    const totalInputValue = tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);

    if (aggregateInputs) {
      // Single summary node for all inputs
      nodes.push({
        id: "in-agg",
        label: t("viz.coinjoin.inputSummary", {
          count: tx.vin.length,
          defaultValue: `${tx.vin.length} participants`,
        }),
        value: Math.max(totalInputValue, 1),
        side: "input",
      });
    } else {
      const displayInputs = showAllInputs ? tx.vin : tx.vin.slice(0, MAX_DISPLAY);
      hiddenIn = tx.vin.length - displayInputs.length;

      for (let i = 0; i < displayInputs.length; i++) {
        const vin = displayInputs[i];
        const addr = vin.prevout?.scriptpubkey_address;
        const val = vin.prevout?.value ?? 0;
        nodes.push({
          id: `in-${i}`,
          label: truncateId(addr ?? "?", 5),
          fullAddress: addr,
          value: Math.max(val, 1),
          side: "input",
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
    const displayTiers = sortedTiers.slice(0, MAX_OUTPUT_NODES - 1); // reserve 1 for summary
    const remainingTiers = sortedTiers.slice(MAX_OUTPUT_NODES - 1);

    for (const tier of displayTiers) {
      outputNodes.push({
        id: `tier-${tier.value}`,
        label: `${tier.count}x ${formatSats(tier.value, i18n.language)}`,
        value: tier.value * tier.count,
        side: "output",
        tierValue: tier.value,
        tierCount: tier.count,
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
  }, [tx, showAllInputs, denomGroups, aggregateInputs, t, i18n]);

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
                const sourceNode = link.source as unknown as NodeDatum & { id: string };
                const targetNode = link.target as unknown as NodeDatum & { id: string };
                const intoMixer = targetNode.id === "mixer";
                const outOfMixer = sourceNode.id === "mixer";
                const linkStroke = intoMixer
                  ? "url(#grad-cj-link-in)"
                  : outOfMixer
                    ? "url(#grad-cj-link-out)"
                    : SVG_COLORS.muted;

                return (
                  <motion.path
                    key={`link-${i}`}
                    d={pathD}
                    fill="none"
                    stroke={linkStroke}
                    strokeWidth={Math.max(1, (link as unknown as { width: number }).width ?? 1)}
                    strokeOpacity={0.25}
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
                const n = node as unknown as NodeDatum & {
                  x0: number; x1: number; y0: number; y1: number;
                };
                const nodeWidth = n.x1 - n.x0;
                const nodeHeight = Math.max(2, n.y1 - n.y0);
                const isMixer = n.side === "mixer";
                const isInput = n.side === "input";
                const isClickable = !!n.fullAddress && !!onAddressClick;

                const isTier = !!n.tierCount;
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

                const labelX = isInput ? n.x0 - 6 : n.x1 + 6;
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
                  showTooltip({
                    tooltipData: {
                      label: n.fullAddress ?? n.label,
                      value: n.value,
                      tierCount: n.tierCount,
                      lang: i18n.language,
                      spentCount,
                      unspentCount,
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
                      stroke={isMixer ? SVG_COLORS.good : undefined}
                      strokeOpacity={isMixer ? 0.5 : undefined}
                      strokeWidth={isMixer ? 1 : undefined}
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
                    {!isMixer && labelMaxWidth > 30 && (
                      <Text
                        x={labelX}
                        y={n.y0 + nodeHeight / 2 - (!isTier ? 6 : 0)}
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

                    {/* Value label below address for inputs and non-tier outputs */}
                    {!isMixer && !isTier && labelMaxWidth > 30 && (
                      <Text
                        x={labelX}
                        y={n.y0 + nodeHeight / 2 + 8}
                        textAnchor={labelAnchor}
                        verticalAnchor="middle"
                        fontSize={10}
                        fill={SVG_COLORS.muted}
                        style={{ pointerEvents: "none" as const }}
                      >
                        {usdPrice != null ? `${formatSats(n.value, i18n.language)} (${formatUsdValue(n.value, usdPrice)})` : formatSats(n.value, i18n.language)}
                      </Text>
                    )}

                    {/* USD value for tier outputs */}
                    {!isMixer && isTier && usdPrice != null && labelMaxWidth > 30 && (
                      <Text
                        x={labelX}
                        y={n.y0 + nodeHeight / 2 + 8}
                        textAnchor={labelAnchor}
                        verticalAnchor="middle"
                        fontSize={9}
                        fill={SVG_COLORS.muted}
                        style={{ pointerEvents: "none" as const }}
                      >
                        {`${formatUsdValue(n.tierValue ?? n.value, usdPrice)}${n.tierCount ? "/ea" : ""}`}
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
        <ChartTooltip top={tooltipTop ?? 0} left={tooltipLeft ?? 0}>
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

function cjFeeRate(tx: MempoolTransaction): string {
  const vsize = Math.ceil(tx.weight / 4);
  if (vsize === 0) return "0";
  return (tx.fee / vsize).toFixed(1);
}
