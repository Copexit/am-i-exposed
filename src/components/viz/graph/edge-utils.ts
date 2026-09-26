import { SVG_COLORS } from "../shared/svgConstants";
import { probColor } from "../shared/linkabilityColors";
import { CHANGE_MARKED_COLOR } from "@/lib/palette";
import { DUST_THRESHOLD } from "@/lib/constants";
import { getScriptTypeColor, getScriptTypeDash, getEdgeThickness } from "./scriptStyles";
import { entropyColor } from "./privacyGradient";
import type { LayoutEdge, PortPositionMap } from "./types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

// ─── Types for extracted helpers ─────────────────────────────────

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

/** Resolved linkability info for a single edge. */
export interface EdgeLinkability {
  color: string | null;
  maxProb: number;
}

/** Fully resolved stroke styles for rendering a single edge. */
export interface EdgeStrokeStyle {
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  dashArray: string | undefined;
  markerEnd: string | undefined;
  markerStart: string | undefined;
}

// ─── Core edge path helpers ──────────────────────────────────────

/** Compute the max linkability probability across all output indices for an edge. */
export function getEdgeMaxProb(
  mat: number[][],
  outputIndices: number[],
): number {
  let maxProb = 0;
  for (const outIdx of outputIndices) {
    for (const p of mat[outIdx] ?? []) {
      if (p > maxProb) maxProb = p;
    }
  }
  return maxProb;
}

/** Build a cubic bezier SVG path for an edge. */
export function edgePath(edge: LayoutEdge): string {
  const midX = (edge.x1 + edge.x2) / 2;
  return edge.isBackward
    ? `M${edge.x2},${edge.y2} C${midX},${edge.y2} ${midX},${edge.y1} ${edge.x1},${edge.y1}`
    : `M${edge.x1},${edge.y1} C${midX},${edge.y1} ${midX},${edge.y2} ${edge.x2},${edge.y2}`;
}

/**
 * Build a port-aware edge path. When source or dest is expanded and has port positions,
 * the edge connects to the specific port y-position instead of the node center.
 */
export function portAwareEdgePath(
  edge: LayoutEdge,
  portPositions: PortPositionMap,
  graphNodes: Map<string, { tx: { vin: Array<{ txid: string; vout: number }> } }>,
): string {
  let { x1, y1, x2, y2 } = edge;

  // Check if the source (fromTxid) is expanded and has output port positions
  if (edge.outputIndices?.length) {
    const outIdx = edge.outputIndices[0];
    const portPos = portPositions.get(`${edge.fromTxid}:output:${outIdx}`);
    if (portPos) {
      x1 = portPos.x;
      y1 = portPos.y;
    }
  }

  // Check if the dest (toTxid) is expanded and has input port positions
  const destNode = graphNodes.get(edge.toTxid);
  if (destNode) {
    for (const [i, vin] of destNode.tx.vin.entries()) {
      if (vin.txid === edge.fromTxid && edge.outputIndices?.includes(vin.vout)) {
        const portPos = portPositions.get(`${edge.toTxid}:input:${i}`);
        if (portPos) {
          x2 = portPos.x;
          y2 = portPos.y;
          break;
        }
      }
    }
  }

  const cpOffset = Math.max(Math.abs(x2 - x1) * 0.4, 40);

  if (edge.isBackward) {
    return `M${x2},${y2} C${x2 + cpOffset},${y2} ${x1 - cpOffset},${y1} ${x1},${y1}`;
  }
  return `M${x1},${y1} C${x1 + cpOffset},${y1} ${x2 - cpOffset},${y2} ${x2},${y2}`;
}

// ─── Consolidation path computation ──────────────────────────────

/**
 * Build one bezier path per output port for consolidation edges
 * (edges where multiple outputs from one tx flow into another).
 * Returns an empty array when the edge is not a consolidation with port routing.
 */
export function buildConsolidationPaths(
  edge: LayoutEdge,
  portPositions: PortPositionMap,
  nodes: Map<string, { tx: { vin: Array<{ txid: string; vout: number }> } }>,
): string[] {
  if (!edge.outputIndices || edge.outputIndices.length < 2) return [];

  const destNode = nodes.get(edge.toTxid);
  let destX = edge.x2;
  let destY = edge.y2;
  if (destNode) {
    for (const [i, vin] of destNode.tx.vin.entries()) {
      if (vin.txid === edge.fromTxid && edge.outputIndices.includes(vin.vout)) {
        const pp = portPositions.get(`${edge.toTxid}:input:${i}`);
        if (pp) { destX = pp.x; destY = pp.y; break; }
      }
    }
  }

  const paths: string[] = [];
  for (const outIdx of edge.outputIndices) {
    const portPos = portPositions.get(`${edge.fromTxid}:output:${outIdx}`);
    const srcX = portPos?.x ?? edge.x1;
    const srcY = portPos?.y ?? edge.y1;
    const cpOffset = Math.max(Math.abs(destX - srcX) * 0.4, 40);
    paths.push(
      edge.isBackward
        ? `M${destX},${destY} C${destX + cpOffset},${destY} ${srcX - cpOffset},${srcY} ${srcX},${srcY}`
        : `M${srcX},${srcY} C${srcX + cpOffset},${srcY} ${destX - cpOffset},${destY} ${destX},${destY}`,
    );
  }
  return paths;
}

// ─── Linkability resolution ──────────────────────────────────────

/**
 * Resolve the linkability coloring for an edge using Boltzmann data.
 * Returns `{ color, maxProb }` where color is null if linkability mode
 * is off or no data exists for this edge.
 */
