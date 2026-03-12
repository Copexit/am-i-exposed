"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";

/**
 * Interactive graph expansion hook (OXT-style click-to-expand).
 *
 * Manages state for an expandable transaction graph where users can
 * click inputs to expand leftward (parent txs) or outputs to expand
 * rightward (child txs).
 */

export interface GraphNode {
  txid: string;
  tx: MempoolTransaction;
  depth: number; // negative = backward, 0 = root, positive = forward
  parentEdge?: { fromTxid: string; outputIndex: number };
  childEdge?: { toTxid: string; inputIndex: number };
}

/** Max number of undo snapshots to keep. */
const MAX_UNDO = 50;

interface GraphState {
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

/** Data for a multi-root entry (UTXO root + optional trace layers). */
export interface MultiRootEntry {
  tx: MempoolTransaction;
  backward?: TraceLayer[];
  forward?: TraceLayer[];
  outspends?: MempoolOutspend[];
}

type GraphAction =
  | { type: "SET_ROOT"; tx: MempoolTransaction }
  | { type: "SET_ROOT_WITH_NEIGHBORS"; root: MempoolTransaction; parents: Map<string, MempoolTransaction>; children: Map<number, MempoolTransaction> }
  | { type: "SET_ROOT_WITH_LAYERS"; root: MempoolTransaction; backwardLayers: TraceLayer[]; forwardLayers: TraceLayer[]; outspends?: MempoolOutspend[] }
  | { type: "SET_MULTI_ROOT"; txs: Map<string, MempoolTransaction> }
  | { type: "SET_MULTI_ROOT_WITH_LAYERS"; roots: Map<string, MultiRootEntry>; preExpandBudget?: number }
  | { type: "ADD_NODE"; node: GraphNode }
  | { type: "REMOVE_NODE"; txid: string }
  | { type: "SET_LOADING"; txid: string; loading: boolean }
  | { type: "SET_ERROR"; txid: string; error: string }
  | { type: "CLEAR_ERROR"; txid: string }
  | { type: "RESET" }
  | { type: "UNDO" };

const DEFAULT_MAX_NODES = 100;

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
): void {
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
        nodes.set(txid, { txid, tx: ltx, depth: hopDepth, childEdge });
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
        nodes.set(txid, { txid, tx: ltx, depth: hopDepth, parentEdge });
      }
    }
  }
}

function graphReducer(state: GraphState, action: GraphAction): GraphState {
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
        undoStack: [],
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

      return { nodes, rootTxid, rootTxids: new Set([rootTxid]), maxNodes: state.maxNodes, undoStack: [], loading: new Set(), errors: new Map() };
    }

    case "SET_ROOT_WITH_LAYERS": {
      const rootTxid = action.root.txid;
      const nodes = new Map<string, GraphNode>();
      nodes.set(rootTxid, { txid: rootTxid, tx: action.root, depth: 0 });

      addLayersToNodes(nodes, rootTxid, action.root, 0, state.maxNodes, action.backwardLayers, action.forwardLayers, action.outspends);

      return { nodes, rootTxid, rootTxids: new Set([rootTxid]), maxNodes: state.maxNodes, undoStack: [], loading: new Set(), errors: new Map() };
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

      return { nodes, rootTxid: firstTxid, rootTxids, maxNodes: state.maxNodes, undoStack: [], loading: new Set(), errors: new Map() };
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

      return { nodes, rootTxid: firstTxid, rootTxids, maxNodes: state.maxNodes, undoStack: [], loading: new Set(), errors: new Map() };
    }

    case "ADD_NODE": {
      if (state.nodes.size >= state.maxNodes) return state;
      if (state.nodes.has(action.node.txid)) return state;
      const nodes = new Map(state.nodes);
      nodes.set(action.node.txid, action.node);
      const undoStack = [...state.undoStack, new Map(state.nodes)];
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      return { ...state, nodes, undoStack };
    }

    case "REMOVE_NODE": {
      if (state.rootTxids.has(action.txid)) return state;
      if (!state.nodes.has(action.txid)) return state;
      const nodes = new Map(state.nodes);
      nodes.delete(action.txid);
      const undoStack = [...state.undoStack, new Map(state.nodes)];
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      return { ...state, nodes, undoStack };
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
        undoStack: [],
        loading: new Set(),
        errors: new Map(),
      };
    }

    case "UNDO": {
      if (state.undoStack.length === 0) return state;
      const nodes = state.undoStack[state.undoStack.length - 1];
      return {
        ...state,
        nodes,
        undoStack: state.undoStack.slice(0, -1),
      };
    }

    default:
      return state;
  }
}

interface GraphExpansionFetcher {
  getTransaction(txid: string): Promise<MempoolTransaction>;
  getTxOutspends(txid: string): Promise<MempoolOutspend[]>;
}

