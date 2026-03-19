"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { Text } from "@visx/text";
import { SVG_COLORS } from "../shared/svgConstants";
import { probColor } from "../shared/linkabilityColors";
import { DUST_THRESHOLD } from "@/lib/constants";
import { edgePath, getEdgeMaxProb, portAwareEdgePath } from "./edge-utils";
import { getScriptTypeColor, getScriptTypeDash, getEdgeThickness } from "./scriptStyles";
import { entropyColor } from "./privacyGradient";
import type { LayoutEdge, PortPositionMap, TooltipData } from "./types";
import type { GraphNode } from "@/hooks/useGraphExpansion";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { useChartTooltip } from "../shared/ChartTooltip";

/** Pre-computed per-edge script info (type + value). */
export interface EdgeScriptInfo {
  scriptType: string;
  value: number;
}

/** Entropy propagation entry for a single edge. */
export interface EntropyEdgeEntry {
  normalized: number;
  effectiveEntropy: number;
}

export interface GraphEdgesProps {
  edges: LayoutEdge[];
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  expandedNodeTxid?: string | null;
  portPositions: PortPositionMap;

  // Hover state
  hoveredNode: string | null;
  hoveredEdges: Set<string> | null;
  hoveredEdgeKey: string | null;
  setHoveredEdgeKey: (key: string | null) => void;

  // Focus spotlight
  focusSpotlight: { nodes: Set<string>; edges: Set<string> } | null;

  // Modes
  linkabilityEdgeMode?: boolean;

  // Boltzmann data
  rootBoltzmannResult?: BoltzmannWorkerResult | null;
  boltzmannCache?: Map<string, BoltzmannWorkerResult>;

  // Change outputs
  changeOutputs?: Set<string>;

  // Deterministic chain edges
  detChainEdges: Set<string>;

  // Entropy edges
  entropyEdges: Map<string, EntropyEdgeEntry> | null;

  // Pre-computed edge info
  maxEdgeValue: number;
  edgeScriptInfo: Map<string, EdgeScriptInfo>;

  // Tooltip + coordinate conversion
  tooltip: ReturnType<typeof useChartTooltip<TooltipData>>;
  toScreen: (gx: number, gy: number) => { x: number; y: number };
}

/**
 * Renders all graph edges: main edges, hover overlay, deterministic chain
 * overlay, and flow particles for the focused/expanded node.
 */
export function GraphEdges({
  edges,
  nodes,
  rootTxid,
  expandedNodeTxid,
  portPositions,
  hoveredNode,
  hoveredEdges,
  hoveredEdgeKey,
  setHoveredEdgeKey,
  focusSpotlight,
  linkabilityEdgeMode,
  rootBoltzmannResult,
  boltzmannCache,
  changeOutputs,
  detChainEdges,
  entropyEdges,
  maxEdgeValue,
  edgeScriptInfo,
  tooltip,
  toScreen,
}: GraphEdgesProps) {
  return (
    <>
      {/* Main edges */}
      {edges.map((edge) => (
        <GraphEdge
          key={`e-${edge.fromTxid}-${edge.toTxid}`}
          edge={edge}
          nodes={nodes}
          rootTxid={rootTxid}
          expandedNodeTxid={expandedNodeTxid}
          portPositions={portPositions}
          hoveredNode={hoveredNode}
          hoveredEdges={hoveredEdges}
          hoveredEdgeKey={hoveredEdgeKey}
          setHoveredEdgeKey={setHoveredEdgeKey}
          focusSpotlight={focusSpotlight}
          linkabilityEdgeMode={linkabilityEdgeMode}
          rootBoltzmannResult={rootBoltzmannResult}
          boltzmannCache={boltzmannCache}
          changeOutputs={changeOutputs}
          entropyEdges={entropyEdges}
          maxEdgeValue={maxEdgeValue}
          edgeScriptInfo={edgeScriptInfo}
          tooltip={tooltip}
          toScreen={toScreen}
        />
      ))}

      {/* Hover overlay: re-render hovered linkability edge on top */}
      <HoveredEdgeOverlay
        edges={edges}
        nodes={nodes}
        rootTxid={rootTxid}
        expandedNodeTxid={expandedNodeTxid}
        portPositions={portPositions}
        hoveredEdgeKey={hoveredEdgeKey}
        linkabilityEdgeMode={linkabilityEdgeMode}
        rootBoltzmannResult={rootBoltzmannResult}
      />

      {/* Deterministic chain overlay */}
      {detChainEdges.size > 0 && edges.filter((e) => detChainEdges.has(`e-${e.fromTxid}-${e.toTxid}`)).map((edge) => {
        const edgeKey = `detchain-${edge.fromTxid}-${edge.toTxid}`;
        const hasPortRouting = expandedNodeTxid && (edge.fromTxid === expandedNodeTxid || edge.toTxid === expandedNodeTxid);
        const d = hasPortRouting
          ? portAwareEdgePath(edge, portPositions, nodes as Map<string, { tx: { vin: Array<{ txid: string; vout: number }> } }>)
          : edgePath(edge);
        return (
          <g key={edgeKey} style={{ pointerEvents: "none" }}>
            <path d={d} fill="none" stroke={SVG_COLORS.critical} strokeWidth={5} strokeOpacity={0.15} filter="url(#glow-medium)" />
            <motion.path
              d={d}
              fill="none"
              stroke={SVG_COLORS.critical}
              strokeWidth={2.5}
              strokeOpacity={0.7}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6 }}
            />
          </g>
        );
      })}

      {/* Edge flow particles (on focused/expanded node's edges) */}
      {focusSpotlight && edges.filter((e) => focusSpotlight.edges.has(`e-${e.fromTxid}-${e.toTxid}`)).map((edge) => {
        const d = (portPositions.size > 0)
          ? portAwareEdgePath(edge, portPositions, nodes)
          : edgePath(edge);
        const eKey = `e-${edge.fromTxid}-${edge.toTxid}`;
        const scriptInfo = edgeScriptInfo.get(eKey);
        const particleColor = scriptInfo ? getScriptTypeColor(scriptInfo.scriptType) : SVG_COLORS.muted;
        return [0, 1, 2].map((pi) => (
          <circle
            key={`particle-${eKey}-${pi}`}
            r={2}
            fill={particleColor}
            fillOpacity={0.8}
            style={{
              offsetPath: `path("${d}")`,
              animation: `flow-particle ${2 + pi * 0.3}s linear ${pi * 0.7}s infinite`,
              pointerEvents: "none" as const,
            }}
          />
        ));
      })}
    </>
  );
}

