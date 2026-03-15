import type { LayoutEdge, ViewTransform, PortPositionMap } from "./types";

/** Compute the max linkability probability across all output indices for an edge. */
export function getEdgeMaxProb(
  mat: number[][],
  outputIndices: number[],
): number {
  let maxProb = 0;
  for (const outIdx of outputIndices) {
    if (outIdx < mat.length) {
      const row = mat[outIdx];
      for (let i = 0; i < row.length; i++) {
        if (row[i] > maxProb) maxProb = row[i];
      }
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
    for (let i = 0; i < destNode.tx.vin.length; i++) {
      const vin = destNode.tx.vin[i];
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

  const midX = (x1 + x2) / 2;
  const cpOffset = Math.max(Math.abs(x2 - x1) * 0.4, 40);

  if (edge.isBackward) {
    return `M${x2},${y2} C${x2 + cpOffset},${y2} ${x1 - cpOffset},${y1} ${x1},${y1}`;
  }
  return `M${x1},${y1} C${x1 + cpOffset},${y1} ${x2 - cpOffset},${y2} ${x2},${y2}`;
}

/** Compute a view transform that fits the graph into the container. */
export function computeFitTransform(
  graphW: number, graphH: number, containerW: number, containerH: number,
): ViewTransform {
  if (graphW <= 0 || graphH <= 0) return { x: 0, y: 0, scale: 1 };
  const s = Math.min(containerW / graphW, containerH / graphH, 1.5);
  return { x: (containerW - graphW * s) / 2, y: (containerH - graphH * s) / 2, scale: s };
}
