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
  /**
   * Txids that ADD_NODES made extra roots (a connection path with no tx in the
   * graph). Unlike the roots the graph was built from, these can be removed and
   * Reset drops them. Kept after a removal so UNDO can restore one as a root.
   */
  addedRoots: Set<string>;
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
  /** A batch as one undo step; `root` (if set) joins rootTxids as an extra root. */
  | { type: "ADD_NODES"; nodes: GraphNode[]; root?: string }
  | { type: "REMOVE_NODE"; txid: string }
  /** Several removals as one undo step; roots are never removed. */
  | { type: "REMOVE_NODES"; txids: string[] }
  | { type: "SET_LOADING"; txid: string; loading: boolean }
  | { type: "SET_ERROR"; txid: string; error: string }
  | { type: "CLEAR_ERROR"; txid: string }
  | { type: "RESET" }
  | { type: "UNDO" };

export interface GraphExpansionFetcher {
  getTransaction(txid: string, signal?: AbortSignal): Promise<MempoolTransaction>;
  getTxOutspends(txid: string, signal?: AbortSignal): Promise<MempoolOutspend[]>;
  /** Optional: used as fallback when outspends endpoint is unavailable. */
  getAddressTxs?(address: string, maxPages?: number): Promise<MempoolTransaction[]>;
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
  return { nodes, rootTxid, rootTxids, addedRoots: new Set(), maxNodes, undoStack: [], loading: new Set(), errors: new Map() };
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

    case "ADD_NODES": {
      // Nodes come in dependency order: one whose edge target is missing (cut by maxNodes) is skipped
      const nodes = new Map(state.nodes);
      for (const node of action.nodes) {
        if (nodes.size >= state.maxNodes) break;
        if (nodes.has(node.txid)) continue;
        if (node.parentEdge && !nodes.has(node.parentEdge.fromTxid)) continue;
        if (node.childEdge && !nodes.has(node.childEdge.toTxid)) continue;
        nodes.set(node.txid, node);
      }
      if (nodes.size === state.nodes.size) return state;
      const added = action.root && nodes.has(action.root) && !state.rootTxids.has(action.root) ? action.root : null;
      if (!added) return { ...state, nodes, undoStack: pushUndo(state) };
      return {
        ...state, nodes, undoStack: pushUndo(state),
        rootTxids: new Set(state.rootTxids).add(added),
        addedRoots: new Set(state.addedRoots).add(added),
      };
    }

    case "REMOVE_NODE":
    case "REMOVE_NODES": {
      const txids = action.type === "REMOVE_NODE" ? [action.txid] : action.txids;
      const nodes = new Map(state.nodes);
      // The roots the graph was built from stay; an added root goes like any node
      for (const txid of txids) {
        if (!state.rootTxids.has(txid) || state.addedRoots.has(txid)) nodes.delete(txid);
      }
      if (nodes.size === state.nodes.size) return state;
      const rootTxids = new Set([...state.rootTxids].filter((t) => nodes.has(t)));
      cascadeRemoveUnreachable(nodes, rootTxids);
      return { ...state, nodes, rootTxids: rootTxids.size === state.rootTxids.size ? state.rootTxids : rootTxids, undoStack: pushUndo(state) };
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
      const rootTxids = new Set([...state.rootTxids].filter((t) => !state.addedRoots.has(t)));
      for (const rtxid of rootTxids) {
        const root = state.nodes.get(rtxid);
        if (root) nodes.set(rtxid, root);
      }
      if (nodes.size === 0) return state;
      return { ...state, nodes, rootTxids, addedRoots: new Set(), undoStack: [], loading: new Set(), errors: new Map() };
    }

    case "UNDO": {
      const nodes = state.undoStack.at(-1);
      if (!nodes) return state;
      // An extra root added by the undone step (ADD_NODES) leaves with its node;
      // one the undone step removed comes back as a root
      const roots = [...state.rootTxids].filter((t) => nodes.has(t));
      for (const t of state.addedRoots) if (nodes.has(t) && !state.rootTxids.has(t)) roots.push(t);
      const rootTxids = roots.length === state.rootTxids.size && roots.every((t) => state.rootTxids.has(t))
        ? state.rootTxids
        : new Set(roots);
      return { ...state, nodes, rootTxids, undoStack: state.undoStack.slice(0, -1) };
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
    addedRoots: new Set(),
    maxNodes,
    undoStack: [],
    loading: new Set(),
    errors: new Map(),
  };
}
