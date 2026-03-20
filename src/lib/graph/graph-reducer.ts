/**
 * Graph state reducer and types for the interactive transaction graph.
 *
 * Pure data logic with no React dependency - extracted from useGraphExpansion.
 */

import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import { scoreNode, RELEVANCE_THRESHOLD } from "@/lib/graph/nodeRelevance";
import { identifyChangeOutput } from "@/lib/graph/autoTrace";

// ─── Types ─────────────────────────────────────────────────────────────

export interface GraphNode {
  txid: string;
  tx: MempoolTransaction;
  depth: number; // negative = backward, 0 = root, positive = forward
  parentEdge?: { fromTxid: string; outputIndex: number };
  childEdge?: { toTxid: string; inputIndex: number };
  /** Relevance score (0-100) from smart auto-population. Undefined for manually expanded nodes. */
  relevanceScore?: number;
  /** Why this node was auto-shown (for debugging/tooltips). */
  relevanceReasons?: string[];
}

/** Data for a multi-root entry (UTXO root + optional trace layers). */
export interface MultiRootEntry {
  tx: MempoolTransaction;
  backward?: TraceLayer[];
  forward?: TraceLayer[];
  outspends?: MempoolOutspend[];
}

export interface GraphState {
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  /** All root txids (multi-root mode). Single-root mode has one entry. */
  rootTxids: Set<string>;
  /** Maximum nodes allowed in the graph. */
  maxNodes: number;
  /** Loading state per txid */
  loading: Set<string>;
  /** Error messages per txid */
  errors: Map<string, string>;
}

export type GraphAction =
  | { type: "SET_ROOT"; tx: MempoolTransaction }
  | { type: "SET_ROOT_WITH_NEIGHBORS"; root: MempoolTransaction; parents: Map<string, MempoolTransaction>; children: Map<number, MempoolTransaction> }
  | { type: "SET_ROOT_WITH_LAYERS"; root: MempoolTransaction; backwardLayers: TraceLayer[]; forwardLayers: TraceLayer[]; outspends?: MempoolOutspend[]; smartFilter?: boolean }
  | { type: "SET_MULTI_ROOT"; txs: Map<string, MempoolTransaction> }
  | { type: "SET_MULTI_ROOT_WITH_LAYERS"; roots: Map<string, MultiRootEntry>; preExpandBudget?: number }
  | { type: "ADD_NODE"; node: GraphNode }
  | { type: "REMOVE_NODE"; txid: string }
  | { type: "SET_LOADING"; txid: string; loading: boolean }
  | { type: "SET_ERROR"; txid: string; error: string }
  | { type: "CLEAR_ERROR"; txid: string }
  | { type: "RESET" };

export interface GraphExpansionFetcher {
  getTransaction(txid: string): Promise<MempoolTransaction>;
  getTxOutspends(txid: string): Promise<MempoolOutspend[]>;
  /** Optional: used as fallback when outspends endpoint is unavailable. */
  getAddressTxs?(address: string): Promise<MempoolTransaction[]>;
}

// ─── Constants ─────────────────────────────────────────────────────────

export const DEFAULT_MAX_NODES = 100;

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Add backward and forward trace layers to an existing node map,
 * relative to a root transaction at baseDepth.
 */
