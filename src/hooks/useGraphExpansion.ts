"use client";

import { useCallback, useReducer, useRef } from "react";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";

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

interface GraphState {
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  /** History of expansion actions for undo support */
  history: string[];
  /** Loading state per txid */
  loading: Set<string>;
  /** Error messages per txid */
  errors: Map<string, string>;
}

type GraphAction =
  | { type: "SET_ROOT"; tx: MempoolTransaction }
  | { type: "SET_ROOT_WITH_NEIGHBORS"; root: MempoolTransaction; parents: Map<string, MempoolTransaction>; children: Map<number, MempoolTransaction> }
  | { type: "ADD_NODE"; node: GraphNode }
  | { type: "REMOVE_NODE"; txid: string }
  | { type: "SET_LOADING"; txid: string; loading: boolean }
  | { type: "SET_ERROR"; txid: string; error: string }
  | { type: "RESET" }
  | { type: "UNDO" };

const MAX_NODES = 20;

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
        history: [],
        loading: new Set(),
        errors: new Map(),
      };
    }

    case "SET_ROOT_WITH_NEIGHBORS": {
      const rootTxid = action.root.txid;
      const nodes = new Map<string, GraphNode>();
      nodes.set(rootTxid, { txid: rootTxid, tx: action.root, depth: 0 });
      const history: string[] = [];

      // Add parent txs (depth -1)
      for (const [txid, ptx] of action.parents) {
        if (nodes.size >= MAX_NODES) break;
        if (nodes.has(txid)) continue;
        const inputIdx = action.root.vin.findIndex((v) => v.txid === txid);
        if (inputIdx === -1) continue;  // Parent output not found, skip edge
        nodes.set(txid, {
          txid,
          tx: ptx,
          depth: -1,
          childEdge: { toTxid: rootTxid, inputIndex: inputIdx },
        });
        history.push(txid);
      }

      // Add child txs (depth +1)
      for (const [outputIdx, ctx] of action.children) {
        if (nodes.size >= MAX_NODES) break;
        if (nodes.has(ctx.txid)) continue;
        nodes.set(ctx.txid, {
          txid: ctx.txid,
          tx: ctx,
          depth: 1,
          parentEdge: { fromTxid: rootTxid, outputIndex: outputIdx },
        });
        history.push(ctx.txid);
      }

      return { nodes, rootTxid, history, loading: new Set(), errors: new Map() };
    }

    case "ADD_NODE": {
      if (state.nodes.size >= MAX_NODES) return state;
      if (state.nodes.has(action.node.txid)) return state;
      const nodes = new Map(state.nodes);
      nodes.set(action.node.txid, action.node);
      return {
        ...state,
        nodes,
        history: [...state.history, action.node.txid],
      };
    }

    case "REMOVE_NODE": {
      if (action.txid === state.rootTxid) return state;
      const nodes = new Map(state.nodes);
      nodes.delete(action.txid);
      return {
        ...state,
        nodes,
        history: state.history.filter((id) => id !== action.txid),
      };
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

    case "RESET": {
      const root = state.nodes.get(state.rootTxid);
      if (!root) return state;
      const nodes = new Map<string, GraphNode>();
      nodes.set(state.rootTxid, root);
      return {
        ...state,
        nodes,
        history: [],
        loading: new Set(),
        errors: new Map(),
      };
    }

    case "UNDO": {
      if (state.history.length === 0) return state;
      const lastTxid = state.history[state.history.length - 1];
      const nodes = new Map(state.nodes);
      nodes.delete(lastTxid);
      return {
        ...state,
        nodes,
        history: state.history.slice(0, -1),
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

const INITIAL_STATE: GraphState = {
  nodes: new Map(),
  rootTxid: "",
  history: [],
  loading: new Set(),
  errors: new Map(),
};

export function useGraphExpansion(fetcher: GraphExpansionFetcher | null) {
  const [state, dispatch] = useReducer(graphReducer, INITIAL_STATE);
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
    if (state.nodes.size >= MAX_NODES) return;

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

  /** Expand forward: fetch the child tx that spends the given output */
  const expandOutput = useCallback(async (currentTxid: string, outputIndex: number) => {
    const client = fetcherRef.current;
    if (!client) return;

    const node = state.nodes.get(currentTxid);
    if (!node) return;
    if (state.nodes.size >= MAX_NODES) return;

    dispatch({ type: "SET_LOADING", txid: `${currentTxid}:${outputIndex}`, loading: true });

    try {
      const outspends = await client.getTxOutspends(currentTxid);
      const os = outspends[outputIndex];
      if (!os?.spent || !os.txid) {
        dispatch({ type: "SET_LOADING", txid: `${currentTxid}:${outputIndex}`, loading: false });
        return;
      }

      const childTxid = os.txid;
      if (state.nodes.has(childTxid)) {
        dispatch({ type: "SET_LOADING", txid: `${currentTxid}:${outputIndex}`, loading: false });
        return;
      }

      const childTx = await client.getTransaction(childTxid);
      dispatch({
        type: "ADD_NODE",
        node: {
          txid: childTxid,
          tx: childTx,
          depth: node.depth + 1,
          parentEdge: { fromTxid: currentTxid, outputIndex },
        },
      });
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        txid: `${currentTxid}:${outputIndex}`,
        error: err instanceof Error ? err.message : "Failed to fetch",
      });
    } finally {
      dispatch({ type: "SET_LOADING", txid: `${currentTxid}:${outputIndex}`, loading: false });
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

  return {
    nodes: state.nodes,
    rootTxid: state.rootTxid,
    history: state.history,
    loading: state.loading,
    errors: state.errors,
    nodeCount: state.nodes.size,
    maxNodes: MAX_NODES,
    canUndo: state.history.length > 0,
    setRoot,
    setRootWithNeighbors,
    expandInput,
    expandOutput,
    collapse,
    undo,
    reset,
  };
}
