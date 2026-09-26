/**
 * Pure helper functions for graph node/edge manipulation.
 *
 * Extracted from graph-reducer.ts for independent testability and
 * to keep the reducer file focused on state transitions.
 */

import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import { scoreNode, RELEVANCE_THRESHOLD } from "@/lib/graph/nodeRelevance";
import { identifyChangeOutput } from "@/lib/graph/autoTrace";
import type { GraphNode } from "./graph-reducer";

// ---- Layer expansion -------------------------------------------------------

/**
 * Add backward and forward trace layers to an existing node map,
 * relative to a root transaction at baseDepth.
 */
export function addLayersToNodes(
  nodes: Map<string, GraphNode>,
  rootTxid: string,
  rootTx: MempoolTransaction,
  baseDepth: number,
  maxNodes: number,
  backward?: TraceLayer[],
  forward?: TraceLayer[],
  outspends?: MempoolOutspend[],
  smartFilter = true,
): void {
  const rootChangeIdx = smartFilter ? (identifyChangeOutput(rootTx).changeOutputIndex) : null;

  if (backward) {
    addBackwardLayers(nodes, rootTxid, rootTx, baseDepth, maxNodes, backward, rootChangeIdx, smartFilter);
  }
  if (forward) {
    addForwardLayers(nodes, rootTxid, rootTx, baseDepth, maxNodes, forward, outspends, rootChangeIdx, smartFilter);
  }
}

function addBackwardLayers(
  nodes: Map<string, GraphNode>,
  rootTxid: string,
  rootTx: MempoolTransaction,
  baseDepth: number,
  maxNodes: number,
  backward: TraceLayer[],
  rootChangeIdx: number | null,
  smartFilter: boolean,
): void {
  for (const [layerIdx, layer] of backward.slice(0, 2).entries()) {
    const hopDepth = baseDepth - (layerIdx + 1);
    for (const [txid, ltx] of layer.txs) {
      if (nodes.size >= maxNodes) return;
      if (nodes.has(txid)) continue;

      const childEdge = findChildEdge(nodes, txid, hopDepth + 1, rootTxid, rootTx, layerIdx);
      if (!childEdge) continue;

      if (smartFilter) {
        const ns = scoreNode(ltx, rootTx, "backward", layerIdx + 1, rootChangeIdx);
        if (ns.score < RELEVANCE_THRESHOLD) continue;
        nodes.set(txid, { txid, tx: ltx, depth: hopDepth, childEdge, relevanceScore: ns.score, relevanceReasons: ns.reasons });
      } else {
        nodes.set(txid, { txid, tx: ltx, depth: hopDepth, childEdge });
      }
    }
  }
}

function addForwardLayers(
  nodes: Map<string, GraphNode>,
  rootTxid: string,
  rootTx: MempoolTransaction,
  baseDepth: number,
  maxNodes: number,
  forward: TraceLayer[],
  outspends: MempoolOutspend[] | undefined,
  rootChangeIdx: number | null,
  smartFilter: boolean,
): void {
  for (const [layerIdx, layer] of forward.slice(0, 2).entries()) {
    const hopDepth = baseDepth + (layerIdx + 1);
    for (const [txid, ltx] of layer.txs) {
      if (nodes.size >= maxNodes) return;
      if (nodes.has(txid)) continue;

      const parentEdge = findParentEdge(nodes, txid, ltx, hopDepth - 1, rootTxid, outspends, layerIdx);
      if (!parentEdge) continue;

      if (smartFilter) {
        const ns = scoreNode(ltx, rootTx, "forward", layerIdx + 1, rootChangeIdx, parentEdge.outputIndex);
        if (ns.score < RELEVANCE_THRESHOLD) continue;
        nodes.set(txid, { txid, tx: ltx, depth: hopDepth, parentEdge, relevanceScore: ns.score, relevanceReasons: ns.reasons });
      } else {
        nodes.set(txid, { txid, tx: ltx, depth: hopDepth, parentEdge });
      }
    }
  }
}

/**
 * Find the child edge connecting a backward-layer tx to an existing node.
 * Returns undefined if no valid connection is found.
 */
function findChildEdge(
  nodes: Map<string, GraphNode>,
  txid: string,
  childDepth: number,
  rootTxid: string,
  rootTx: MempoolTransaction,
  layerIdx: number,
): GraphNode["childEdge"] | undefined {
  for (const [existingTxid, existingNode] of nodes) {
    if (existingNode.depth !== childDepth) continue;
    const inputIdx = existingNode.tx.vin.findIndex((v) => v.txid === txid);
    if (inputIdx >= 0) {
      return { toTxid: existingTxid, inputIndex: inputIdx };
    }
  }
  // For layer > 0, we require an existing edge
  if (layerIdx > 0) return undefined;
  // Layer 0 falls back to root tx
  const inputIdx = rootTx.vin.findIndex((v) => v.txid === txid);
  if (inputIdx === -1) return undefined;
  return { toTxid: rootTxid, inputIndex: inputIdx };
}

/**
 * Find the parent edge connecting a forward-layer tx to an existing node.
 * Returns undefined if no valid connection is found.
 */
function findParentEdge(
  nodes: Map<string, GraphNode>,
  txid: string,
  ltx: MempoolTransaction,
  parentDepth: number,
  rootTxid: string,
  outspends: MempoolOutspend[] | undefined,
  layerIdx: number,
): GraphNode["parentEdge"] | undefined {
  for (const [existingTxid, existingNode] of nodes) {
    if (existingNode.depth !== parentDepth) continue;
    for (const vin of ltx.vin) {
      if (vin.txid === existingTxid) {
        const outputIdx = vin.vout ?? 0;
        return { fromTxid: existingTxid, outputIndex: outputIdx };
      }
    }
  }
  if (layerIdx > 0) return undefined;
  if (outspends) {
    for (let oi = 0; oi < outspends.length; oi++) {
      const os = outspends[oi];
      if (os?.spent && os.txid === txid) {
        return { fromTxid: rootTxid, outputIndex: oi };
      }
    }
  }
  return undefined;
}

// ---- Cascade removal -------------------------------------------------------

/**
 * Remove unreachable nodes after deleting a node from the graph.
 * Uses BFS from root nodes to find all reachable nodes, then prunes the rest.
 */
export function cascadeRemoveUnreachable(
  nodes: Map<string, GraphNode>,
  rootTxids: Set<string>,
): void {
  // Build adjacency index (O(n)), then BFS from roots (O(n)).
  const neighbors = new Map<string, string[]>();
  for (const [nid, n] of nodes) {
    if (n.parentEdge) {
      const from = n.parentEdge.fromTxid;
      const arr = neighbors.get(from);
      if (arr) arr.push(nid);
      else neighbors.set(from, [nid]);
    }
    if (n.childEdge) {
      const to = n.childEdge.toTxid;
      const arr = neighbors.get(to);
      if (arr) arr.push(nid);
      else neighbors.set(to, [nid]);
    }
  }

  // BFS from roots to find all reachable nodes
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const rtxid of rootTxids) {
    if (nodes.has(rtxid)) {
      reachable.add(rtxid);
      queue.push(rtxid);
    }
  }
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const adj = neighbors.get(cur);
    if (!adj) continue;
    for (const nid of adj) {
      if (reachable.has(nid)) continue;
      reachable.add(nid);
      queue.push(nid);
    }
  }

  // Remove unreachable nodes
  for (const nid of [...nodes.keys()]) {
    if (!reachable.has(nid)) nodes.delete(nid);
  }
}
