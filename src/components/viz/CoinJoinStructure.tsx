"use client";

import { useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Sankey } from "@visx/sankey";
import { Group } from "@visx/group";
import { Text } from "@visx/text";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, ANIMATION_DEFAULTS } from "./shared/svgConstants";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import type { SankeyExtraProperties, SankeyGraph } from "d3-sankey";

interface CoinJoinStructureProps {
  tx: MempoolTransaction;
  findings: Finding[];
  onAddressClick?: (address: string) => void;
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
}

const NODE_WIDTH = 14;
const NODE_PADDING = 10;
const MAX_DISPLAY = 10;

export function CoinJoinStructure({ tx, findings, onAddressClick }: CoinJoinStructureProps) {
  const { t } = useTranslation();

  // Only render for CoinJoin txs
  const isCoinJoin = findings.some((f) => f.id.startsWith("h4-"));
  if (!isCoinJoin) return null;

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
            const nodeCount = Math.min(tx.vin.length, MAX_DISPLAY) + Math.min(tx.vout.length, MAX_DISPLAY);
            const h = Math.max(240, Math.min(500, nodeCount * 22 + 60));
            return (
              <CoinJoinChart
                width={width}
                height={h}
                tx={tx}
                onAddressClick={onAddressClick}
              />
            );
          }}
        </ParentSize>
      </div>
    </div>
  );
}

