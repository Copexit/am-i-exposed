"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Sankey } from "@visx/sankey";
import { Group } from "@visx/group";
import { Text } from "@visx/text";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, SEVERITY_HEX, GRADIENT_COLORS, DUST_THRESHOLD, ANIMATION_DEFAULTS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { formatSats, formatUsdValue } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import type { SankeyExtraProperties, SankeyGraph } from "d3-sankey";

interface TxFlowDiagramProps {
  tx: MempoolTransaction;
  findings?: Finding[];
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
  side: "input" | "output" | "fee";
  annotation?: string;
  annotationColor?: string;
  annotationReason?: string;
  annotationFindingId?: string;
  anonSet?: number;
  anonColor?: string;
  /** Whether this output has been spent (null = unknown). */
  spent?: boolean | null;
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
  annotationReason?: string;
  lang: string;
  spent?: boolean | null;
}

// Margins are computed per-render based on width (see FlowChart)
const MAX_DISPLAY = 50;
const NODE_WIDTH = 10;
const NODE_PADDING = 14;

const ANON_COLORS = [
  SVG_COLORS.good,
  SVG_COLORS.bitcoin,
  GRADIENT_COLORS.inputLight,
  SVG_COLORS.medium,
  SVG_COLORS.high,
];

/** Get the flat hex color for a node (used for link gradient endpoints). */
function getNodeHex(n: NodeDatum): string {
  if (n.side === "input") return GRADIENT_COLORS.inputLight;
  if (n.side === "fee") return GRADIENT_COLORS.feeLight;
  if (n.annotationColor === SEVERITY_HEX.critical) return SVG_COLORS.critical; // dust
  if (n.annotation) return SVG_COLORS.high; // change
  if (n.anonColor) return n.anonColor;
  return SVG_COLORS.bitcoin; // default output
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

interface FlowChartProps extends TxFlowDiagramProps {
  width: number;
  height: number;
  showAllInputs: boolean;
  showAllOutputs: boolean;
  onToggleShowAllInputs: () => void;
  onToggleShowAllOutputs: () => void;
}

function FlowChart({
  width,
  height,
  tx,
  findings,
  onAddressClick,
  usdPrice,
  outspends,
  showAllInputs,
  showAllOutputs,
  onToggleShowAllInputs,
  onToggleShowAllOutputs,
}: FlowChartProps) {
  const { t, i18n } = useTranslation();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const { tooltipOpen, tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip, handleTouch } =
    useChartTooltip<TooltipData>();

  // Change detection: findings-driven, self-address fallback
  // Maps vout index -> { findingId, reason } for annotation rendering
  const changeOutputMap = useMemo(() => {
    const map = new Map<number, { findingId: string; reason: string }>();

    if (findings) {
      for (const f of findings) {
        // H2 heuristic-detected change (address type mismatch, round amounts)
        if (f.id === "h2-change-detected" && f.params?.["changeIndex"] != null) {
          // Use signalKeys param for locale-aware reason text
          const signalKeyMap: Record<string, string> = {
            address_type: t("viz.flow.changeAddressType", { defaultValue: "address type match" }),
            round_amount: t("viz.flow.changeRoundAmount", { defaultValue: "round amount" }),
            value_disparity: t("viz.flow.changeValueDisparity", { defaultValue: "value disparity" }),
            unnecessary_input: t("viz.flow.changeUnnecessaryInput", { defaultValue: "unnecessary inputs" }),
          };
          const keys = String(f.params["signalKeys"] ?? "").split(",").filter(Boolean);
          const reason = keys.map((k) => signalKeyMap[k] ?? k).join(", ")
            || t("viz.flow.changeAddressType", { defaultValue: "address type match" });
          map.set(Number(f.params["changeIndex"]), { findingId: f.id, reason });
        }
        // Self-send detection: outputs going back to input addresses
        if (f.id === "h2-self-send" && f.params?.["selfSendIndices"]) {
          const reason = t("viz.flow.changeSelfSend", { defaultValue: "sent to input address" });
          for (const idx of String(f.params["selfSendIndices"]).split(",")) {
            map.set(Number(idx), { findingId: f.id, reason });
          }
        }
      }
    }

    // Fallback: self-address matching (for when no H2 findings exist)
    if (map.size === 0) {
      const inputAddrs = new Set(
        tx.vin.map((v) => v.prevout?.scriptpubkey_address).filter(Boolean) as string[],
      );
      for (let i = 0; i < tx.vout.length; i++) {
        const a = tx.vout[i].scriptpubkey_address;
        if (a && inputAddrs.has(a)) {
          map.set(i, {
            findingId: "h2-self-send",
            reason: t("viz.flow.changeSelfSend", { defaultValue: "sent to input address" }),
          });
        }
      }
    }

    return map;
  }, [tx, findings, t]);

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
      let annotationReason: string | undefined;
      let annotationFindingId: string | undefined;

      const changeInfo = changeOutputMap.get(i);
      if (changeInfo) {
        annotation = t("viz.flow.change", { defaultValue: "change" });
        annotationColor = SEVERITY_HEX.high;
        annotationReason = changeInfo.reason;
        annotationFindingId = changeInfo.findingId;
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
        annotationReason,
        annotationFindingId,
        anonSet: anonCount >= 2 ? anonCount : undefined,
        anonColor,
        spent: outspends?.[i]?.spent ?? null,
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
  }, [tx, showAllInputs, showAllOutputs, changeOutputMap, dustOutputIndices, anonSets, outspends, t]);

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
        annotationReason: n.annotationReason,
        lang: i18n.language,
        spent: n.spent,
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
                  const srcColor = srcNode ? getNodeHex(srcNode) : SVG_COLORS.bitcoin;
                  const tgtColor = tgtNode ? getNodeHex(tgtNode) : SVG_COLORS.bitcoin;
                  return (
                    <linearGradient key={`flow-link-${i}`} id={`flow-link-${i}`}>
                      <stop offset="0%" stopColor={srcColor} />
                      <stop offset="100%" stopColor={tgtColor} />
                    </linearGradient>
                  );
                })}
              </defs>

              {/* Links - filter out ghost bands (near-zero width links) */}
              {(computed.links ?? []).map((link, i) => {
                const rawLinkWidth = (link as unknown as { width: number }).width ?? 0;
                // Give OP_RETURN and other tiny outputs a minimum visible band
                const targetNode = nodeMap.get((link.target as unknown as { id: string }).id);
                const isOpReturn = targetNode?.label === "OP_RETURN";
                const linkWidth = isOpReturn ? Math.max(rawLinkWidth, 2) : rawLinkWidth;
                // Skip links with negligible width to prevent ghost bands
                if (linkWidth < 0.5) return null;

                const sourceNodeId = (link.source as unknown as { id: string }).id;
                const targetNodeId = (link.target as unknown as { id: string }).id;
                const isHighlighted =
                  !hoveredNode || sourceNodeId === hoveredNode || targetNodeId === hoveredNode;
                const pathD = createPath(link) ?? "";

                return (
                  <motion.path
                    key={`link-${i}`}
                    d={pathD}
                    fill="none"
                    stroke={`url(#flow-link-${i})`}
                    strokeWidth={Math.max(1, linkWidth)}
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

                // Expand hitbox: extend into the label area for easier hover/touch
                const hitboxPad = 80;
                const hitboxX = isInput ? n.x0 - hitboxPad : n.x0;
                const hitboxW = nw + hitboxPad;
                const hitboxH = Math.max(nh, 20);
                const hitboxY = n.y0 - (hitboxH - nh) / 2;

                return (
                  <Group key={n.id}>
                    {/* Invisible expanded hitbox for hover/touch */}
                    <rect
                      x={hitboxX}
                      y={hitboxY}
                      width={hitboxW}
                      height={hitboxH}
                      fill="transparent"
                      cursor={isClickable ? "pointer" : "default"}
                      tabIndex={isClickable ? 0 : undefined}
                      role={isClickable ? "button" : undefined}
                      aria-label={isClickable ? t("viz.flow.scanAddress", { address: n.fullAddress, defaultValue: `Scan ${n.fullAddress}` }) : undefined}
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
                      style={{ pointerEvents: "none" }}
                    />

                    {/* Address label */}
                    <Text
                      x={labelX}
                      y={n.y0 + nh / 2 - (nh > 10 ? 6 : 0)}
                      textAnchor={labelAnchor}
                      verticalAnchor="middle"
                      fontSize={11}
                      fontFamily="var(--font-geist-mono), monospace"
                      fill={isClickable ? SVG_COLORS.bitcoin : SVG_COLORS.foreground}
                      style={{ pointerEvents: "none" as const, textDecoration: isClickable ? "underline" : "none" }}
                    >
                      {n.label}
                    </Text>

                    {/* Value label - always shown inline */}
                    <Text
                      x={labelX}
                      y={n.y0 + nh / 2 + (nh > 10 ? 8 : 12)}
                      textAnchor={labelAnchor}
                      verticalAnchor="middle"
                      fontSize={nh > 10 ? 10 : 9}
                      fill={SVG_COLORS.muted}
                      style={{ pointerEvents: "none" as const }}
                    >
                      {usdPrice != null ? `${formatSats(n.value, i18n.language)} (${formatUsdValue(n.value, usdPrice)})` : formatSats(n.value, i18n.language)}
                    </Text>

                    {/* Annotation badge (change, dust) - clickable to scroll to finding */}
                    {n.annotation && !isInput && (
                      <Text
                        x={labelX}
                        y={n.y0 + nh / 2 + (nh > 10 ? 20 : 10)}
                        textAnchor={labelAnchor}
                        verticalAnchor="middle"
                        fontSize={9}
                        fontWeight="bold"
                        fill={n.annotationColor ?? SVG_COLORS.high}
                        style={{ cursor: n.annotationFindingId ? "pointer" : "default" }}
                        onClick={() => {
                          if (n.annotationFindingId) {
                            const el = document.querySelector(`[data-finding-id="${n.annotationFindingId}"]`);
                            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                          }
                        }}
                      >
                        {n.annotation}
                      </Text>
                    )}

                    {/* Anon set badge */}
                    {!isInput && n.anonSet && n.anonSet >= 2 && !n.annotation && (
                      <Text
                        x={labelX}
                        y={n.y0 + nh / 2 + (nh > 10 ? 20 : 10)}
                        textAnchor={labelAnchor}
                        verticalAnchor="middle"
                        fontSize={10}
                        fill={n.anonColor ?? SVG_COLORS.muted}
                        fontFamily="var(--font-geist-mono), monospace"
                      >
                        {`[${n.anonSet}x]`}
                      </Text>
                    )}

                    {/* Spent/unspent indicator dot */}
                    {!isInput && n.side === "output" && n.spent != null && (
                      <circle
                        cx={n.x1 + 3}
                        cy={n.y0 + nh / 2}
                        r={3}
                        fill={n.spent ? SVG_COLORS.critical : SVG_COLORS.good}
                        fillOpacity={0.8}
                        style={{ pointerEvents: "none" }}
                      />
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
        <ChartTooltip top={tooltipTop ?? 0} left={tooltipLeft ?? 0}>
          <div className="space-y-0.5">
            <p className="font-mono text-xs" style={{ color: SVG_COLORS.foreground }}>
              {tooltipData.label}
            </p>
            <p className="text-xs" style={{ color: SVG_COLORS.muted }}>
              {formatSats(tooltipData.value, tooltipData.lang)}
              {usdPrice != null && ` (${formatUsdValue(tooltipData.value, usdPrice)})`}
            </p>
            {tooltipData.annotation && (
              <p className="text-xs font-bold" style={{ color: SVG_COLORS.high }}>
                {tooltipData.annotation}
                {tooltipData.annotationReason && (
                  <span className="font-normal" style={{ color: SVG_COLORS.muted }}>
                    {" - "}{tooltipData.annotationReason}
                  </span>
                )}
              </p>
            )}
            {tooltipData.spent != null && tooltipData.side === "output" && (
              <p className="text-xs" style={{ color: tooltipData.spent ? SVG_COLORS.critical : SVG_COLORS.good }}>
                {tooltipData.spent
                  ? t("viz.flow.spent", { defaultValue: "Spent" })
                  : t("viz.flow.unspent", { defaultValue: "Unspent (UTXO)" })}
              </p>
            )}
          </div>
        </ChartTooltip>
      )}

      {/* Expand buttons */}
      {(hiddenInputCount > 0 || hiddenOutputCount > 0) && (
        <div className="flex justify-between px-2 mt-1">
          {hiddenInputCount > 0 ? (
            <button onClick={onToggleShowAllInputs} className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer">
              {t("tx.moreItems", { count: hiddenInputCount, defaultValue: `+${hiddenInputCount} more` })}
            </button>
          ) : <div />}
          {hiddenOutputCount > 0 ? (
            <button onClick={onToggleShowAllOutputs} className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer">
              {t("tx.moreItems", { count: hiddenOutputCount, defaultValue: `+${hiddenOutputCount} more` })}
            </button>
          ) : <div />}
        </div>
      )}
    </div>
  );
}

export function TxFlowDiagram({ tx, findings, onAddressClick, usdPrice, outspends }: TxFlowDiagramProps) {
  const { t, i18n } = useTranslation();
  const [showAllInputs, setShowAllInputs] = useState(false);
  const [showAllOutputs, setShowAllOutputs] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const isLargeTx = tx.vin.length + tx.vout.length > 10;

  const displayInCount = showAllInputs ? tx.vin.length : Math.min(tx.vin.length, MAX_DISPLAY);
  const displayOutCount = showAllOutputs ? tx.vout.length : Math.min(tx.vout.length, MAX_DISPLAY);
  const maxSide = Math.max(displayInCount, displayOutCount + (tx.fee > 0 ? 1 : 0));
  const chartHeight = Math.max(160, Math.min(450, maxSide * 40 + 40));

  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setIsExpanded(false);
  }, []);

  useEffect(() => {
    if (isExpanded) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "";
      };
    }
  }, [isExpanded, handleKeyDown]);

  return (
    <>
      <div className="w-full glass rounded-xl p-4 sm:p-6 space-y-3">
        <div className="flex items-center justify-between text-sm text-muted uppercase tracking-wider">
          <span>{t("tx.inputCount", { count: tx.vin.length, defaultValue: `${tx.vin.length} inputs` })}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs">{t("viz.flow.title", { defaultValue: "Transaction flow" })}</span>
            {isLargeTx && (
              <button
                onClick={() => { setShowAllInputs(true); setShowAllOutputs(true); setIsExpanded(true); }}
                className="text-muted hover:text-foreground transition-colors p-0.5 rounded"
                title={t("viz.flow.expand", { defaultValue: "Expand to full view" })}
                aria-label={t("viz.flow.expand", { defaultValue: "Expand to full view" })}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
              </button>
            )}
          </div>
          <span>{t("tx.outputCount", { count: tx.vout.length, defaultValue: `${tx.vout.length} outputs` })}</span>
        </div>

        <div style={{ minHeight: 160 }}>
          <ParentSize>
            {({ width }) => {
              if (width < 1) return null;
              return (
                <FlowChart
                  width={width}
                  height={chartHeight}
                  tx={tx}
                  findings={findings}
                  onAddressClick={onAddressClick}
                  usdPrice={usdPrice}
                  outspends={outspends}
                  showAllInputs={showAllInputs}
                  showAllOutputs={showAllOutputs}
                  onToggleShowAllInputs={() => setShowAllInputs(true)}
                  onToggleShowAllOutputs={() => setShowAllOutputs(true)}
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
              rate: feeRate(tx),
              defaultValue: `Fee: ${formatSats(tx.fee, i18n.language)} (${feeRate(tx)} sat/vB)`,
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
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col"
          onClick={(e) => { if (e.target === e.currentTarget) setIsExpanded(false); }}
        >
          <div className="flex items-center justify-between p-4 text-sm text-muted">
            <span>{t("tx.inputCount", { count: tx.vin.length, defaultValue: `${tx.vin.length} inputs` })}</span>
            <span className="text-xs uppercase tracking-wider">{t("viz.flow.title", { defaultValue: "Transaction flow" })}</span>
            <div className="flex items-center gap-3">
              <span>{t("tx.outputCount", { count: tx.vout.length, defaultValue: `${tx.vout.length} outputs` })}</span>
              <button
                onClick={() => setIsExpanded(false)}
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
                  tx.vout.length + (tx.fee > 0 ? 1 : 0),
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
                    showAllInputs={true}
                    showAllOutputs={true}
                    onToggleShowAllInputs={() => {}}
                    onToggleShowAllOutputs={() => {}}
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

function feeRate(tx: MempoolTransaction): string {
  const vsize = Math.ceil(tx.weight / 4);
  if (vsize === 0) return "0";
  return (tx.fee / vsize).toFixed(1);
}