// ─── Single edge rendering ──────────────────────────────────────────

interface GraphEdgeProps {
  edge: LayoutEdge;
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  expandedNodeTxid?: string | null;
  portPositions: PortPositionMap;
  hoveredNode: string | null;
  hoveredEdges: Set<string> | null;
  hoveredEdgeKey: string | null;
  setHoveredEdgeKey: (key: string | null) => void;
  focusSpotlight: { nodes: Set<string>; edges: Set<string> } | null;
  linkabilityEdgeMode?: boolean;
  rootBoltzmannResult?: BoltzmannWorkerResult | null;
  boltzmannCache?: Map<string, BoltzmannWorkerResult>;
  changeOutputs?: Set<string>;
  entropyEdges: Map<string, EntropyEdgeEntry> | null;
  maxEdgeValue: number;
  edgeScriptInfo: Map<string, EdgeScriptInfo>;
  tooltip: ReturnType<typeof useChartTooltip<TooltipData>>;
  toScreen: (gx: number, gy: number) => { x: number; y: number };
}

function GraphEdge({
  edge,
  nodes,
  rootTxid,
  expandedNodeTxid,
  portPositions,
  hoveredNode,
  hoveredEdges,
  hoveredEdgeKey,
  setHoveredEdgeKey,
  focusSpotlight,
  linkabilityEdgeMode,
  rootBoltzmannResult,
  boltzmannCache,
  changeOutputs,
  entropyEdges,
  maxEdgeValue,
  edgeScriptInfo,
  tooltip,
  toScreen,
}: GraphEdgeProps) {
  const edgeKey = `e-${edge.fromTxid}-${edge.toTxid}`;
  const hasPortRouting = expandedNodeTxid && (edge.fromTxid === expandedNodeTxid || edge.toTxid === expandedNodeTxid);
  const d = hasPortRouting
    ? portAwareEdgePath(edge, portPositions, nodes as Map<string, { tx: { vin: Array<{ txid: string; vout: number }> } }>)
    : edgePath(edge);
  const midX = (edge.x1 + edge.x2) / 2;

  const isHoveredViaNode = hoveredEdges?.has(edgeKey);
  const isHoveredDirect = hoveredEdgeKey === edgeKey;
  const isHovered = isHoveredViaNode || isHoveredDirect;
  const isDimmedByHover = hoveredNode && !isHoveredViaNode;
  const isConsolidation = edge.consolidationCount >= 2;

  // Linkability edge coloring: check boltzmannCache for ANY source tx
  let linkabilityColor: string | null = null;
  let linkabilityMaxProb = -1;
  if (linkabilityEdgeMode && edge.outputIndices?.length) {
    const cachedResult = boltzmannCache?.get(edge.fromTxid) ?? (edge.fromTxid === rootTxid ? rootBoltzmannResult : null);
    const mat = cachedResult?.matLnkProbabilities;
    if (mat && mat.length > 0) {
      linkabilityMaxProb = getEdgeMaxProb(mat, edge.outputIndices);
      if (linkabilityMaxProb <= 0) return null;
      linkabilityColor = probColor(linkabilityMaxProb);
    }
  }

  // Script type encoding: color, dash, and thickness from UTXO data
  const scriptInfo = edgeScriptInfo.get(edgeKey);
  const scriptColor = scriptInfo ? getScriptTypeColor(scriptInfo.scriptType) : null;
  const scriptDash = scriptInfo ? getScriptTypeDash(scriptInfo.scriptType) : undefined;
  const scriptThickness = scriptInfo ? getEdgeThickness(scriptInfo.value, maxEdgeValue) : undefined;

  // Check if any output index on this edge is change-marked
  const isChangeMarked = changeOutputs && edge.outputIndices?.some(
    (oi) => changeOutputs.has(`${edge.fromTxid}:${oi}`),
  );

  // Check if this edge carries dust-level value
  const isDust = scriptInfo && scriptInfo.value > 0 && scriptInfo.value <= DUST_THRESHOLD;

  // Entropy gradient mode: override edge color with effective entropy
  const entropyEntry = entropyEdges?.get(edgeKey);
  const entropyColorVal = entropyEntry ? entropyColor(entropyEntry.normalized) : null;

  const strokeColor = entropyColorVal
    ?? linkabilityColor
    ?? (isChangeMarked ? "#d97706" : (isConsolidation ? SVG_COLORS.critical : (scriptColor ?? SVG_COLORS.muted)));

  // Resolve stroke opacity from the highest-priority active mode
  const entropyNorm = entropyEntry?.normalized ?? 0;
  const entropyOpacity = 0.4 + entropyNorm * 0.5;
  const linkOpacity = 0.3 + linkabilityMaxProb * 0.7;
  const baseOpacity = isChangeMarked ? 0.8 : (isConsolidation ? 0.6 : (scriptColor ? 0.55 : 0.45));
  let strokeOpacity = entropyColorVal ? entropyOpacity : (linkabilityColor ? linkOpacity : baseOpacity);
  let strokeWidth = linkabilityColor ? 2.5 : (isChangeMarked ? 3 : (isConsolidation ? 2.5 : (scriptThickness ?? 1.5)));
  // Dust edges: visible but distinct (dashed, reduced opacity)
  let dustDash: string | undefined;
  if (isDust && !linkabilityColor && !isChangeMarked) {
    strokeOpacity = 0.3;
    strokeWidth = Math.min(strokeWidth, 1.5);
    dustDash = "2 2";
  }

  if (isHovered && !linkabilityColor) {
    strokeOpacity = isConsolidation ? 0.9 : 0.7;
    strokeWidth = isConsolidation ? 3.5 : 2.5;
  }
  // Focus spotlight: dim edges not connected to expanded node
  if (focusSpotlight && !focusSpotlight.edges.has(edgeKey)) strokeOpacity = 0.06;
  else if (isDimmedByHover) strokeOpacity = isConsolidation ? 0.2 : 0.1;

  let markerEnd: string | undefined;
  let markerStart: string | undefined;
  if (edge.isBackward) {
    markerStart = isConsolidation ? "url(#arrow-graph-consolidation-start)" : "url(#arrow-graph-start)";
  } else {
    markerEnd = isConsolidation ? "url(#arrow-graph-consolidation)" : "url(#arrow-graph)";
  }

  const edgeMaxProb = linkabilityMaxProb >= 0 ? linkabilityMaxProb : undefined;
  const hasEdgeTooltip = edgeMaxProb !== undefined || entropyEntry != null;

  return (
    <g>
      {hasEdgeTooltip && (
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={12}
          style={{ cursor: "default" }}
          onMouseMove={() => {
            setHoveredEdgeKey(edgeKey);
            const eMidX = (edge.x1 + edge.x2) / 2;
            const eMidY = (edge.y1 + edge.y2) / 2;
            const pos = toScreen(eMidX, eMidY - 12);
            tooltip.showTooltip({
              tooltipData: {
                txid: edge.fromTxid,
                inputCount: 0, outputCount: 0, totalValue: 0,
                isCoinJoin: false, depth: 0, fee: 0, feeRate: "",
                confirmed: true,
                linkProb: edgeMaxProb,
                entropyNormalized: entropyEntry?.normalized,
                entropyBits: entropyEntry?.effectiveEntropy,
              },
              tooltipLeft: pos.x,
              tooltipTop: pos.y,
            });
          }}
          onMouseLeave={() => { setHoveredEdgeKey(null); tooltip.hideTooltip(); }}
        />
      )}
      <motion.path
        d={d}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeOpacity={strokeOpacity}
        strokeDasharray={dustDash ?? scriptDash ?? undefined}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={entropyColorVal ? {
          "--ep-min": String(Math.max(0.2, strokeOpacity - 0.15)),
          "--ep-max": String(Math.min(1, strokeOpacity + 0.15)),
          animation: `entropy-pulse ${1.5 + (1 - (entropyEntry?.normalized ?? 0.5)) * 2}s ease-in-out infinite`,
          pointerEvents: "none" as const,
        } as React.CSSProperties : { pointerEvents: "none" as const }}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4 }}
      />
      {isConsolidation && (
        <Text
          x={midX}
          y={(edge.y1 + edge.y2) / 2 - 6}
          textAnchor="middle"
          fontSize={9}
          fontWeight={700}
          fill={SVG_COLORS.critical}
          fillOpacity={isDimmedByHover ? 0.15 : 0.85}
          style={{ pointerEvents: "none" as const }}
        >
          {`${edge.consolidationCount} outputs`}
        </Text>
      )}
      {/* Deterministic link badge (100%) - only for multi-input txs */}
      {!isConsolidation && edge.outputIndices?.length === 1 && (() => {
        const edgeBoltz = boltzmannCache?.get(edge.fromTxid) ?? (edge.fromTxid === rootTxid ? rootBoltzmannResult : null);
        if (!edgeBoltz?.deterministicLinks?.length) return null;
        if (edgeBoltz.nInputs <= 1) return null;
        const outIdx = edge.outputIndices![0];
        const isDeterministic = edgeBoltz.deterministicLinks.some(
          ([oi]) => oi === outIdx,
        );
        if (!isDeterministic) return null;
        return (
          <g style={{ pointerEvents: "none" }}>
            <rect
              x={midX - 16}
              y={(edge.y1 + edge.y2) / 2 - 10}
              width={32}
              height={14}
              rx={3}
              fill={SVG_COLORS.background}
              fillOpacity={0.8}
              stroke={SVG_COLORS.critical}
              strokeWidth={0.5}
              strokeOpacity={0.6}
            />
            <Text
              x={midX}
              y={(edge.y1 + edge.y2) / 2}
              textAnchor="middle"
              fontSize={8}
              fontWeight={700}
              fill={SVG_COLORS.critical}
              fillOpacity={isDimmedByHover ? 0.2 : 0.9}
            >
              100%
            </Text>
          </g>
        );
      })()}
    </g>
  );
}