export function resolveEdgeLinkability(
  edge: LayoutEdge,
  linkabilityEdgeMode: boolean | undefined,
  rootTxid: string,
  rootBoltzmannResult: BoltzmannWorkerResult | null | undefined,
  boltzmannCache: Map<string, BoltzmannWorkerResult> | undefined,
): EdgeLinkability {
  if (!linkabilityEdgeMode || !edge.outputIndices?.length) {
    return { color: null, maxProb: -1 };
  }
  const cachedResult = boltzmannCache?.get(edge.fromTxid) ?? (edge.fromTxid === rootTxid ? rootBoltzmannResult : null);
  const mat = cachedResult?.matLnkProbabilities;
  if (!mat || mat.length === 0) {
    return { color: null, maxProb: -1 };
  }
  const maxProb = getEdgeMaxProb(mat, edge.outputIndices);
  if (maxProb <= 0) return { color: null, maxProb };
  return { color: probColor(maxProb), maxProb };
}

// ─── Stroke style computation ────────────────────────────────────

interface StrokeContext {
  edge: LayoutEdge;
  edgeKey: string;
  linkability: EdgeLinkability;
  entropyEntry: EntropyEdgeEntry | undefined;
  scriptInfo: EdgeScriptInfo | undefined;
  maxEdgeValue: number;
  changeOutputs: Set<string> | undefined;
  hoveredNode: string | null;
  hoveredEdges: Set<string> | null;
  hoveredEdgeKey: string | null;
  focusSpotlight: { nodes: Set<string>; edges: Set<string> } | null;
}

/**
 * Compute fully resolved stroke styles (color, opacity, width, dash, markers)
 * for a single edge given all relevant context.
 */
export function computeEdgeStroke(ctx: StrokeContext): EdgeStrokeStyle {
  const {
    edge, edgeKey, linkability, entropyEntry, scriptInfo,
    maxEdgeValue, changeOutputs, hoveredNode, hoveredEdges,
    hoveredEdgeKey, focusSpotlight,
  } = ctx;
  const isConsolidation = edge.consolidationCount >= 2;
  const isHoveredViaNode = hoveredEdges?.has(edgeKey) ?? false;
  const isHoveredDirect = hoveredEdgeKey === edgeKey;
  const isHovered = isHoveredViaNode || isHoveredDirect;
  const isDimmedByHover = !!hoveredNode && !isHoveredViaNode;

  const scriptColor = scriptInfo ? getScriptTypeColor(scriptInfo.scriptType) : null;
  const scriptDash = scriptInfo ? getScriptTypeDash(scriptInfo.scriptType) : undefined;
  const scriptThickness = scriptInfo ? getEdgeThickness(scriptInfo.value, maxEdgeValue) : undefined;

  const isChangeMarked = changeOutputs && edge.outputIndices?.some(
    (oi) => changeOutputs.has(`${edge.fromTxid}:${oi}`),
  );
  const isDust = scriptInfo && scriptInfo.value > 0 && scriptInfo.value <= DUST_THRESHOLD;

  const entropyColorVal = entropyEntry ? entropyColor(entropyEntry.normalized) : null;

  const strokeColor = entropyColorVal
    ?? linkability.color
    ?? (isChangeMarked ? CHANGE_MARKED_COLOR : (isConsolidation ? SVG_COLORS.critical : (scriptColor ?? SVG_COLORS.muted)));

  // Resolve stroke opacity from the highest-priority active mode
  const entropyNorm = entropyEntry?.normalized ?? 0;
  const entropyOpacity = 0.4 + entropyNorm * 0.5;
  const linkOpacity = 0.3 + linkability.maxProb * 0.7;
  const baseOpacity = isChangeMarked ? 0.8 : (isConsolidation ? 0.6 : (scriptColor ? 0.55 : 0.45));
  let strokeOpacity = entropyColorVal ? entropyOpacity : (linkability.color ? linkOpacity : baseOpacity);
  let strokeWidth = linkability.color ? 2.5 : (isChangeMarked ? 3 : (isConsolidation ? 2.5 : (scriptThickness ?? 1.5)));

  // Dust edges: visible but distinct (dashed, reduced opacity)
  let dustDash: string | undefined;
  if (isDust && !linkability.color && !isChangeMarked) {
    strokeOpacity = 0.3;
    strokeWidth = Math.min(strokeWidth, 1.5);
    dustDash = "2 2";
  }

  if (isHovered && !linkability.color) {
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

  return {
    strokeColor,
    strokeOpacity,
    strokeWidth,
    dashArray: dustDash ?? scriptDash ?? undefined,
    markerEnd,
    markerStart,
  };
}

/**
 * Resolve the primary SVG path for an edge, considering port routing and consolidation.
 * Also returns any extra consolidation paths when applicable.
 */
export function resolveEdgePaths(
  edge: LayoutEdge,
  expandedNodeTxid: string | null | undefined,
  portPositions: PortPositionMap,
  nodes: Map<string, { tx: { vin: Array<{ txid: string; vout: number }> } }>,
): { primary: string; extraConsolidation: string[] } {
  const hasPortRouting = expandedNodeTxid && (edge.fromTxid === expandedNodeTxid || edge.toTxid === expandedNodeTxid);
  const isConsolidationWithPorts = hasPortRouting && edge.consolidationCount >= 2 && edge.outputIndices && edge.outputIndices.length >= 2;

  if (isConsolidationWithPorts) {
    const consolidationPaths = buildConsolidationPaths(edge, portPositions, nodes);
    return {
      primary: consolidationPaths[0] ?? edgePath(edge),
      extraConsolidation: consolidationPaths.slice(1),
    };
  }

  const primary = hasPortRouting
    ? portAwareEdgePath(edge, portPositions, nodes)
    : edgePath(edge);

  return { primary, extraConsolidation: [] };
}