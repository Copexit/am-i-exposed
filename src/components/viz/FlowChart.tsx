"use client";

import { useMemo, useState, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Sankey } from "@visx/sankey";
import { Group } from "@visx/group";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, SEVERITY_HEX, GRADIENT_COLORS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, anchorTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { probColor } from "./shared/linkabilityColors";
import { formatSats, formatUsdValue } from "@/lib/format";
import { FlowNode } from "./FlowNode";
import { useLinkTooltip, showLinkTooltip, hideLinkTooltip } from "./FlowLinkTooltip";
import {
  buildChangeOutputMap,
  buildDustOutputIndices,
  buildAnonSets,
  buildBoltzmannLookup,
  buildFlowGraph,
} from "./buildFlowGraph";
import type { FlowNodeDatum } from "./buildFlowGraph";
import type { LinkDatum } from "./shared/sankeyTypes";
import type { SankeyComputedNode, SankeyComputedLink } from "./shared/sankeyTypes";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { Finding } from "@/lib/types";

/** @deprecated Use FlowNodeDatum from buildFlowGraph.ts instead. */
export type NodeDatum = FlowNodeDatum;

export interface TxFlowDiagramProps {
  tx: MempoolTransaction;
  findings?: Finding[];
  onAddressClick?: (address: string) => void;
  /** USD per BTC at the time the transaction was confirmed (mainnet only). */
  usdPrice?: number | null;
  /** Per-output spend status. */
  outspends?: MempoolOutspend[] | null;
  /** Boltzmann link probability matrix for linkability mode. */
  boltzmannResult?: BoltzmannWorkerResult | null;
  /** When true, this TxFlowDiagram is shown in place of CoinJoinStructure. */
  isCoinJoinOverride?: boolean;
  /** Callback to return to CoinJoinStructure view. */
  onExitLinkability?: () => void;
}

interface TooltipData {
  label: string;
  value: number;
  side: string;
  annotation?: string;
  annotationReason?: string;
  lang: string;
  spent?: boolean | null;
  /** Linkability probability for link hover tooltip. */
  linkProb?: number;
  linkFromLabel?: string;
  linkToLabel?: string;
}

const NODE_WIDTH = 10;
const NODE_PADDING = 14;

/** Tooltip content for both node hover and link hover. */
function TooltipContent({ d, usdPrice, t }: { d: TooltipData; usdPrice?: number | null; t: (k: string, o?: Record<string, unknown>) => string }) {
  if (d.linkProb !== undefined) {
    return (
      <div className="space-y-0.5">
        <p className="text-xs font-medium flex items-center gap-1.5">
          <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: probColor(d.linkProb), display: "inline-block", flexShrink: 0 }} />
          <span style={{ color: SVG_COLORS.foreground }}>{Math.round(d.linkProb * 100)}% linkability</span>
        </p>
        <p className="text-xs" style={{ color: SVG_COLORS.muted }}>{d.linkFromLabel} {"\u2192"} {d.linkToLabel}</p>
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-xs" style={{ color: SVG_COLORS.foreground }}>{d.label}</p>
      <p className="text-xs" style={{ color: SVG_COLORS.muted }}>
        {formatSats(d.value, d.lang)}
        {usdPrice != null && ` (${formatUsdValue(d.value, usdPrice)})`}
      </p>
      {d.annotation && (
        <p className="text-xs font-bold" style={{ color: SVG_COLORS.high }}>
          {d.annotation}
          {d.annotationReason && <span className="font-normal" style={{ color: SVG_COLORS.muted }}>{" - "}{d.annotationReason}</span>}
        </p>
      )}
      {d.spent != null && d.side === "output" && (
        <p className="text-xs" style={{ color: d.spent ? SVG_COLORS.critical : SVG_COLORS.good }}>
          {d.spent ? t("viz.flow.spent", { defaultValue: "Spent" }) : t("viz.flow.unspent", { defaultValue: "Unspent (UTXO)" })}
        </p>
      )}
    </div>
  );
}

/** Get the flat hex color for a node (used for link gradient endpoints). */
function getNodeHex(n: FlowNodeDatum): string {
  if (n.side === "input") return GRADIENT_COLORS.inputLight;
  if (n.side === "fee") return GRADIENT_COLORS.feeLight;
  if (n.annotationColor === SEVERITY_HEX.critical) return SVG_COLORS.critical; // dust
  if (n.annotation) return SVG_COLORS.high; // change
  if (n.anonColor) return n.anonColor;
  return SVG_COLORS.bitcoin; // default output
}

