"use client";

import { useMemo, useState, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Sankey } from "@visx/sankey";
import { Group } from "@visx/group";
import { Text } from "@visx/text";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, SEVERITY_HEX, DUST_THRESHOLD, ANIMATION_DEFAULTS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import type { SankeyExtraProperties, SankeyGraph } from "d3-sankey";

interface TxFlowDiagramProps {
  tx: MempoolTransaction;
  findings?: Finding[];
  onAddressClick?: (address: string) => void;
}

interface NodeDatum extends SankeyExtraProperties {
  id: string;
  label: string;
  fullAddress?: string;
  value: number;
  side: "input" | "output" | "fee";
  annotation?: string;
  annotationColor?: string;
  anonSet?: number;
  anonColor?: string;
}

interface LinkDatum extends SankeyExtraProperties {
  source: string;
  target: string;
  value: number;
}

interface TooltipData {
  label: string;
  value: number;
  side: string;
  annotation?: string;
  lang: string;
}

// Margins are computed per-render based on width (see FlowChart)
const MAX_DISPLAY = 8;
const NODE_WIDTH = 10;
const NODE_PADDING = 14;

const ANON_COLORS = [
  SVG_COLORS.good,
  SVG_COLORS.bitcoin,
  "#60a5fa",
  SVG_COLORS.medium,
  SVG_COLORS.high,
];

/** Get the flat hex color for a node (used for link gradient endpoints). */
function getNodeHex(n: NodeDatum): string {
  if (n.side === "input") return "#60a5fa";
  if (n.side === "fee") return "#6b7280";
  if (n.annotationColor === SEVERITY_HEX.critical) return "#ef4444"; // dust
  if (n.annotation) return "#f97316"; // change
  if (n.anonColor) return n.anonColor;
  return "#f7931a"; // default output
}

/** Get gradient fill + optional glow filter for a node. */
function getNodeStyle(n: NodeDatum, isHovered: boolean): { fill: string; filter?: string } {
  if (n.side === "input") return { fill: "url(#grad-input)" };
  if (n.side === "fee") return { fill: "url(#grad-fee)" };
  if (n.annotationColor === SEVERITY_HEX.critical) {
    return { fill: "url(#grad-dust)", filter: "url(#glow-medium)" };
  }
  if (n.annotation) {
    return { fill: "url(#grad-change)", filter: "url(#glow-subtle)" };
  }
  if (n.anonColor) {
    return { fill: n.anonColor, filter: isHovered ? "url(#glow-medium)" : "url(#glow-subtle)" };
  }
  return { fill: "url(#grad-output)", filter: isHovered ? "url(#glow-medium)" : undefined };
}

