"use client";

import { motion } from "motion/react";
import { Text } from "@visx/text";
import { useTranslation } from "react-i18next";
import { SVG_COLORS } from "../shared/svgConstants";
import {
  edgePath, portAwareEdgePath,
  resolveEdgePaths, resolveEdgeLinkability, computeEdgeStroke,
} from "./edge-utils";
import { getScriptTypeColor } from "./scriptStyles";
import { useEdgeTooltip } from "./useEdgeTooltip";
import { HoveredEdgeOverlay } from "./HoveredEdgeOverlay";
import type { LayoutEdge, PortPositionMap, TooltipData } from "./types";
import type { GraphNode } from "@/hooks/useGraphExpansion";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { EdgeBundle, EdgeScriptInfo, EntropyEdgeEntry } from "./edge-utils";
import type { useChartTooltip } from "../shared/ChartTooltip";

// Re-export types that consumers import from this module
export type { EdgeScriptInfo, EntropyEdgeEntry } from "./edge-utils";

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

  // Parallel-output bundles split by the user ("from->to")
  unbundledPairs?: Set<string>;
  onToggleBundle?: (key: string) => void;
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
  unbundledPairs,
  onToggleBundle,
}: GraphEdgesProps) {
  const { showEdgeTooltip, hideEdgeTooltip } = useEdgeTooltip({ tooltip, toScreen, setHoveredEdgeKey });

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
          focusSpotlight={focusSpotlight}
          linkabilityEdgeMode={linkabilityEdgeMode}
          rootBoltzmannResult={rootBoltzmannResult}
          boltzmannCache={boltzmannCache}
          changeOutputs={changeOutputs}
          entropyEdges={entropyEdges}
          maxEdgeValue={maxEdgeValue}
          edgeScriptInfo={edgeScriptInfo}
          showEdgeTooltip={showEdgeTooltip}
          hideEdgeTooltip={hideEdgeTooltip}
          unbundledPairs={unbundledPairs}
          onToggleBundle={onToggleBundle}
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
        unbundledPairs={unbundledPairs}
      />

      {/* Deterministic chain overlay */}
      {detChainEdges.size > 0 && edges.filter((e) => detChainEdges.has(`e-${e.fromTxid}-${e.toTxid}`)).map((edge) => {
        const detKey = `detchain-${edge.fromTxid}-${edge.toTxid}`;
        const { primary: d } = resolveEdgePaths(edge, expandedNodeTxid, portPositions, nodes, unbundledPairs);
        return (
          <g key={detKey} style={{ pointerEvents: "none" }}>
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
  focusSpotlight: { nodes: Set<string>; edges: Set<string> } | null;
  linkabilityEdgeMode?: boolean;
  rootBoltzmannResult?: BoltzmannWorkerResult | null;
  boltzmannCache?: Map<string, BoltzmannWorkerResult>;
  changeOutputs?: Set<string>;
  entropyEdges: Map<string, EntropyEdgeEntry> | null;
  maxEdgeValue: number;
  edgeScriptInfo: Map<string, EdgeScriptInfo>;
  showEdgeTooltip: (ctx: {
    edge: LayoutEdge;
    edgeKey: string;
    edgeMaxProb: number | undefined;
    entropyEntry: EntropyEdgeEntry | undefined;
  }) => void;
  hideEdgeTooltip: () => void;
  unbundledPairs?: Set<string>;
  onToggleBundle?: (key: string) => void;
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
  focusSpotlight,
  linkabilityEdgeMode,
  rootBoltzmannResult,
  boltzmannCache,
  changeOutputs,
  entropyEdges,
  maxEdgeValue,
  edgeScriptInfo,
  showEdgeTooltip,
  hideEdgeTooltip,
  unbundledPairs,
  onToggleBundle,
}: GraphEdgeProps) {
  const { t } = useTranslation();
  const edgeKey = `e-${edge.fromTxid}-${edge.toTxid}`;

  // Resolve paths (primary + extra consolidation paths, or one bundled path)
  const { primary: d, extraConsolidation, bundle } = resolveEdgePaths(
    edge, expandedNodeTxid, portPositions, nodes, unbundledPairs,
  );
  const midX = (edge.x1 + edge.x2) / 2;

  const isConsolidation = edge.consolidationCount >= 2;
  const isDimmedByHover = !!hoveredNode && !hoveredEdges?.has(edgeKey);

  // Linkability edge coloring
  const linkability = resolveEdgeLinkability(
    edge, linkabilityEdgeMode, rootTxid, rootBoltzmannResult, boltzmannCache,
  );
  // Early return if linkability mode is on but probability is zero
  if (linkabilityEdgeMode && edge.outputIndices?.length && linkability.maxProb <= 0 && linkability.color === null) {
    // Check if there was actually Boltzmann data - if so, this edge has 0 prob, skip it
    const cachedResult = boltzmannCache?.get(edge.fromTxid) ?? (edge.fromTxid === rootTxid ? rootBoltzmannResult : null);
    if (cachedResult?.matLnkProbabilities?.length) return null;
  }

  // Entropy entry
  const entropyEntry = entropyEdges?.get(edgeKey);

  // Compute stroke styles via the extracted pure function
  const stroke = computeEdgeStroke({
    edge,
    edgeKey,
    linkability,
    entropyEntry,
    scriptInfo: edgeScriptInfo.get(edgeKey),
    maxEdgeValue,
    changeOutputs,
    hoveredNode,
    hoveredEdges,
    hoveredEdgeKey,
    focusSpotlight,
  });

  const edgeMaxProb = linkability.maxProb >= 0 ? linkability.maxProb : undefined;
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
          onMouseMove={() => showEdgeTooltip({ edge, edgeKey, edgeMaxProb, entropyEntry })}
          onMouseLeave={hideEdgeTooltip}
        />
      )}
      <motion.path
        d={d}
        fill="none"
        stroke={stroke.strokeColor}
        strokeWidth={bundle && !bundle.expanded ? stroke.strokeWidth * 2 : stroke.strokeWidth}
        strokeOpacity={stroke.strokeOpacity}
        strokeDasharray={stroke.dashArray}
        markerEnd={stroke.markerEnd}
        markerStart={stroke.markerStart}
        style={entropyEntry ? {
          "--ep-min": String(Math.max(0.2, stroke.strokeOpacity - 0.15)),
          "--ep-max": String(Math.min(1, stroke.strokeOpacity + 0.15)),
          animation: `entropy-pulse ${1.5 + (1 - (entropyEntry?.normalized ?? 0.5)) * 2}s ease-in-out infinite`,
          pointerEvents: "none" as const,
        } as React.CSSProperties : { pointerEvents: "none" as const }}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4 }}
      />
      {/* Extra consolidation paths: one per additional output port */}
      {extraConsolidation.map((cp, ci) => (
        <motion.path
          key={`${edgeKey}-cons-${ci}`}
          d={cp}
          fill="none"
          stroke={stroke.strokeColor}
          strokeWidth={stroke.strokeWidth}
          strokeOpacity={stroke.strokeOpacity}
          strokeDasharray={stroke.dashArray}
          style={{ pointerEvents: "none" as const }}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, delay: 0.05 * (ci + 1) }}
        />
      ))}
      {bundle && onToggleBundle && (
        <BundleBadge bundle={bundle} color={stroke.strokeColor} dimmed={isDimmedByHover} onToggle={onToggleBundle} />
      )}
      {isConsolidation && !bundle && (
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
          {t("graph.edgeOutputs", { count: edge.consolidationCount, defaultValue: "{{count}} outputs" })}
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


/** "×N" badge on a bundled parallel-output edge; toggles it to per-port beziers and back. */
function BundleBadge({ bundle, color, dimmed, onToggle }: {
  bundle: EdgeBundle;
  color: string;
  dimmed: boolean;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  const n = bundle.vouts.length;
  const label = bundle.expanded
    ? t("graph.bundle.collapse", { defaultValue: "Bundle parallel outputs" })
    : t("graph.bundle.expand", { defaultValue: "Show each output separately" });
  const toggle = (e: React.SyntheticEvent) => { e.stopPropagation(); onToggle(bundle.key); };
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={bundle.expanded}
      aria-label={`${label} (×${n})`}
      data-testid="bundle-badge"
      className="cursor-pointer outline-none [&:focus-visible>rect:last-of-type]:stroke-[2.5]"
      opacity={dimmed ? 0.3 : 1}
      onClick={toggle}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); } }}
    >
      <title>{t("graph.bundle.vouts", { vouts: bundle.vouts.join(", "), defaultValue: "Outputs {{vouts}}" })}</title>
      {/* Larger transparent hit area for taps */}
      <rect x={bundle.x - 22} y={bundle.y - 16} width={44} height={32} fill="transparent" />
      <rect
        x={bundle.x - 15} y={bundle.y - 9} width={30} height={18} rx={9}
        fill={bundle.expanded ? SVG_COLORS.background : color}
        fillOpacity={bundle.expanded ? 0.9 : 1}
        stroke={color} strokeWidth={1.5}
      />
      <text
        x={bundle.x} y={bundle.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={700}
        fill={bundle.expanded ? color : SVG_COLORS.background}
        style={{ pointerEvents: "none" }}
      >
        {`×${n}`}
      </text>
    </g>
  );
}
