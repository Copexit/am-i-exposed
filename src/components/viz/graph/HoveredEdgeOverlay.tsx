"use client";

import { useMemo } from "react";
import { probColor } from "../shared/linkabilityColors";
import { getEdgeMaxProb, resolveEdgePaths } from "./edge-utils";
import type { LayoutEdge, PortPositionMap } from "./types";
import type { GraphNode } from "@/hooks/useGraphExpansion";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

export interface HoveredEdgeOverlayProps {
  edges: LayoutEdge[];
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  expandedNodeTxid?: string | null;
  portPositions: PortPositionMap;
  hoveredEdgeKey: string | null;
  linkabilityEdgeMode?: boolean;
  rootBoltzmannResult?: BoltzmannWorkerResult | null;
  unbundledPairs?: Set<string>;
}

export function HoveredEdgeOverlay({
  edges,
  nodes,
  rootTxid,
  expandedNodeTxid,
  portPositions,
  hoveredEdgeKey,
  linkabilityEdgeMode,
  rootBoltzmannResult,
  unbundledPairs,
}: HoveredEdgeOverlayProps) {
  const overlay = useMemo(() => {
    if (!hoveredEdgeKey || !linkabilityEdgeMode || !rootBoltzmannResult) return null;
    const edge = edges.find((e) => `e-${e.fromTxid}-${e.toTxid}` === hoveredEdgeKey);
    if (!edge || edge.fromTxid !== rootTxid || !edge.outputIndices?.length) return null;
    const mat = rootBoltzmannResult.matLnkProbabilities;
    if (!mat?.length) return null;
    const maxProb = getEdgeMaxProb(mat, edge.outputIndices);
    if (maxProb <= 0) return null;
    const { primary: d } = resolveEdgePaths(edge, expandedNodeTxid, portPositions, nodes, unbundledPairs);
    const color = probColor(maxProb);
    return { d, color };
  }, [hoveredEdgeKey, linkabilityEdgeMode, rootBoltzmannResult, edges, rootTxid, expandedNodeTxid, portPositions, nodes, unbundledPairs]);

  if (!overlay) return null;
  return (
    <g style={{ pointerEvents: "none" }}>
      <path d={overlay.d} fill="none" stroke={overlay.color} strokeWidth={6.5} strokeOpacity={0.4} filter="url(#glow-medium)" />
      <path d={overlay.d} fill="none" stroke={overlay.color} strokeWidth={2.5} strokeOpacity={1.0}
        strokeDasharray={undefined} />
    </g>
  );
}
