import { useMemo } from "react";
import { layoutGraph } from "./layout";
import { buildPortPositionMap } from "./portLayout";
import { computeDeterministicChains, buildDetChainEdgeSet } from "./deterministicChains";
import { detectToxicMerges, buildToxicMergeSet } from "./toxicChange";
import { computeEntropyPropagation } from "./privacyGradient";
import { computeFocusSpotlight } from "./focusSpotlight";
import { computeRicochetHopLabels } from "./ricochetDetection";
import type { GraphNode, LayoutNode, LayoutEdge, NodeFilter, PortPositionMap } from "./types";
import type { FocusSpotlight } from "./focusSpotlight";
import type { EdgeEntropy } from "./privacyGradient";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

interface UseGraphLayoutParams {
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  filter: NodeFilter;
  rootTxids?: Set<string>;
  expandedNodeTxid?: string | null;
  isFullscreen: boolean;
  nodePositionOverrides?: Map<string, { x: number; y: number }>;
  boltzmannCache?: Map<string, BoltzmannWorkerResult>;
  entropyGradientMode?: boolean;
  hoveredNode: string | null;
}

interface UseGraphLayoutResult {
  layoutNodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  nodePositions: Map<string, { x: number; y: number; w: number; h: number }>;
  ricochetHopLabels: Map<string, string>;
  portPositions: PortPositionMap;
  maxEdgeValue: number;
  edgeScriptInfo: Map<string, { scriptType: string; value: number }>;
  detChainEdges: Set<string>;
  entropyEdges: Map<string, EdgeEntropy> | null;
  toxicMergeNodes: Set<string>;
  hoveredEdges: Set<string> | null;
  focusSpotlight: FocusSpotlight | null;
}

export function useGraphLayout({
  nodes,
  rootTxid,
  filter,
  rootTxids,
  expandedNodeTxid,
  isFullscreen,
  nodePositionOverrides,
  boltzmannCache,
  entropyGradientMode,
  hoveredNode,
}: UseGraphLayoutParams): UseGraphLayoutResult {
  const { layoutNodes, edges, width, height, nodePositions } = useMemo(
    () => layoutGraph(nodes, rootTxid, filter, rootTxids, expandedNodeTxid, isFullscreen, nodePositionOverrides),
    [nodes, rootTxid, filter, rootTxids, expandedNodeTxid, isFullscreen, nodePositionOverrides],
  );

  // Pre-compute ricochet hop labels by walking forward from hop 0 nodes
  const ricochetHopLabels = useMemo(
    () => computeRicochetHopLabels(layoutNodes, edges),
    [layoutNodes, edges],
  );

  // Build port position map for expanded node (used for edge routing)
  const portPositions = useMemo(
    () => buildPortPositionMap(expandedNodeTxid ?? null, nodes, nodePositions),
    [expandedNodeTxid, nodes, nodePositions],
  );

  // Compute max edge value for thickness scaling and resolve script types per edge
  const { maxEdgeValue, edgeScriptInfo } = useMemo(() => {
    let maxVal = 0;
    const info = new Map<string, { scriptType: string; value: number }>();
    for (const edge of edges) {
      const sourceNode = nodes.get(edge.fromTxid);
      const outIdx = edge.outputIndices?.[0];
      if (!sourceNode || outIdx === undefined) continue;
      const vout = sourceNode.tx.vout[outIdx];
      if (vout) {
        const val = vout.value;
        if (val > maxVal) maxVal = val;
        const key = `e-${edge.fromTxid}-${edge.toTxid}`;
        info.set(key, { scriptType: vout.scriptpubkey_type, value: val });
      }
    }
    return { maxEdgeValue: maxVal, edgeScriptInfo: info };
  }, [edges, nodes]);

  // Compute deterministic link chains for overlay rendering
  const detChainEdges = useMemo(() => {
    if (!boltzmannCache || boltzmannCache.size === 0) return new Set<string>();
    const chains = computeDeterministicChains(nodes, boltzmannCache);
    return buildDetChainEdgeSet(chains);
  }, [nodes, boltzmannCache]);

  // Compute entropy propagation (effective entropy per edge)
  const entropyEdges = useMemo(() => {
    if (!entropyGradientMode || !boltzmannCache || boltzmannCache.size === 0) return null;
    return computeEntropyPropagation(nodes, rootTxid, boltzmannCache);
  }, [entropyGradientMode, nodes, rootTxid, boltzmannCache]);

  // Detect toxic change merges (CoinJoin change spent with mixed output)
  const toxicMergeNodes = useMemo(() => {
    const merges = detectToxicMerges(nodes);
    return buildToxicMergeSet(merges);
  }, [nodes]);

  // Edges connected to hovered node
  const hoveredEdges = useMemo(() => {
    if (!hoveredNode) return null;
    const set = new Set<string>();
    for (const e of edges) {
      if (e.fromTxid === hoveredNode || e.toTxid === hoveredNode) {
        set.add(`e-${e.fromTxid}-${e.toTxid}`);
      }
    }
    return set;
  }, [hoveredNode, edges]);

  // Focus spotlight: nodes/edges connected to the expanded (sidebar) node
  const focusSpotlight = useMemo(
    () => computeFocusSpotlight(expandedNodeTxid ?? null, edges),
    [expandedNodeTxid, edges],
  );

  return {
    layoutNodes,
    edges,
    width,
    height,
    nodePositions,
    ricochetHopLabels,
    portPositions,
    maxEdgeValue,
    edgeScriptInfo,
    detChainEdges,
    entropyEdges,
    toxicMergeNodes,
    hoveredEdges,
    focusSpotlight,
  };
}
