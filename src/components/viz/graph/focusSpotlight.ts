import type { LayoutEdge } from "./types";

export interface FocusSpotlight {
  nodes: Set<string>;
  edges: Set<string>;
}

/**
 * Compute the set of nodes and edges connected to the expanded (sidebar) node.
 * Used to dim everything else (spotlight effect).
 *
 * Returns `null` if no node is expanded.
 */
export function computeFocusSpotlight(
  expandedNodeTxid: string | null | undefined,
  edges: LayoutEdge[],
): FocusSpotlight | null {
  if (!expandedNodeTxid) return null;
  const connectedNodes = new Set<string>([expandedNodeTxid]);
  const connectedEdges = new Set<string>();
  for (const e of edges) {
    if (e.fromTxid === expandedNodeTxid || e.toTxid === expandedNodeTxid) {
      connectedNodes.add(e.fromTxid);
      connectedNodes.add(e.toTxid);
      connectedEdges.add(`e-${e.fromTxid}-${e.toTxid}`);
    }
  }
  return { nodes: connectedNodes, edges: connectedEdges };
}