/** Get gradient fill + optional glow filter for a node. */
export function getNodeStyle(n: FlowNodeDatum, isHovered: boolean): { fill: string; filter?: string } {
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

export interface FlowChartProps extends TxFlowDiagramProps {
  width: number;
  height: number;
  showAllInputs: boolean;
  showAllOutputs: boolean;
  onToggleShowAllInputs: () => void;
  onToggleShowAllOutputs: () => void;
  linkabilityMode: boolean;
}

export function FlowChart({
  width,
  height,
  tx,
  findings,
  onAddressClick,
  usdPrice,
  outspends,
  boltzmannResult,
  showAllInputs,
  showAllOutputs,
  onToggleShowAllInputs,
  onToggleShowAllOutputs,
  linkabilityMode,
}: FlowChartProps) {
  const { t, i18n } = useTranslation();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const { tooltipOpen, tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip, handleTouch } =
    useChartTooltip<TooltipData>();

  const linkTooltipRefs = useLinkTooltip();

  const changeOutputMap = useMemo(() => buildChangeOutputMap(tx, findings, t), [tx, findings, t]);
  const anonSets = useMemo(() => buildAnonSets(tx.vout), [tx.vout]);
  const dustOutputIndices = useMemo(() => buildDustOutputIndices(tx, findings), [tx, findings]);
  const boltzmannLookup = useMemo(() => buildBoltzmannLookup(boltzmannResult, linkabilityMode, tx), [boltzmannResult, linkabilityMode, tx]);
  const { graph, hiddenInputCount, hiddenOutputCount } = useMemo(
    () => buildFlowGraph(tx, { showAllInputs, showAllOutputs, changeOutputMap, dustOutputIndices, anonSets, outspends, t }),
    [tx, showAllInputs, showAllOutputs, changeOutputMap, dustOutputIndices, anonSets, outspends, t],
  );

  const marginH = width < 500 ? 80 : 130;
  const MARGIN = { top: 8, right: marginH, bottom: 8, left: marginH };
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  if (innerWidth < 60 || innerHeight < 40) return null;

  const showNodeTooltip = (n: NodeDatum & { x0: number; x1: number; y0: number; y1: number }, e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    showTooltip({
      tooltipData: {
        label: n.fullAddress ?? n.label,
        value: n.displayValue,
        side: n.side,
        annotation: n.annotation,
        annotationReason: n.annotationReason,
        lang: i18n.language,
        spent: n.spent,
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
          {({ graph: computed }) => {
            // Build node lookup for link gradient colors
            const nodeMap = new Map<string, SankeyComputedNode<NodeDatum>>();
            for (const node of (computed.nodes ?? [])) {
              const n = node as SankeyComputedNode<NodeDatum>;
              nodeMap.set(n.id, n);
            }

            return (
            <Group top={MARGIN.top} left={MARGIN.left}>
              {/* Dynamic per-link gradients */}
              <defs>
                {(computed.links ?? []).map((link, i) => {
                  const cl = link as SankeyComputedLink<NodeDatum, LinkDatum>;
                  const srcNode = nodeMap.get(cl.source.id);
                  const tgtNode = nodeMap.get(cl.target.id);

                  // Linkability mode: solid color from probability matrix
                  if (boltzmannLookup && srcNode && tgtNode && srcNode.side === "input" && tgtNode.side === "output") {
                    const inIdx = parseInt(srcNode.id.slice(3), 10);
                    const outIdx = parseInt(tgtNode.id.slice(4), 10);
                    const prob = boltzmannLookup.getProb(inIdx, outIdx);
                    const isUnreliable = boltzmannLookup.timedOut && prob > 0 && prob < 1.0;
                    const color = isUnreliable ? SVG_COLORS.surfaceInset : probColor(prob);
                    return (
                      <linearGradient key={`flow-link-${i}`} id={`flow-link-${i}`}>
                        <stop offset="0%" stopColor={color} />
                        <stop offset="100%" stopColor={color} />
                      </linearGradient>
                    );
                  }

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

              {/* Links */}
              {(computed.links ?? []).map((link, i) => {
                const cl = link as SankeyComputedLink<NodeDatum, LinkDatum>;
                if ((cl.value ?? 0) <= 0) return null;

                const src = cl.source;
                const tgt = cl.target;
                const w = Math.max(cl.width ?? 0, 2);
                const y0 = isFinite(cl.y0) ? cl.y0 : (src.y0 + src.y1) / 2;
                const y1 = isFinite(cl.y1) ? cl.y1 : (tgt.y0 + tgt.y1) / 2;
                const midX = (src.x1 + tgt.x0) / 2;

                const pathD =
                  `M${src.x1},${y0 - w / 2}` +
                  `C${midX},${y0 - w / 2} ${midX},${y1 - w / 2} ${tgt.x0},${y1 - w / 2}` +
                  `L${tgt.x0},${y1 + w / 2}` +
                  `C${midX},${y1 + w / 2} ${midX},${y0 + w / 2} ${src.x1},${y0 + w / 2}Z`;

                const isHighlighted =
                  !hoveredNode || src.id === hoveredNode || tgt.id === hoveredNode;

                // Linkability mode: opacity scales with probability
                let linkOpacity = isHighlighted ? 0.5 : 0.08;
                let linkProb: number | undefined;
                let linkFromLabel: string | undefined;
                let linkToLabel: string | undefined;

                if (boltzmannLookup) {
                  const srcNode = nodeMap.get(src.id);
                  const tgtNode = nodeMap.get(tgt.id);
                  if (srcNode?.side === "input" && tgtNode?.side === "output") {
                    const inIdx = parseInt(src.id.slice(3), 10);
                    const outIdx = parseInt(tgt.id.slice(4), 10);
                    const prob = boltzmannLookup.getProb(inIdx, outIdx);
                    const isUnreliable = boltzmannLookup.timedOut && prob > 0 && prob < 1.0;
                    if (prob <= 0) {
                      return null; // Remove 0% links entirely
                    } else if (isUnreliable) {
                      linkOpacity = 0.03;
                    } else {
                      linkOpacity = 0.3 + prob * 0.7;
                    }
                    if (!isHighlighted) linkOpacity *= 0.3;
                    linkProb = prob;
                    linkFromLabel = srcNode.label;
                    linkToLabel = tgtNode.label;
                  }
                }

                return (
                  <g
                    key={`link-${i}`}
                    onMouseMove={linkProb !== undefined ? (e: React.MouseEvent) => {
                      showLinkTooltip(linkTooltipRefs, e, pathD, `url(#flow-link-${i})`, linkProb!, linkFromLabel!, linkToLabel!);
                    } : undefined}
                    onMouseLeave={linkProb !== undefined ? () => {
                      hideLinkTooltip(linkTooltipRefs);
                    } : undefined}
                  >
                    <motion.path
                      d={pathD}
                      fill={`url(#flow-link-${i})`}
                      fillOpacity={linkOpacity}
                      stroke="none"
                      pointerEvents={linkProb !== undefined ? "fill" : "none"}
                      initial={reducedMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{
                        delay: 0.15 + i * Math.min(0.01, 1.5 / Math.max(1, (computed.links ?? []).length)),
                        duration: Math.max(0.15, 0.5 - (computed.links ?? []).length * 0.001),
                        ease: [0.4, 0, 0.2, 1],
                      }}
                    />
                  </g>
                );
              })}

              {/* Imperative hover overlay */}
              <g style={{ pointerEvents: "none" }}>
                <path ref={linkTooltipRefs.overlayGlowRef} display="none" fillOpacity={0.6} stroke="none" filter="url(#glow-medium)" />
                <path ref={linkTooltipRefs.overlayPathRef} display="none" fillOpacity={1.0} stroke="none" />
              </g>

              {/* Nodes */}
              {(computed.nodes ?? []).map((node, i) => {
                const n = node as SankeyComputedNode<NodeDatum>;
                const isClickable = !!n.fullAddress && !!onAddressClick;

                return (
                  <FlowNode
                    key={n.id}
                    node={n}
                    index={i}
                    marginH={marginH}
                    reducedMotion={reducedMotion}
                    lang={i18n.language}
                    nodeStyle={getNodeStyle(n, hoveredNode === n.id)}
                    isClickable={isClickable}
                    onHoverEnter={(nd, e) => {
                      setHoveredNode(nd.id);
                      showNodeTooltip(nd, e);
                    }}
                    onHoverLeave={() => { setHoveredNode(null); hideTooltip(); }}
                    onAddressClick={onAddressClick}
                    t={t}
                  />
                );
              })}
            </Group>
            );
          }}
        </Sankey>
      </svg>

      {tooltipOpen && tooltipData && (
        <ChartTooltip top={tooltipTop ?? 0} left={tooltipLeft ?? 0} containerRef={containerRef}>
          <TooltipContent d={tooltipData} usdPrice={usdPrice} t={t} />
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