function FlowChart({
  width,
  height,
  tx,
  findings,
  onAddressClick,
}: TxFlowDiagramProps & { width: number; height: number }) {
  const { t, i18n } = useTranslation();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [showAllInputs, setShowAllInputs] = useState(false);
  const [showAllOutputs, setShowAllOutputs] = useState(false);
  const { tooltipOpen, tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip, handleTouch } =
    useChartTooltip<TooltipData>();

  // Change detection: findings-driven, self-address fallback
  const changeOutputIndices = useMemo(() => {
    const indices = new Set<number>();

    if (findings) {
      for (const f of findings) {
        // H2 heuristic-detected change (address type mismatch, round amounts)
        if (f.id === "h2-change-detected" && f.params?.["changeIndex"] != null) {
          indices.add(Number(f.params["changeIndex"]));
        }
        // Self-send detection: outputs going back to input addresses
        if (f.id === "h2-self-send" && f.params?.["selfSendIndices"]) {
          for (const idx of String(f.params["selfSendIndices"]).split(",")) {
            indices.add(Number(idx));
          }
        }
      }
    }

    // Fallback: self-address matching (for when no H2 findings exist)
    if (indices.size === 0) {
      const inputAddrs = new Set(
        tx.vin.map((v) => v.prevout?.scriptpubkey_address).filter(Boolean) as string[],
      );
      for (let i = 0; i < tx.vout.length; i++) {
        const a = tx.vout[i].scriptpubkey_address;
        if (a && inputAddrs.has(a)) indices.add(i);
      }
    }

    return indices;
  }, [tx, findings]);

  // Anon set computation
  const anonSets = useMemo(() => {
    const valueCounts = new Map<number, number>();
    for (const out of tx.vout) {
      valueCounts.set(out.value, (valueCounts.get(out.value) ?? 0) + 1);
    }
    const groupColors = new Map<number, string>();
    let ci = 0;
    for (const [value, count] of valueCounts) {
      if (count >= 2) {
        groupColors.set(value, ANON_COLORS[ci % ANON_COLORS.length]);
        ci++;
      }
    }
    return { valueCounts, groupColors };
  }, [tx.vout]);

  // Dust detection: findings-driven, threshold fallback
  const dustOutputIndices = useMemo(() => {
    const indices = new Set<number>();

    // Use heuristic findings when available (dust-attack or dust-outputs)
    if (findings) {
      for (const f of findings) {
        if ((f.id === "dust-attack" || f.id === "dust-outputs") && f.params?.["dustIndices"]) {
          for (const idx of String(f.params["dustIndices"]).split(",")) {
            indices.add(Number(idx));
          }
        }
      }
    }

    // Fallback: local threshold check (matches heuristic's 1000 sat threshold)
    if (indices.size === 0) {
      for (let i = 0; i < tx.vout.length; i++) {
        if (tx.vout[i].value > 0 && tx.vout[i].value < DUST_THRESHOLD && tx.vout[i].scriptpubkey_type !== "op_return") {
          indices.add(i);
        }
      }
    }

    return indices;
  }, [tx.vout, findings]);

  const { graph, hiddenInputCount, hiddenOutputCount } = useMemo(() => {
    const displayInputs = showAllInputs ? tx.vin : tx.vin.slice(0, MAX_DISPLAY);
    const displayOutputs = showAllOutputs ? tx.vout : tx.vout.slice(0, MAX_DISPLAY);
    const hiddenIn = tx.vin.length - displayInputs.length;
    const hiddenOut = tx.vout.length - displayOutputs.length;

    const totalOutputValue = displayOutputs.reduce((s, v) => s + v.value, 0);

    const nodes: NodeDatum[] = [];
    const links: LinkDatum[] = [];

    // Input nodes
    for (let i = 0; i < displayInputs.length; i++) {
      const vin = displayInputs[i];
      const addr = vin.prevout?.scriptpubkey_address;
      const val = vin.prevout?.value ?? 0;
      nodes.push({
        id: `in-${i}`,
        label: vin.is_coinbase ? "coinbase" : truncateId(addr ?? "?", 5),
        fullAddress: addr,
        value: Math.max(val, 1),
        side: "input",
      });
    }

    // Output nodes
    for (let i = 0; i < displayOutputs.length; i++) {
      const vout = displayOutputs[i];
      const addr = vout.scriptpubkey_address;
      const val = vout.value;
      const anonCount = anonSets.valueCounts.get(val) ?? 1;
      const anonColor = anonSets.groupColors.get(val);

      let annotation: string | undefined;
      let annotationColor: string | undefined;

      if (changeOutputIndices.has(i)) {
        annotation = t("viz.flow.change", { defaultValue: "change" });
        annotationColor = SEVERITY_HEX.high;
      } else if (dustOutputIndices.has(i)) {
        annotation = t("viz.flow.dust", { defaultValue: "dust" });
        annotationColor = SEVERITY_HEX.critical;
      }

      nodes.push({
        id: `out-${i}`,
        label: vout.scriptpubkey_type === "op_return"
          ? "OP_RETURN"
          : truncateId(addr ?? vout.scriptpubkey_type, 5),
        fullAddress: addr,
        value: Math.max(val, 1),
        side: "output",
        annotation,
        annotationColor,
        anonSet: anonCount >= 2 ? anonCount : undefined,
        anonColor,
      });
    }

    // Fee node
    if (tx.fee > 0) {
      nodes.push({
        id: "fee",
        label: t("viz.flow.fee", { defaultValue: "Fee" }),
        value: tx.fee,
        side: "fee",
      });
    }

    // Links
    const hasFee = tx.fee > 0;
    const totalTarget = totalOutputValue + (hasFee ? tx.fee : 0);

    for (let i = 0; i < displayInputs.length; i++) {
      const inputVal = displayInputs[i].prevout?.value ?? 0;
      if (inputVal === 0) continue;

      for (let j = 0; j < displayOutputs.length; j++) {
        const outVal = displayOutputs[j].value;
        const proportion = totalTarget > 0 ? outVal / totalTarget : 1 / displayOutputs.length;
        const linkVal = Math.max(1, Math.round(inputVal * proportion));
        links.push({ source: `in-${i}`, target: `out-${j}`, value: linkVal });
      }

      if (hasFee) {
        const feeProportion = totalTarget > 0 ? tx.fee / totalTarget : 0;
        const linkVal = Math.max(1, Math.round(inputVal * feeProportion));
        links.push({ source: `in-${i}`, target: "fee", value: linkVal });
      }
    }

    // Coinbase fallback
    if (links.length === 0 && nodes.length > 1) {
      for (let j = 0; j < displayOutputs.length; j++) {
        links.push({ source: "in-0", target: `out-${j}`, value: Math.max(1, displayOutputs[j].value) });
      }
      if (nodes[0]) nodes[0].value = totalOutputValue + tx.fee;
    }

    const g: SankeyGraph<NodeDatum, LinkDatum> = { nodes, links };
    return { graph: g, hiddenInputCount: hiddenIn, hiddenOutputCount: hiddenOut };
  }, [tx, showAllInputs, showAllOutputs, changeOutputIndices, dustOutputIndices, anonSets, t]);

  const marginH = width < 500 ? 80 : 130;
  const MARGIN = { top: 8, right: marginH, bottom: 8, left: marginH };
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  if (innerWidth < 60 || innerHeight < 40) return null;

  const showNodeTooltip = (n: NodeDatum & { x0: number; x1: number; y0: number; y1: number }, e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const elemRect = (e.currentTarget as Element).getBoundingClientRect();
    showTooltip({
      tooltipData: {
        label: n.fullAddress ?? n.label,
        value: n.value,
        side: n.side,
        annotation: n.annotation,
        lang: i18n.language,
      },
      tooltipLeft: elemRect.left - containerRect.left + elemRect.width / 2,
      tooltipTop: elemRect.top - containerRect.top,
    });
  };

  return (
    <div className="relative" ref={containerRef} onTouchStart={handleTouch}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={t("viz.flow.aria", {
          inputs: tx.vin.length,
          outputs: tx.vout.length,
          defaultValue: `Transaction flow diagram: ${tx.vin.length} inputs to ${tx.vout.length} outputs`,
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
          {({ graph: computed, createPath }) => {
            // Build node lookup for link gradient colors
            const nodeMap = new Map<string, NodeDatum>();
            for (const node of (computed.nodes ?? [])) {
              const n = node as unknown as NodeDatum;
              nodeMap.set(n.id, n);
            }

            return (
            <Group top={MARGIN.top} left={MARGIN.left}>
              {/* Dynamic per-link gradients */}
              <defs>
                {(computed.links ?? []).map((link, i) => {
                  const srcNode = nodeMap.get((link.source as unknown as { id: string }).id);
                  const tgtNode = nodeMap.get((link.target as unknown as { id: string }).id);
                  const srcColor = srcNode ? getNodeHex(srcNode) : "#f7931a";
                  const tgtColor = tgtNode ? getNodeHex(tgtNode) : "#f7931a";
                  return (
                    <linearGradient key={`flow-link-${i}`} id={`flow-link-${i}`}>
                      <stop offset="0%" stopColor={srcColor} />
                      <stop offset="100%" stopColor={tgtColor} />
                    </linearGradient>
                  );
                })}
              </defs>

              {/* Links */}
              {(computed.links ?? []).map((link, i) => {
                const sourceNode = link.source as unknown as { id: string };
                const targetNode = link.target as unknown as { id: string };
                const isHighlighted =
                  !hoveredNode || sourceNode.id === hoveredNode || targetNode.id === hoveredNode;
                const pathD = createPath(link) ?? "";

                return (
                  <motion.path
                    key={`link-${i}`}
                    d={pathD}
                    fill="none"
                    stroke={`url(#flow-link-${i})`}
                    strokeWidth={Math.max(1, (link as unknown as { width: number }).width ?? 1)}
                    strokeOpacity={isHighlighted ? 0.5 : 0.08}
                    initial={reducedMotion ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ delay: 0.15 + i * 0.01, duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                  />
                );
              })}

              {/* Nodes */}
              {(computed.nodes ?? []).map((node, i) => {
                const n = node as unknown as NodeDatum & { x0: number; x1: number; y0: number; y1: number };
                const nw = n.x1 - n.x0;
                const nh = Math.max(2, n.y1 - n.y0);
                const isInput = n.side === "input";
                const isClickable = !!n.fullAddress && !!onAddressClick;

                const nodeStyle = getNodeStyle(n, hoveredNode === n.id);

                // Label outside the sankey area
                const labelX = isInput ? n.x0 - 8 : n.x1 + 8;
                const labelAnchor = isInput ? "end" as const : "start" as const;

                return (
                  <Group key={n.id}>
                    <motion.rect
                      x={n.x0}
                      y={n.y0}
                      width={nw}
                      height={nh}
                      fill={nodeStyle.fill}
                      filter={nodeStyle.filter}
                      rx={2}
                      initial={reducedMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * ANIMATION_DEFAULTS.stagger, duration: ANIMATION_DEFAULTS.duration }}
                      cursor={isClickable ? "pointer" : "default"}
                      tabIndex={isClickable ? 0 : undefined}
                      role={isClickable ? "button" : undefined}
                      aria-label={isClickable ? `Scan ${n.fullAddress}` : undefined}
                      className={isClickable ? "outline-none focus-visible:outline-2 focus-visible:outline-bitcoin" : ""}
                      onMouseEnter={(e: React.MouseEvent) => {
                        setHoveredNode(n.id);
                        showNodeTooltip(n, e);
                      }}
                      onMouseLeave={() => { setHoveredNode(null); hideTooltip(); }}
                      onClick={() => { if (n.fullAddress && onAddressClick) onAddressClick(n.fullAddress); }}
                      onKeyDown={(e: React.KeyboardEvent) => {
                        if ((e.key === "Enter" || e.key === " ") && n.fullAddress && onAddressClick) {
                          e.preventDefault();
                          onAddressClick(n.fullAddress);
                        }
                      }}
                    />

                    {/* Address label - clickable when address exists */}
                    <Text
                      x={labelX}
                      y={n.y0 + nh / 2 - (nh > 20 ? 6 : 0)}
                      textAnchor={labelAnchor}
                      verticalAnchor="middle"
                      fontSize={11}
                      fontFamily="var(--font-geist-mono), monospace"
                      fill={isClickable ? SVG_COLORS.bitcoin : SVG_COLORS.foreground}
                      style={{ cursor: isClickable ? "pointer" : "default", textDecoration: isClickable ? "underline" : "none" }}
                      onClick={() => { if (n.fullAddress && onAddressClick) onAddressClick(n.fullAddress); }}
                    >
                      {n.label}
                    </Text>

                    {/* Value label */}
                    {nh > 20 && (
                      <Text
                        x={labelX}
                        y={n.y0 + nh / 2 + 8}
                        textAnchor={labelAnchor}
                        verticalAnchor="middle"
                        fontSize={10}
                        fill={SVG_COLORS.muted}
                        style={{ cursor: isClickable ? "pointer" : "default" }}
                        onClick={() => { if (n.fullAddress && onAddressClick) onAddressClick(n.fullAddress); }}
                      >
                        {formatSats(n.value, i18n.language)}
                      </Text>
                    )}

                    {/* Annotation badge (change, dust) */}
                    {n.annotation && !isInput && (
                      <Text
                        x={labelX}
                        y={n.y0 + nh / 2 + (nh > 20 ? 20 : 10)}
                        textAnchor={labelAnchor}
                        verticalAnchor="middle"
                        fontSize={9}
                        fontWeight="bold"
                        fill={n.annotationColor ?? SVG_COLORS.high}
                      >
                        {n.annotation}
                      </Text>
                    )}

                    {/* Anon set badge */}
                    {!isInput && n.anonSet && n.anonSet >= 2 && !n.annotation && (
                      <Text
                        x={labelX}
                        y={n.y0 + nh / 2 + (nh > 20 ? 20 : 10)}
                        textAnchor={labelAnchor}
                        verticalAnchor="middle"
                        fontSize={10}
                        fill={n.anonColor ?? SVG_COLORS.muted}
                        fontFamily="var(--font-geist-mono), monospace"
                      >
                        {`[${n.anonSet}x]`}
                      </Text>
                    )}
                  </Group>
                );
              })}
            </Group>
            );
          }}
        </Sankey>
      </svg>

      {tooltipOpen && tooltipData && (
        <ChartTooltip top={tooltipTop} left={tooltipLeft}>
          <div className="space-y-0.5">
            <p className="font-mono text-xs" style={{ color: SVG_COLORS.foreground }}>
              {tooltipData.label}
            </p>
            <p className="text-xs" style={{ color: SVG_COLORS.muted }}>
              {formatSats(tooltipData.value, tooltipData.lang)}
            </p>
            {tooltipData.annotation && (
              <p className="text-xs font-bold" style={{ color: SVG_COLORS.high }}>
                {tooltipData.annotation}
              </p>
            )}
          </div>
        </ChartTooltip>
      )}

      {/* Expand buttons */}
      {(hiddenInputCount > 0 || hiddenOutputCount > 0) && (
        <div className="flex justify-between px-2 mt-1">
          {hiddenInputCount > 0 ? (
            <button onClick={() => setShowAllInputs(true)} className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer">
              {t("tx.moreItems", { count: hiddenInputCount, defaultValue: `+${hiddenInputCount} more` })}
            </button>
          ) : <div />}
          {hiddenOutputCount > 0 ? (
            <button onClick={() => setShowAllOutputs(true)} className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer">
              {t("tx.moreItems", { count: hiddenOutputCount, defaultValue: `+${hiddenOutputCount} more` })}
            </button>
          ) : <div />}
        </div>
      )}
    </div>
  );
}

export function TxFlowDiagram({ tx, findings, onAddressClick }: TxFlowDiagramProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="w-full glass rounded-xl p-4 sm:p-6 space-y-3">
      <div className="flex items-center justify-between text-sm text-muted uppercase tracking-wider">
        <span>{t("tx.inputCount", { count: tx.vin.length, defaultValue: `${tx.vin.length} inputs` })}</span>
        <span className="text-xs">{t("viz.flow.title", { defaultValue: "Transaction flow" })}</span>
        <span>{t("tx.outputCount", { count: tx.vout.length, defaultValue: `${tx.vout.length} outputs` })}</span>
      </div>

      <div style={{ minHeight: 160 }}>
        <ParentSize>
          {({ width }) => {
            const maxSide = Math.max(Math.min(tx.vin.length, MAX_DISPLAY), Math.min(tx.vout.length, MAX_DISPLAY) + (tx.fee > 0 ? 1 : 0));
            const h = Math.max(160, Math.min(450, maxSide * 40 + 40));
            return (
              <FlowChart width={width} height={h} tx={tx} findings={findings} onAddressClick={onAddressClick} />
            );
          }}
        </ParentSize>
      </div>

      {/* Fee + size info */}
      <div className="flex items-center justify-between text-sm text-muted border-t border-card-border pt-2">
        <span>
          {t("tx.fee", {
            amount: formatSats(tx.fee, i18n.language),
            rate: feeRate(tx),
            defaultValue: `Fee: ${formatSats(tx.fee, i18n.language)} (${feeRate(tx)} sat/vB)`,
          })}
        </span>
        <span>{tx.weight.toLocaleString(i18n.language)} WU</span>
      </div>
    </div>
  );
}

function feeRate(tx: MempoolTransaction): string {
  const vsize = Math.ceil(tx.weight / 4);
  if (vsize === 0) return "0";
  return (tx.fee / vsize).toFixed(1);
}