// ─── Hovered edge overlay ───────────────────────────────────────────

interface HoveredEdgeOverlayProps {
  edges: LayoutEdge[];
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  expandedNodeTxid?: string | null;
  portPositions: PortPositionMap;
  hoveredEdgeKey: string | null;
  linkabilityEdgeMode?: boolean;
  rootBoltzmannResult?: BoltzmannWorkerResult | null;
}

function HoveredEdgeOverlay({
  edges,
  nodes,
  rootTxid,
  expandedNodeTxid,
  portPositions,
  hoveredEdgeKey,
  linkabilityEdgeMode,
  rootBoltzmannResult,
}: HoveredEdgeOverlayProps) {
  const overlay = useMemo(() => {
    if (!hoveredEdgeKey || !linkabilityEdgeMode || !rootBoltzmannResult) return null;
    const edge = edges.find((e) => `e-${e.fromTxid}-${e.toTxid}` === hoveredEdgeKey);
    if (!edge || edge.fromTxid !== rootTxid || !edge.outputIndices?.length) return null;
    const mat = rootBoltzmannResult.matLnkProbabilities;
    if (!mat?.length) return null;
    const maxProb = getEdgeMaxProb(mat, edge.outputIndices);
    if (maxProb <= 0) return null;
    const hasPortRouting = expandedNodeTxid && (edge.fromTxid === expandedNodeTxid || edge.toTxid === expandedNodeTxid);
    const d = hasPortRouting
      ? portAwareEdgePath(edge, portPositions, nodes as Map<string, { tx: { vin: Array<{ txid: string; vout: number }> } }>)
      : edgePath(edge);
    const color = probColor(maxProb);
    return { d, color };
  }, [hoveredEdgeKey, linkabilityEdgeMode, rootBoltzmannResult, edges, rootTxid, expandedNodeTxid, portPositions, nodes]);

  if (!overlay) return null;
  return (
    <g style={{ pointerEvents: "none" }}>
      <path d={overlay.d} fill="none" stroke={overlay.color} strokeWidth={6.5} strokeOpacity={0.4} filter="url(#glow-medium)" />
      <path d={overlay.d} fill="none" stroke={overlay.color} strokeWidth={2.5} strokeOpacity={1.0}
        strokeDasharray={undefined} />
    </g>
  );
}
