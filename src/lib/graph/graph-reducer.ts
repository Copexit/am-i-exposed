/**
 * Graph state reducer and types for the interactive transaction graph.
 *
 * Pure data logic with no React dependency - extracted from useGraphExpansion.
 */

import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import { addLayersToNodes, cascadeRemoveUnreachable } from "./graph-helpers";

// ---- Types -----------------------------------------------------------------

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

/** Max number of undo snapshots to keep. */
const MAX_UNDO = 50;

export interface GraphState {
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  /** All root txids (multi-root mode). Single-root mode has one entry. */
  rootTxids: Set<string>;
  /** Maximum nodes allowed in the graph. */
  maxNodes: number;
  /** Stack of previous node snapshots for undo (most recent last). */
  undoStack: Map<string, GraphNode>[];
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
  | { type: "LOAD_GRAPH"; nodes: Map<string, GraphNode>; rootTxid: string; rootTxids: Set<string> }
  | { type: "ADD_NODE"; node: GraphNode }
  | { type: "REMOVE_NODE"; txid: string }
  | { type: "SET_LOADING"; txid: string; loading: boolean }
  | { type: "SET_ERROR"; txid: string; error: string }
  | { type: "CLEAR_ERROR"; txid: string }
  | { type: "RESET" }
  | { type: "UNDO" };

export interface GraphExpansionFetcher {
  getTransaction(txid: string): Promise<MempoolTransaction>;
  getTxOutspends(txid: string): Promise<MempoolOutspend[]>;
  /** Optional: used as fallback when outspends endpoint is unavailable. */
  getAddressTxs?(address: string): Promise<MempoolTransaction[]>;
}

// ---- Constants -------------------------------------------------------------

export const DEFAULT_MAX_NODES = 200;

// ---- Helpers ---------------------------------------------------------------

/** Create a fresh GraphState with an empty undo/loading/error set. */
function freshState(
  nodes: Map<string, GraphNode>,
  rootTxid: string,
  rootTxids: Set<string>,
  maxNodes: number,
): GraphState {
  return { nodes, rootTxid, rootTxids, maxNodes, undoStack: [], loading: new Set(), errors: new Map() };
}

/** Push current nodes onto the undo stack, capping at MAX_UNDO. */
function pushUndo(state: GraphState): Map<string, GraphNode>[] {
  const stack = [...state.undoStack, new Map(state.nodes)];
  if (stack.length > MAX_UNDO) stack.shift();
  return stack;
}

// ---- Reducer ---------------------------------------------------------------

export function graphReducer(state: GraphState, action: GraphAction): GraphState {
  switch (action.type) {
    case "SET_ROOT": {
      const nodes = new Map<string, GraphNode>();
      nodes.set(action.tx.txid, { txid: action.tx.txid, tx: action.tx, depth: 0 });
      return freshState(nodes, action.tx.txid, new Set([action.tx.txid]), state.maxNodes);
    }

    case "SET_ROOT_WITH_NEIGHBORS": {
      const rootTxid = action.root.txid;
      const nodes = new Map<string, GraphNode>();
      nodes.set(rootTxid, { txid: rootTxid, tx: action.root, depth: 0 });

      for (const [txid, ptx] of action.parents) {
        if (nodes.size >= state.maxNodes) break;
        if (nodes.has(txid)) continue;
        const inputIdx = action.root.vin.findIndex((v) => v.txid === txid);
        if (inputIdx === -1) continue;
        nodes.set(txid, { txid, tx: ptx, depth: -1, childEdge: { toTxid: rootTxid, inputIndex: inputIdx } });
      }

      for (const [outputIdx, ctx] of action.children) {
        if (nodes.size >= state.maxNodes) break;
        if (nodes.has(ctx.txid)) continue;
        nodes.set(ctx.txid, { txid: ctx.txid, tx: ctx, depth: 1, parentEdge: { fromTxid: rootTxid, outputIndex: outputIdx } });
      }

      return freshState(nodes, rootTxid, new Set([rootTxid]), state.maxNodes);
    }

    case "SET_ROOT_WITH_LAYERS": {
      const rootTxid = action.root.txid;
      const nodes = new Map<string, GraphNode>();
      nodes.set(rootTxid, { txid: rootTxid, tx: action.root, depth: 0 });
      addLayersToNodes(nodes, rootTxid, action.root, 0, state.maxNodes, action.backwardLayers, action.forwardLayers, action.outspends, action.smartFilter ?? true);
      return freshState(nodes, rootTxid, new Set([rootTxid]), state.maxNodes);
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
      return freshState(nodes, firstTxid, rootTxids, state.maxNodes);
    }

    case "SET_MULTI_ROOT_WITH_LAYERS": {
      const nodes = new Map<string, GraphNode>();
      const rootTxids = new Set<string>();
      let firstTxid = "";
      const budget = action.preExpandBudget ?? state.maxNodes;

      for (const [txid, entry] of action.roots) {
        if (nodes.size >= state.maxNodes) break;
        if (nodes.has(txid)) continue;
        if (!firstTxid) firstTxid = txid;
        rootTxids.add(txid);
        nodes.set(txid, { txid, tx: entry.tx, depth: 0 });
      }

      for (const [txid, entry] of action.roots) {
        if (nodes.size >= budget) break;
        const hasLayers = (entry.backward && entry.backward.length > 0) ||
                          (entry.forward && entry.forward.length > 0);
        if (!hasLayers) continue;
        addLayersToNodes(nodes, txid, entry.tx, 0, budget, entry.backward, entry.forward, entry.outspends);
      }

      return freshState(nodes, firstTxid, rootTxids, state.maxNodes);
    }

    case "LOAD_GRAPH":
      return freshState(action.nodes, action.rootTxid, action.rootTxids, state.maxNodes);

    case "ADD_NODE": {
      if (state.nodes.size >= state.maxNodes) return state;
      if (state.nodes.has(action.node.txid)) return state;
      // Reject orphans: the node it attaches to may be gone (collapse/undo/new root)
      const { parentEdge, childEdge } = action.node;
      if (parentEdge && !state.nodes.has(parentEdge.fromTxid)) return state;
      if (childEdge && !state.nodes.has(childEdge.toTxid)) return state;
      const nodes = new Map(state.nodes);
      nodes.set(action.node.txid, action.node);
      return { ...state, nodes, undoStack: pushUndo(state) };
    }

    case "REMOVE_NODE": {
      if (state.rootTxids.has(action.txid)) return state;
      if (!state.nodes.has(action.txid)) return state;
      const nodes = new Map(state.nodes);
      nodes.delete(action.txid);
      cascadeRemoveUnreachable(nodes, state.rootTxids);
      return { ...state, nodes, undoStack: pushUndo(state) };
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
      return { ...state, nodes, undoStack: [], loading: new Set(), errors: new Map() };
    }

    case "UNDO": {
      const nodes = state.undoStack.at(-1);
      if (!nodes) return state;
      return { ...state, nodes, undoStack: state.undoStack.slice(0, -1) };
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
    undoStack: [],
    loading: new Set(),
    errors: new Map(),
  };
}