function makeInitialState(maxNodes: number): GraphState {
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

export function useGraphExpansion(fetcher: GraphExpansionFetcher | null, maxNodes = DEFAULT_MAX_NODES) {
  const [state, dispatch] = useReducer(graphReducer, maxNodes, makeInitialState);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const setRoot = useCallback((tx: MempoolTransaction) => {
    dispatch({ type: "SET_ROOT", tx });
  }, []);

  /** Initialize graph with root + pre-fetched parent/child transactions. */
  const setRootWithNeighbors = useCallback((
    root: MempoolTransaction,
    parents: Map<string, MempoolTransaction>,
    children: Map<number, MempoolTransaction>,
  ) => {
    dispatch({ type: "SET_ROOT_WITH_NEIGHBORS", root, parents, children });
  }, []);

  /** Initialize graph with root + multi-hop trace layers (auto-expands up to 2 hops). */
  const setRootWithLayers = useCallback((
    root: MempoolTransaction,
    backwardLayers: TraceLayer[],
    forwardLayers: TraceLayer[],
    outspends?: MempoolOutspend[],
  ) => {
    dispatch({ type: "SET_ROOT_WITH_LAYERS", root, backwardLayers, forwardLayers, outspends });
  }, []);

  /** Initialize graph with multiple root transactions at depth 0. */
  const setMultiRoot = useCallback((txs: Map<string, MempoolTransaction>) => {
    dispatch({ type: "SET_MULTI_ROOT", txs });
  }, []);

  /** Initialize graph with multiple roots + trace layers for each. */
  const setMultiRootWithLayers = useCallback((roots: Map<string, MultiRootEntry>, preExpandBudget?: number) => {
    dispatch({ type: "SET_MULTI_ROOT_WITH_LAYERS", roots, preExpandBudget });
  }, []);

  /** Expand backward: fetch the parent tx that created the given input */
  const expandInput = useCallback(async (currentTxid: string, inputIndex: number) => {
    const client = fetcherRef.current;
    if (!client) return;

    const node = state.nodes.get(currentTxid);
    if (!node) return;

    const vin = node.tx.vin[inputIndex];
    if (!vin || vin.is_coinbase) return;

    const parentTxid = vin.txid;
    if (state.nodes.has(parentTxid)) return;
    if (state.nodes.size >= state.maxNodes) return;

    dispatch({ type: "SET_LOADING", txid: parentTxid, loading: true });

    try {
      const parentTx = await client.getTransaction(parentTxid);
      dispatch({
        type: "ADD_NODE",
        node: {
          txid: parentTxid,
          tx: parentTx,
          depth: node.depth - 1,
          childEdge: { toTxid: currentTxid, inputIndex },
        },
      });
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        txid: parentTxid,
        error: err instanceof Error ? err.message : "Failed to fetch",
      });
    } finally {
      dispatch({ type: "SET_LOADING", txid: parentTxid, loading: false });
    }
  }, [state.nodes]);

  /** Expand forward: fetch the child tx that spends the given output.
   *  Scans all outputs starting from the hint index to find an expandable one. */
  const expandOutput = useCallback(async (currentTxid: string, outputIndex: number) => {
    const client = fetcherRef.current;
    if (!client) return;

    const node = state.nodes.get(currentTxid);
    if (!node) return;
    if (state.nodes.size >= state.maxNodes) return;

    const loadKey = `${currentTxid}:out`;
    dispatch({ type: "SET_LOADING", txid: loadKey, loading: true });

    try {
      const outspends = await client.getTxOutspends(currentTxid);

      // Scan outputs starting from the hint, wrapping around to find an expandable one
      const total = outspends.length;
      for (let offset = 0; offset < total; offset++) {
        const oi = (outputIndex + offset) % total;
        const os = outspends[oi];
        if (!os?.spent || !os.txid) continue;
        if (state.nodes.has(os.txid)) continue;

        const childTx = await client.getTransaction(os.txid);
        dispatch({
          type: "ADD_NODE",
          node: {
            txid: os.txid,
            tx: childTx,
            depth: node.depth + 1,
            parentEdge: { fromTxid: currentTxid, outputIndex: oi },
          },
        });
        return;
      }

      // No expandable output found
      const allUnspent = outspends.every((os) => !os?.spent);
      dispatch({
        type: "SET_ERROR",
        txid: loadKey,
        error: allUnspent ? "Output not yet spent" : "All spent outputs already in graph",
      });
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        txid: loadKey,
        error: err instanceof Error ? err.message : "Failed to fetch",
      });
    } finally {
      dispatch({ type: "SET_LOADING", txid: loadKey, loading: false });
    }
  }, [state.nodes]);

  const collapse = useCallback((txid: string) => {
    dispatch({ type: "REMOVE_NODE", txid });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: "UNDO" });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  // Auto-clear errors after 5 seconds
  useEffect(() => {
    if (state.errors.size === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const txid of state.errors.keys()) {
      timers.push(setTimeout(() => dispatch({ type: "CLEAR_ERROR", txid }), 5000));
    }
    return () => timers.forEach(clearTimeout);
  }, [state.errors]);

  return {
    nodes: state.nodes,
    rootTxid: state.rootTxid,
    rootTxids: state.rootTxids,
    loading: state.loading,
    errors: state.errors,
    nodeCount: state.nodes.size,
    maxNodes: state.maxNodes,
    canUndo: state.undoStack.length > 0,
    setRoot,
    setRootWithNeighbors,
    setRootWithLayers,
    setMultiRoot,
    setMultiRootWithLayers,
    expandInput,
    expandOutput,
    collapse,
    undo,
    reset,
  };
}