function CoinJoinChart({
  width,
  height,
  tx,
  onAddressClick,
}: Omit<CoinJoinStructureProps, "findings"> & { width: number; height: number }) {
  const { t, i18n } = useTranslation();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showAllInputs, setShowAllInputs] = useState(false);
  const [showAllOutputs, setShowAllOutputs] = useState(false);
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

  const { graph, hiddenInputCount, hiddenOutputCount } = useMemo(() => {
    const displayInputs = showAllInputs ? tx.vin : tx.vin.slice(0, MAX_DISPLAY);
    const hiddenIn = tx.vin.length - displayInputs.length;

    const nodes: NodeDatum[] = [];
    const links: LinkDatum[] = [];

    // Input nodes
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

    // Mixing zone node
    const totalInputValue = displayInputs.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
    nodes.push({
      id: "mixer",
      label: t("viz.coinjoin.mixingZone", { defaultValue: "Mixing zone" }),
      value: Math.max(totalInputValue, 1),
      side: "mixer",
    });
    // Output nodes: group by denomination tier
    const outputNodes: NodeDatum[] = [];
    let hiddenOut = 0;

    for (const tier of denomGroups.tiers) {
      outputNodes.push({
        id: `tier-${tier.value}`,
        label: `${tier.count}x ${formatSats(tier.value, i18n.language)}`,
        value: tier.value * tier.count,
        side: "output",
        tierValue: tier.value,
        tierCount: tier.count,
      });
    }

    // "Other" outputs (change, coordinator fee, etc.)
    const displayOthers = showAllOutputs ? denomGroups.otherValues : denomGroups.otherValues.slice(0, 3);
    hiddenOut = denomGroups.otherValues.length - displayOthers.length;

    for (let i = 0; i < displayOthers.length; i++) {
      const val = displayOthers[i];
      const vout = tx.vout.find((v) => v.value === val);
      outputNodes.push({
        id: `other-${i}`,
        label: vout?.scriptpubkey_address ? truncateId(vout.scriptpubkey_address, 5) : formatSats(val, i18n.language),
        fullAddress: vout?.scriptpubkey_address,
        value: Math.max(val, 1),
        side: "output",
      });
    }

    // Fee
    if (tx.fee > 0) {
      outputNodes.push({
        id: "fee",
        label: t("viz.flow.fee", { defaultValue: "Fee" }),
        value: tx.fee,
        side: "output",
      });
    }

    nodes.push(...outputNodes);

    // Links: all inputs -> mixer (use string IDs)
    for (let i = 0; i < displayInputs.length; i++) {
      links.push({
        source: `in-${i}`,
        target: "mixer",
        value: Math.max(1, displayInputs[i].prevout?.value ?? 1),
      });
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
    return { graph: g, hiddenInputCount: hiddenIn, hiddenOutputCount: hiddenOut };
  }, [tx, showAllInputs, showAllOutputs, denomGroups, t, i18n]);

  const marginH = width < 500 ? 60 : 120;
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
        {/* Hatched pattern for mixing zone */}
        <defs>
          <pattern id="mixer-pattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={SVG_COLORS.bitcoin} strokeWidth="1" strokeOpacity="0.12" />
          </pattern>
        </defs>

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
                const isMixerLink = sourceNode.id === "mixer" || (link.target as unknown as NodeDatum & { id: string }).id === "mixer";

                return (
                  <motion.path
                    key={`link-${i}`}
                    d={pathD}
                    fill="none"
                    stroke={isMixerLink ? SVG_COLORS.bitcoin : SVG_COLORS.muted}
                    strokeWidth={Math.max(1, (link as unknown as { width: number }).width ?? 1)}
                    strokeOpacity={0.15}
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

                let fillColor: string = SVG_COLORS.bitcoin;
                if (isMixer) fillColor = "url(#mixer-pattern)";
                if (n.id === "fee") fillColor = SVG_COLORS.muted;

                const labelX = isInput ? n.x0 - 6 : n.x1 + 6;
                const labelAnchor = isInput ? "end" : "start";
                const labelMaxWidth = isInput ? n.x0 - 4 : innerWidth - n.x1 - 4;

                return (
                  <Group key={n.id}>
                    <motion.rect
                      x={n.x0}
                      y={n.y0}
                      width={isMixer ? nodeWidth : nodeWidth}
                      height={nodeHeight}
                      fill={fillColor}
                      rx={isMixer ? 0 : 3}
                      stroke={isMixer ? SVG_COLORS.bitcoin : undefined}
                      strokeOpacity={isMixer ? 0.3 : undefined}
                      strokeWidth={isMixer ? 1 : undefined}
                      initial={reducedMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{
                        delay: i * ANIMATION_DEFAULTS.stagger,
                        duration: ANIMATION_DEFAULTS.duration,
                      }}
                      cursor={isClickable ? "pointer" : "default"}
                      onClick={() => {
                        if (n.fullAddress && onAddressClick) onAddressClick(n.fullAddress);
                      }}
                      onMouseEnter={(e: React.MouseEvent) => {
                        const container = containerRef.current;
                        if (!container) return;
                        const containerRect = container.getBoundingClientRect();
                        const elemRect = (e.currentTarget as Element).getBoundingClientRect();
                        showTooltip({
                          tooltipData: {
                            label: n.fullAddress ?? n.label,
                            value: n.value,
                            tierCount: n.tierCount,
                            lang: i18n.language,
                          },
                          tooltipLeft: elemRect.left - containerRect.left + elemRect.width / 2,
                          tooltipTop: elemRect.top - containerRect.top,
                        });
                      }}
                      onMouseLeave={() => hideTooltip()}
                    />

                    {/* Mixer label */}
                    {isMixer && (
                      <Text
                        x={n.x0 + nodeWidth / 2}
                        y={n.y0 + nodeHeight / 2}
                        textAnchor="middle"
                        verticalAnchor="middle"
                        fontSize={13}
                        fill={SVG_COLORS.bitcoin}
                        angle={-90}
                      >
                        {t("viz.coinjoin.mixingZone", { defaultValue: "Mixing" })}
                      </Text>
                    )}

                    {/* Label - clickable for addresses */}
                    {!isMixer && labelMaxWidth > 30 && (
                      <Text
                        x={labelX}
                        y={n.y0 + nodeHeight / 2}
                        textAnchor={labelAnchor}
                        verticalAnchor="middle"
                        fontSize={11}
                        fontFamily="var(--font-geist-mono), monospace"
                        fill={isClickable ? SVG_COLORS.bitcoin : n.tierCount ? SVG_COLORS.bitcoin : SVG_COLORS.foreground}
                        style={{ cursor: isClickable ? "pointer" : "default", textDecoration: isClickable ? "underline" : "none" }}
                        width={Math.min(labelMaxWidth, 140)}
                        onClick={() => { if (n.fullAddress && onAddressClick) onAddressClick(n.fullAddress); }}
                      >
                        {n.label}
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
            </p>
            {tooltipData.tierCount && (
              <p className="text-xs" style={{ color: SVG_COLORS.bitcoin }}>
                {t("viz.coinjoin.tier", { count: tooltipData.tierCount, defaultValue: `${tooltipData.tierCount} equal outputs` })}
              </p>
            )}
          </div>
        </ChartTooltip>
      )}

      {/* Expand buttons */}
      <div className="flex justify-between px-2 mt-1">
        {hiddenInputCount > 0 && (
          <button
            onClick={() => setShowAllInputs(true)}
            className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            {t("tx.moreItems", { count: hiddenInputCount, defaultValue: `+${hiddenInputCount} more` })}
          </button>
        )}
        <div className="flex-1" />
        {hiddenOutputCount > 0 && (
          <button
            onClick={() => setShowAllOutputs(true)}
            className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            {t("tx.moreItems", { count: hiddenOutputCount, defaultValue: `+${hiddenOutputCount} more` })}
          </button>
        )}
      </div>
    </div>
  );
}