function addLayersToNodes(
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
  // Compute root's change output index for forward relevance scoring
  const rootChangeIdx = smartFilter ? (identifyChangeOutput(rootTx).changeOutputIndex) : null;

  // Build backward hops from trace layers
  if (backward) {
    for (let layerIdx = 0; layerIdx < Math.min(backward.length, 2); layerIdx++) {
      const hopDepth = baseDepth - (layerIdx + 1);
      const layer = backward[layerIdx];
      for (const [txid, ltx] of layer.txs) {
        if (nodes.size >= maxNodes) return;
        if (nodes.has(txid)) continue;
        const childDepth = hopDepth + 1;
        let childEdge: GraphNode["childEdge"] | undefined;
        for (const [existingTxid, existingNode] of nodes) {
          if (existingNode.depth !== childDepth) continue;
          const inputIdx = existingNode.tx.vin.findIndex((v) => v.txid === txid);
          if (inputIdx >= 0) {
            childEdge = { toTxid: existingTxid, inputIndex: inputIdx };
            break;
          }
        }
        if (!childEdge && layerIdx > 0) continue;
        if (!childEdge) {
          const inputIdx = rootTx.vin.findIndex((v) => v.txid === txid);
          if (inputIdx === -1) continue;
          childEdge = { toTxid: rootTxid, inputIndex: inputIdx };
        }
        // Smart filter: skip low-relevance nodes
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

  // Build forward hops from trace layers
  if (forward) {
    for (let layerIdx = 0; layerIdx < Math.min(forward.length, 2); layerIdx++) {
      const hopDepth = baseDepth + (layerIdx + 1);
      const layer = forward[layerIdx];
      for (const [txid, ltx] of layer.txs) {
        if (nodes.size >= maxNodes) return;
        if (nodes.has(txid)) continue;
        const parentDepth = hopDepth - 1;
        let parentEdge: GraphNode["parentEdge"] | undefined;
        for (const [existingTxid, existingNode] of nodes) {
          if (existingNode.depth !== parentDepth) continue;
          for (let vi = 0; vi < ltx.vin.length; vi++) {
            if (ltx.vin[vi].txid === existingTxid) {
              const outputIdx = ltx.vin[vi].vout ?? 0;
              parentEdge = { fromTxid: existingTxid, outputIndex: outputIdx };
              break;
            }
          }
          if (parentEdge) break;
        }
        if (!parentEdge && layerIdx > 0) continue;
        if (!parentEdge && outspends) {
          for (let oi = 0; oi < outspends.length; oi++) {
            const os = outspends[oi];
            if (os?.spent && os.txid === txid) {
              parentEdge = { fromTxid: rootTxid, outputIndex: oi };
              break;
            }
          }
        }
        if (!parentEdge) continue;
        // Smart filter: skip low-relevance nodes
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
}

// ─── Reducer ───────────────────────────────────────────────────────────

export function graphReducer(state: GraphState, action: GraphAction): GraphState {
  switch (action.type) {
    case "SET_ROOT": {
      const nodes = new Map<string, GraphNode>();
      nodes.set(action.tx.txid, {
        txid: action.tx.txid,
        tx: action.tx,
        depth: 0,
      });
      return {
        nodes,
        rootTxid: action.tx.txid,
        rootTxids: new Set([action.tx.txid]),
        maxNodes: state.maxNodes,
        loading: new Set(),
        errors: new Map(),
      };
    }

    case "SET_ROOT_WITH_NEIGHBORS": {
      const rootTxid = action.root.txid;
      const nodes = new Map<string, GraphNode>();
      nodes.set(rootTxid, { txid: rootTxid, tx: action.root, depth: 0 });

      // Add parent txs (depth -1)
      for (const [txid, ptx] of action.parents) {
        if (nodes.size >= state.maxNodes) break;
        if (nodes.has(txid)) continue;
        const inputIdx = action.root.vin.findIndex((v) => v.txid === txid);
        if (inputIdx === -1) continue;
        nodes.set(txid, {
          txid,
          tx: ptx,
          depth: -1,
          childEdge: { toTxid: rootTxid, inputIndex: inputIdx },
        });
      }

      // Add child txs (depth +1)
      for (const [outputIdx, ctx] of action.children) {
        if (nodes.size >= state.maxNodes) break;
        if (nodes.has(ctx.txid)) continue;
        nodes.set(ctx.txid, {
          txid: ctx.txid,
          tx: ctx,
          depth: 1,
          parentEdge: { fromTxid: rootTxid, outputIndex: outputIdx },
        });
      }

      return { nodes, rootTxid, rootTxids: new Set([rootTxid]), maxNodes: state.maxNodes, loading: new Set(), errors: new Map() };
    }

    case "SET_ROOT_WITH_LAYERS": {
      const rootTxid = action.root.txid;
      const nodes = new Map<string, GraphNode>();
      nodes.set(rootTxid, { txid: rootTxid, tx: action.root, depth: 0 });

      addLayersToNodes(nodes, rootTxid, action.root, 0, state.maxNodes, action.backwardLayers, action.forwardLayers, action.outspends, action.smartFilter ?? true);

      return { nodes, rootTxid, rootTxids: new Set([rootTxid]), maxNodes: state.maxNodes, loading: new Set(), errors: new Map() };
    }

    case "SET_MULTI_ROOT": {
      const nodes = new Map<string, GraphNode>();
      const rootTxids = new Set<string>();
      let firstTxid = "";

      for (const [txid, tx] of action.txs) {
        if (nodes.size >= state.maxNodes) break;
        if (nodes.has(txid)) continue;
        if (!firstTxid) firstTxid = txid;
        rootTxids.add(txid);
        nodes.set(txid, { txid, tx, depth: 0 });
      }

      return { nodes, rootTxid: firstTxid, rootTxids, maxNodes: state.maxNodes, loading: new Set(), errors: new Map() };
    }

    case "SET_MULTI_ROOT_WITH_LAYERS": {
      const nodes = new Map<string, GraphNode>();
      const rootTxids = new Set<string>();
      let firstTxid = "";
      const budget = action.preExpandBudget ?? state.maxNodes;

      // Place all roots at depth 0 first (guaranteed slots)
      for (const [txid, entry] of action.roots) {
        if (nodes.size >= state.maxNodes) break;
        if (nodes.has(txid)) continue;
        if (!firstTxid) firstTxid = txid;
        rootTxids.add(txid);
        nodes.set(txid, { txid, tx: entry.tx, depth: 0 });
      }

      // Expand trace layers for each root, capped at pre-expand budget
      for (const [txid, entry] of action.roots) {
        if (nodes.size >= budget) break;
        const hasLayers = (entry.backward && entry.backward.length > 0) ||
                          (entry.forward && entry.forward.length > 0);
        if (!hasLayers) continue;
        addLayersToNodes(nodes, txid, entry.tx, 0, budget, entry.backward, entry.forward, entry.outspends);
      }

      return { nodes, rootTxid: firstTxid, rootTxids, maxNodes: state.maxNodes, loading: new Set(), errors: new Map() };
    }

    case "ADD_NODE": {
      if (state.nodes.size >= state.maxNodes) return state;
      if (state.nodes.has(action.node.txid)) return state;
      const nodes = new Map(state.nodes);
      nodes.set(action.node.txid, action.node);
      return { ...state, nodes };
    }

    case "REMOVE_NODE": {
      if (state.rootTxids.has(action.txid)) return state;
      if (!state.nodes.has(action.txid)) return state;
      const nodes = new Map(state.nodes);
      nodes.delete(action.txid);
      // Cascade: remove all nodes that become disconnected from roots.
      // Build adjacency index (O(n)), then BFS from roots (O(n)).
      // Each non-root node has exactly one edge toward root:
      //   - backward nodes: childEdge.toTxid (points closer to root)
      //   - forward nodes: parentEdge.fromTxid (points closer to root)
      // Build a reverse adjacency: for each node X, which nodes point to X?
      const neighbors = new Map<string, string[]>();
      for (const [nid, n] of nodes) {
        // Forward children: n.parentEdge.fromTxid -> n
        if (n.parentEdge) {
          const from = n.parentEdge.fromTxid;
          const arr = neighbors.get(from);
          if (arr) arr.push(nid);
          else neighbors.set(from, [nid]);
        }
        // Backward parents: n.childEdge.toTxid -> n
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
      for (const rtxid of state.rootTxids) {
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
      return { ...state, nodes };
    }

    case "SET_LOADING": {
      const loading = new Set(state.loading);
      if (action.loading) loading.add(action.txid);
      else loading.delete(action.txid);
      return { ...state, loading };
    }

    case "SET_ERROR": {
      const errors = new Map(state.errors);
      errors.set(action.txid, action.error);
      return { ...state, errors };
    }

    case "CLEAR_ERROR": {
      const errors = new Map(state.errors);
      errors.delete(action.txid);
      return { ...state, errors };
    }

    case "RESET": {
      const nodes = new Map<string, GraphNode>();
      for (const rtxid of state.rootTxids) {
        const root = state.nodes.get(rtxid);
        if (root) nodes.set(rtxid, root);
      }
      if (nodes.size === 0) return state;
      return {
        ...state,
        nodes,
        loading: new Set(),
        errors: new Map(),
      };
    }

    default:
      return state;
  }
}

export function makeInitialState(maxNodes: number): GraphState {
  return {
    nodes: new Map(),
    rootTxid: "",
    rootTxids: new Set(),
    maxNodes,
    loading: new Set(),
    errors: new Map(),
  };
}
