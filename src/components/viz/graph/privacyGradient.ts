/**
 * Entropy propagation across the transaction graph ("privacy gradient").
 *
 * Computes "effective entropy" for each edge in the graph. This is the minimum
 * entropy encountered along the path from the root to this edge. A Whirlpool
 * output (10 bits entropy) that flows through a deterministic sweep (0 bits)
 * loses all privacy - the effective entropy bottlenecks at 0.
 *
 * This is the single most analytically significant feature for privacy analysis.
 * No existing tool computes or visualizes this.
 */

import type { GraphNode } from "@/hooks/useGraphExpansion";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

/** Effective entropy per edge: the minimum entropy along the path from root. */
export interface EdgeEntropy {
  /** Effective (bottleneck) entropy in bits. */
  effectiveEntropy: number;
  /** The tx's own entropy in bits. */
  localEntropy: number;
  /** Normalized effective entropy (0-1) for coloring. */
  normalized: number;
}

/**
 * Compute effective entropy for all edges in the graph.
 *
 * Algorithm:
 * 1. Start from root tx (depth=0). Its effective entropy = its own Boltzmann entropy.
 * 2. For each node reachable forward (depth > 0): effective entropy = min(parent edge effective entropy, this tx's entropy).
 * 3. For backward nodes (depth < 0): effective entropy = min(child edge effective entropy, this tx's entropy).
 *
 * Returns a map from edge key "e-{fromTxid}-{toTxid}" to EdgeEntropy.
 */
export function computeEntropyPropagation(
  nodes: Map<string, GraphNode>,
  rootTxid: string,
  boltzmannCache: Map<string, BoltzmannWorkerResult>,
): Map<string, EdgeEntropy> {
  const result = new Map<string, EdgeEntropy>();
  if (boltzmannCache.size === 0) return result;

  // Node effective entropy: tracks the best (highest) effective entropy reaching each node
  const nodeEffective = new Map<string, number>();

  // Get local entropy for a node
  const getLocalEntropy = (txid: string): number => {
    const boltz = boltzmannCache.get(txid);
    if (!boltz) return 0; // unknown = worst case
    return boltz.entropy;
  };

  // Initialize root
  nodeEffective.set(rootTxid, getLocalEntropy(rootTxid));

  // Process forward nodes (depth > 0) in depth order
  const nodesByDepth = new Map<number, GraphNode[]>();
  for (const [, node] of nodes) {
    const list = nodesByDepth.get(node.depth) ?? [];
    list.push(node);
    nodesByDepth.set(node.depth, list);
  }
  const depths = [...nodesByDepth.keys()].sort((a, b) => a - b);

  // Forward propagation
  for (const depth of depths) {
    if (depth <= 0) continue;
    const group = nodesByDepth.get(depth)!;
    for (const node of group) {
      if (!node.parentEdge) continue;
      const parentEffective = nodeEffective.get(node.parentEdge.fromTxid);
      if (parentEffective === undefined) continue;

      const localE = getLocalEntropy(node.txid);
      const effective = Math.min(parentEffective, localE);
      nodeEffective.set(node.txid, effective);

      const edgeKey = `e-${node.parentEdge.fromTxid}-${node.txid}`;
      result.set(edgeKey, {
        effectiveEntropy: effective,
        localEntropy: localE,
        normalized: 0, // filled below
      });
    }
  }

  // Backward propagation (depth < 0)
  for (const depth of [...depths].reverse()) {
    if (depth >= 0) continue;
    const group = nodesByDepth.get(depth)!;
    for (const node of group) {
      if (!node.childEdge) continue;
      const childEffective = nodeEffective.get(node.childEdge.toTxid);
      if (childEffective === undefined) continue;

      const localE = getLocalEntropy(node.txid);
      const effective = Math.min(childEffective, localE);
      nodeEffective.set(node.txid, effective);

      const edgeKey = `e-${node.txid}-${node.childEdge.toTxid}`;
      result.set(edgeKey, {
        effectiveEntropy: effective,
        localEntropy: localE,
        normalized: 0,
      });
    }
  }

  // Normalize: find max entropy in the graph for 0-1 scaling
  let maxEntropy = 0;
  for (const [, entry] of result) {
    if (entry.effectiveEntropy > maxEntropy) maxEntropy = entry.effectiveEntropy;
  }

  if (maxEntropy > 0) {
    for (const [, entry] of result) {
      entry.normalized = entry.effectiveEntropy / maxEntropy;
    }
  }

  return result;
}

/** Get a color for an effective entropy value (green = high privacy, red = collapsed). */
export function entropyColor(normalized: number): string {
  // Green (high entropy/privacy) to red (zero entropy/collapsed)
  if (normalized >= 0.8) return "#28d065";
  if (normalized >= 0.6) return "#60a5fa";
  if (normalized >= 0.4) return "#eab308";
  if (normalized >= 0.2) return "#f97316";
  return "#ef4444";
}
