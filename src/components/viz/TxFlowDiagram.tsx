"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Sankey } from "@visx/sankey";
import { Group } from "@visx/group";
import { Text } from "@visx/text";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { SVG_COLORS, SEVERITY_HEX, GRADIENT_COLORS, DUST_THRESHOLD, ANIMATION_DEFAULTS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { probColor } from "./shared/linkabilityColors";
import { formatSats, formatUsdValue, calcFeeRate } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { useFullscreen } from "@/hooks/useFullscreen";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { Finding } from "@/lib/types";
import type { SankeyExtraProperties, SankeyGraph } from "d3-sankey";
import type { SankeyComputedNode, SankeyComputedLink } from "./shared/sankeyTypes";

interface TxFlowDiagramProps {
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

interface NodeDatum extends SankeyExtraProperties {
  id: string;
  label: string;
  fullAddress?: string;
  value: number;
  /** Original sats value for display (Sankey may overwrite `value` with link totals). */
  displayValue: number;
  side: "input" | "output" | "fee";
  annotation?: string;
  annotationColor?: string;
  annotationReason?: string;
  annotationFindingId?: string;
  anonSet?: number;
  anonColor?: string;
  /** Whether this output has been spent (null = unknown). */
  spent?: boolean | null;
  /** Known entity name for this address (exchange, darknet, etc.). */
  entityName?: string;
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
  /** Linkability probability for link hover tooltip. */
  linkProb?: number;
  linkFromLabel?: string;
  linkToLabel?: string;
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
  linkabilityMode: boolean;
}

function FlowChart({
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

  // Imperative link hover - avoids React re-renders that destabilize scroll containers
  const overlayGlowRef = useRef<SVGPathElement>(null);
  const overlayPathRef = useRef<SVGPathElement>(null);
  const linkTooltipRef = useRef<HTMLDivElement>(null);
  const ttDotRef = useRef<HTMLSpanElement>(null);
  const ttProbRef = useRef<HTMLSpanElement>(null);
  const ttRouteRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const div = document.createElement("div");
    Object.assign(div.style, {
      position: "fixed", display: "none", pointerEvents: "none", zIndex: "9999",
      backgroundColor: "var(--overlay-bg)", border: "1px solid var(--overlay-border)",
      borderRadius: "8px", padding: "8px 12px", fontSize: "13px",
      color: "var(--foreground)", boxShadow: "var(--overlay-shadow)",
      backdropFilter: "blur(16px)", whiteSpace: "nowrap", transform: "translate(-50%, -100%)",
    });
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:6px";
    const dot = document.createElement("span");
    Object.assign(dot.style, { width: "8px", height: "8px", borderRadius: "50%", display: "inline-block", flexShrink: "0" });
    const prob = document.createElement("span");
    Object.assign(prob.style, { fontSize: "12px", fontWeight: "500", color: "var(--foreground)" });
    const route = document.createElement("p");
    Object.assign(route.style, { fontSize: "12px", marginTop: "2px", color: "var(--muted)" });
    row.appendChild(dot);
    row.appendChild(prob);
    div.appendChild(row);
    div.appendChild(route);
    document.body.appendChild(div);
    linkTooltipRef.current = div;
    ttDotRef.current = dot;
    ttProbRef.current = prob;
    ttRouteRef.current = route;
    return () => { document.body.removeChild(div); };
  }, []);

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

  // Build mapping from display index to Boltzmann matrix index (filtered, no coinbase/OP_RETURN)
  const boltzmannLookup = useMemo(() => {
    if (!boltzmannResult || !linkabilityMode) return null;
    const mat = boltzmannResult.matLnkProbabilities;
    // Boltzmann filtered input indices (non-coinbase with prevout)
    const inputMap: number[] = [];
    let bi = 0;
    for (let i = 0; i < tx.vin.length; i++) {
      if (!tx.vin[i].is_coinbase && tx.vin[i].prevout) {
        inputMap[i] = bi++;
      } else {
        inputMap[i] = -1;
      }
    }
    // Boltzmann filtered output indices (non-OP_RETURN, value > 0)
    const outputMap: number[] = [];
    let bo = 0;
    for (let i = 0; i < tx.vout.length; i++) {
      if (tx.vout[i].scriptpubkey_type !== "op_return" && tx.vout[i].value > 0) {
        outputMap[i] = bo++;
      } else {
        outputMap[i] = -1;
      }
    }
    return {
      getProb: (displayInIdx: number, displayOutIdx: number): number => {
        const mi = inputMap[displayInIdx];
        const mo = outputMap[displayOutIdx];
        if (mi < 0 || mo < 0) return 0;
        return mat[mo]?.[mi] ?? 0;
      },
      timedOut: boltzmannResult.timedOut,
    };
  }, [boltzmannResult, linkabilityMode, tx.vin, tx.vout]);

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
      const entity = addr ? matchEntitySync(addr) : null;
      nodes.push({
        id: `in-${i}`,
        label: vin.is_coinbase ? "coinbase" : truncateId(addr ?? "?", 5),
        fullAddress: addr,
        value: Math.max(val, 1),
        displayValue: val,
        side: "input",
        entityName: entity?.entityName,
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

      const outEntity = addr ? matchEntitySync(addr) : null;
      nodes.push({
        id: `out-${i}`,
        label: vout.scriptpubkey_type === "op_return"
          ? "OP_RETURN"
          : truncateId(addr ?? vout.scriptpubkey_type, 5),
        fullAddress: addr,
        value: Math.max(val, 1),
        displayValue: val,
        side: "output",
        annotation,
        annotationColor,
        annotationReason,
        annotationFindingId,
        anonSet: anonCount >= 2 ? anonCount : undefined,
        anonColor,
        spent: outspends?.[i]?.spent ?? null,
        entityName: outEntity?.entityName,
      });
    }

    // Links - fee is shown separately at the bottom, not as a Sankey node
    // Use square-root scaling when output ratio exceeds 10x to prevent
    // small outputs from becoming invisible slivers
    const outputValues = displayOutputs.map((o) => o.value);
    const maxOut = Math.max(...outputValues, 1);
    const minPositive = Math.min(...outputValues.filter((v) => v > 0), maxOut);
    const useCompression = maxOut / minPositive > 10;

    for (let i = 0; i < displayInputs.length; i++) {
      const inputVal = displayInputs[i].prevout?.value ?? 0;
      if (inputVal === 0) continue;

      const scaledTotal = useCompression
        ? displayOutputs.reduce((s, o) => s + Math.sqrt(o.value), 0)
        : totalOutputValue;

      for (let j = 0; j < displayOutputs.length; j++) {
        const outVal = displayOutputs[j].value;
        const scaledOut = useCompression ? Math.sqrt(outVal) : outVal;
        const proportion = scaledTotal > 0 ? scaledOut / scaledTotal : 1 / displayOutputs.length;
        const linkVal = Math.max(1, Math.round(inputVal * proportion));
        links.push({ source: `in-${i}`, target: `out-${j}`, value: linkVal });
      }
    }

    // Coinbase fallback
    if (links.length === 0 && nodes.length > 1) {
      for (let j = 0; j < displayOutputs.length; j++) {
        links.push({ source: "in-0", target: `out-${j}`, value: Math.max(1, displayOutputs[j].value) });
      }
      if (nodes[0]) {
        nodes[0].value = totalOutputValue + tx.fee;
        nodes[0].displayValue = totalOutputValue + tx.fee;
      }
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
        value: n.displayValue,
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

              {/* Links - rendered as filled band shapes instead of stroked center
                  lines. d3-sankey relaxation can assign width=0 to valid links,
                  producing zero-area paths. Filled bands with a minimum thickness
                  guarantee every link is visible. */}
              {/* Scale animation timing: cap total stagger window at ~1.5s regardless of link count */}
              {(computed.links ?? []).map((link, i) => {
                const cl = link as SankeyComputedLink<NodeDatum, LinkDatum>;
                if ((cl.value ?? 0) <= 0) return null;

                const src = cl.source;
                const tgt = cl.target;
                const w = Math.max(cl.width ?? 0, 2);
                const y0 = isFinite(cl.y0) ? cl.y0 : (src.y0 + src.y1) / 2;
                const y1 = isFinite(cl.y1) ? cl.y1 : (tgt.y0 + tgt.y1) / 2;
                const midX = (src.x1 + tgt.x0) / 2;

                // Filled band: top edge curve -> bottom edge curve -> close
                const pathD =
                  `M${src.x1},${y0 - w / 2}` +
                  `C${midX},${y0 - w / 2} ${midX},${y1 - w / 2} ${tgt.x0},${y1 - w / 2}` +
                  `L${tgt.x0},${y1 + w / 2}` +
                  `C${midX},${y1 + w / 2} ${midX},${y0 + w / 2} ${src.x1},${y0 + w / 2}Z`;

                const isHighlighted =
                  !hoveredNode || src.id === hoveredNode || tgt.id === hoveredNode;

                // Linkability mode: opacity scales with probability
                let linkOpacity = isHighlighted ? 0.5 : 0.08;
                if (boltzmannLookup) {
                  const srcNode = nodeMap.get(src.id);
                  const tgtNode = nodeMap.get(tgt.id);
                  if (srcNode?.side === "input" && tgtNode?.side === "output") {
                    const inIdx = parseInt(src.id.slice(3), 10);
                    const outIdx = parseInt(tgt.id.slice(4), 10);
                    const prob = boltzmannLookup.getProb(inIdx, outIdx);
                    const isUnreliable = boltzmannLookup.timedOut && prob > 0 && prob < 1.0;
                    if (prob <= 0) {
                      return null; // Remove 0% links entirely so they don't interfere with hover
                    } else if (isUnreliable) {
                      linkOpacity = 0.03;
                    } else {
                      // Proportional: 0% prob -> 30% opacity, 100% prob -> 100% opacity
                      linkOpacity = 0.3 + prob * 0.7;
                    }
                    if (!isHighlighted) linkOpacity *= 0.3;
                  }
                }

                // Compute linkability prob for hover tooltip
                let linkProb: number | undefined;
                let linkFromLabel: string | undefined;
                let linkToLabel: string | undefined;
                if (boltzmannLookup) {
                  const srcNode2 = nodeMap.get(src.id);
                  const tgtNode2 = nodeMap.get(tgt.id);
                  if (srcNode2?.side === "input" && tgtNode2?.side === "output") {
                    const inIdx = parseInt(src.id.slice(3), 10);
                    const outIdx = parseInt(tgt.id.slice(4), 10);
                    linkProb = boltzmannLookup.getProb(inIdx, outIdx);
                    linkFromLabel = srcNode2.label;
                    linkToLabel = tgtNode2.label;
                  }
                }

                return (
                  <g
                    key={`link-${i}`}
                    onMouseMove={linkProb !== undefined ? (e: React.MouseEvent) => {
                      // Imperative hover: update overlay + tooltip directly, no React state changes
                      if (overlayGlowRef.current) {
                        overlayGlowRef.current.setAttribute("d", pathD);
                        overlayGlowRef.current.setAttribute("fill", `url(#flow-link-${i})`);
                        overlayGlowRef.current.removeAttribute("display");
                      }
                      if (overlayPathRef.current) {
                        overlayPathRef.current.setAttribute("d", pathD);
                        overlayPathRef.current.setAttribute("fill", `url(#flow-link-${i})`);
                        overlayPathRef.current.removeAttribute("display");
                      }
                      if (linkTooltipRef.current) {
                        linkTooltipRef.current.style.display = "block";
                        linkTooltipRef.current.style.left = `${e.clientX}px`;
                        linkTooltipRef.current.style.top = `${e.clientY - 16}px`;
                      }
                      if (ttDotRef.current) ttDotRef.current.style.backgroundColor = probColor(linkProb!);
                      if (ttProbRef.current) ttProbRef.current.textContent = `${Math.round(linkProb! * 100)}% linkability`;
                      if (ttRouteRef.current) ttRouteRef.current.textContent = `${linkFromLabel} \u2192 ${linkToLabel}`;
                    } : undefined}
                    onMouseLeave={linkProb !== undefined ? () => {
                      if (overlayGlowRef.current) overlayGlowRef.current.setAttribute("display", "none");
                      if (overlayPathRef.current) overlayPathRef.current.setAttribute("display", "none");
                      if (linkTooltipRef.current) linkTooltipRef.current.style.display = "none";
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

              {/* Imperative hover overlay: paths updated via refs, no React state changes */}
              <g style={{ pointerEvents: "none" }}>
                <path ref={overlayGlowRef} display="none" fillOpacity={0.6} stroke="none" filter="url(#glow-medium)" />
                <path ref={overlayPathRef} display="none" fillOpacity={1.0} stroke="none" />
              </g>

              {/* Nodes */}
              {(computed.nodes ?? []).map((node, i) => {
                const n = node as SankeyComputedNode<NodeDatum>;
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

                    {/* Entity label - shown in place of value when entity is known */}
                    {n.entityName ? (
                      <Text
                        x={labelX}
                        y={n.y0 + nh / 2 + (nh > 10 ? 8 : 12)}
                        textAnchor={labelAnchor}
                        verticalAnchor="middle"
                        fontSize={nh > 10 ? 10 : 9}
                        fontWeight={700}
                        fill={SVG_COLORS.critical}
                        style={{ pointerEvents: "none" as const }}
                        width={Math.min(marginH - 10, 140)}
                      >
                        {n.entityName}
                      </Text>
                    ) : (
                      <Text
                        x={labelX}
                        y={n.y0 + nh / 2 + (nh > 10 ? 8 : 12)}
                        textAnchor={labelAnchor}
                        verticalAnchor="middle"
                        fontSize={nh > 10 ? 10 : 9}
                        fill={SVG_COLORS.muted}
                        style={{ pointerEvents: "none" as const }}
                      >
                        {formatSats(n.displayValue, i18n.language)}
                      </Text>
                    )}

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
        <ChartTooltip top={tooltipTop ?? 0} left={tooltipLeft ?? 0} containerRef={containerRef}>
          <div className="space-y-0.5">
            {tooltipData.linkProb !== undefined ? (
              <>
                <p className="text-xs font-medium flex items-center gap-1.5">
                  <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: probColor(tooltipData.linkProb), display: "inline-block", flexShrink: 0 }} />
                  <span style={{ color: SVG_COLORS.foreground }}>{Math.round(tooltipData.linkProb * 100)}% linkability</span>
                </p>
                <p className="text-xs" style={{ color: SVG_COLORS.muted }}>
                  {tooltipData.linkFromLabel} {"\u2192"} {tooltipData.linkToLabel}
                </p>
              </>
            ) : (
              <>
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
              </>
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

