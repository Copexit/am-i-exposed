"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import {
  graphReducer,
  makeInitialState,
  DEFAULT_MAX_NODES,
  type GraphNode,
  type GraphExpansionFetcher,
  type MultiRootEntry,
} from "@/lib/graph/graph-reducer";
import {
  runAutoTrace,
  runAutoTraceLinkability,
  type AutoTraceProgress,
  type AutoTraceLinkabilityOptions,
} from "@/lib/graph/auto-trace-logic";
import {
  expandInputOp,
  expandOutputOp,
  type ExpansionContext,
} from "@/lib/graph/graph-expansion-ops";

// Re-export types that consumers import from this module
export type { GraphNode, MultiRootEntry } from "@/lib/graph/graph-reducer";

/**
 * Interactive graph expansion hook (OXT-style click-to-expand).
 *
 * Manages state for an expandable transaction graph where users can
 * click inputs to expand leftward (parent txs) or outputs to expand
 * rightward (child txs).
 */
export function useGraphExpansion(fetcher: GraphExpansionFetcher | null, maxNodes = DEFAULT_MAX_NODES) {
  const [state, dispatch] = useReducer(graphReducer, maxNodes, makeInitialState);
  const fetcherRef = useRef(fetcher);
  // Ref for auto-trace callbacks to read current state without stale closures
  const stateRef = useRef(state);

  // Sync refs in effects to satisfy react-hooks/refs lint rule.
  // These are only read inside callbacks, never during render.
  useEffect(() => { fetcherRef.current = fetcher; }, [fetcher]);
  useEffect(() => { stateRef.current = state; }, [state]);

  /** Shared expansion context for the extracted op functions. */
  const expansionCtx: ExpansionContext = useMemo(() => ({
    dispatch,
    getNodes: () => stateRef.current.nodes,
    getMaxNodes: () => stateRef.current.maxNodes,
    getFetcher: () => fetcherRef.current,
  }), []);

  // ---- Root initialization actions ----

  const setRoot = useCallback((tx: MempoolTransaction) => {
    dispatch({ type: "SET_ROOT", tx });
  }, []);

  const loadGraph = useCallback((
    nodes: Map<string, GraphNode>,
    rootTxid: string,
    rootTxids: Set<string>,
  ) => {
    dispatch({ type: "LOAD_GRAPH", nodes, rootTxid, rootTxids });
  }, []);

  const setRootWithNeighbors = useCallback((
    root: MempoolTransaction,
    parents: Map<string, MempoolTransaction>,
    children: Map<number, MempoolTransaction>,
  ) => {
    dispatch({ type: "SET_ROOT_WITH_NEIGHBORS", root, parents, children });
  }, []);

  const setRootWithLayers = useCallback((
    root: MempoolTransaction,
    backwardLayers: TraceLayer[],
    forwardLayers: TraceLayer[],
    outspends?: MempoolOutspend[],
    smartFilter?: boolean,
  ) => {
    dispatch({ type: "SET_ROOT_WITH_LAYERS", root, backwardLayers, forwardLayers, outspends, smartFilter });
  }, []);

  const setMultiRoot = useCallback((txs: Map<string, MempoolTransaction>) => {
    dispatch({ type: "SET_MULTI_ROOT", txs });
  }, []);

  const setMultiRootWithLayers = useCallback((roots: Map<string, MultiRootEntry>, preExpandBudget?: number) => {
    dispatch({ type: "SET_MULTI_ROOT_WITH_LAYERS", roots, preExpandBudget });
  }, []);

  // ---- Expansion (delegates to extracted ops) ----

  const expandInput = useCallback(
    (currentTxid: string, inputIndex: number) => expandInputOp(expansionCtx, currentTxid, inputIndex),
    [expansionCtx],
  );

  const expandOutput = useCallback(
    (currentTxid: string, outputIndex: number) => expandOutputOp(expansionCtx, currentTxid, outputIndex),
    [expansionCtx],
  );

  // ---- Basic actions ----

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

  // ---- Expanded node state (UTXO port mode) ----

  const [expandedNodeTxid, setExpandedNodeTxid] = useState<string | null>(null);
  const outspendCacheRef = useRef<Map<string, MempoolOutspend[]>>(new Map());
  // Force re-render counter - used when outspend data arrives for an already-expanded node
  const [, setOutspendTick] = useState(0);

  // Clear expanded node and outspend cache when root changes.
  // setState here is an intentional derived-state reset; the effect is the correct
  // place because the ref must also be cleared alongside React state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived-state reset on root change
    setExpandedNodeTxid(null);
    outspendCacheRef.current.clear();
  }, [state.rootTxid]);

  const fetchAndCacheOutspends = useCallback(async (txid: string) => {
    if (outspendCacheRef.current.has(txid)) return;
    const client = fetcherRef.current;
    if (!client) return;
    try {
      const outspends = await client.getTxOutspends(txid);
      outspendCacheRef.current.set(txid, outspends);
      setOutspendTick((c) => c + 1);
    } catch {
      // Outspends unavailable - not critical, ports still render without spend status
    }
  }, []);

  const toggleExpand = useCallback(async (txid: string) => {
    if (expandedNodeTxid === txid) {
      setExpandedNodeTxid(null);
      return;
    }
    setExpandedNodeTxid(txid);
    await fetchAndCacheOutspends(txid);
  }, [expandedNodeTxid, fetchAndCacheOutspends]);

  const expandPortInput = useCallback(async (txid: string, inputIndex: number) => {
    await expandInput(txid, inputIndex);
    const node = stateRef.current.nodes.get(txid);
    if (node) {
      const vin = node.tx.vin[inputIndex];
      if (vin && !vin.is_coinbase) {
        setExpandedNodeTxid(vin.txid);
        await fetchAndCacheOutspends(vin.txid);
      }
    }
  }, [expandInput, fetchAndCacheOutspends]);

  const [pendingPortExpand, setPendingPortExpand] = useState<{ txid: string; outputIndex: number } | null>(null);

  const expandPortOutput = useCallback(async (txid: string, outputIndex: number) => {
    await expandOutput(txid, outputIndex);
    setPendingPortExpand({ txid, outputIndex });
  }, [expandOutput]);

  // Resolve pending port expansion after React processes the ADD_NODE dispatch.
  // setState calls here are intentional: this effect synchronizes derived
  // expansion state after the graph state updates from an async dispatch.
  useEffect(() => {
    if (!pendingPortExpand) return;
    const { txid, outputIndex } = pendingPortExpand;

    for (const [childTxid, childNode] of state.nodes) {
      if (childNode.parentEdge?.fromTxid === txid) {
        const matchesOutput = childNode.tx.vin.some(
          (v) => v.txid === txid && v.vout === outputIndex,
        );
        if (matchesOutput) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- consume pending port expand once child node arrives
          setExpandedNodeTxid(childTxid);
          setPendingPortExpand(null);
          fetchAndCacheOutspends(childTxid);
          return;
        }
      }
    }
  }, [pendingPortExpand, state.nodes, fetchAndCacheOutspends]);

  // ---- Auto-trace (peel chain following) ----

  const autoTraceAbortRef = useRef<AbortController | null>(null);
  const [autoTracing, setAutoTracing] = useState(false);
  const [autoTraceProgress, setAutoTraceProgress] = useState<AutoTraceProgress | null>(null);

  const makeAutoTraceCallbacks = useCallback(() => ({
    dispatch,
    getState: () => ({ nodes: stateRef.current.nodes, maxNodes: stateRef.current.maxNodes }),
    onProgress: setAutoTraceProgress,
    onTracingChange: setAutoTracing,
  }), []);

  const autoTrace = useCallback(async (startTxid: string, startOutputIndex: number, maxHops = 20) => {
    const client = fetcherRef.current;
    if (!client) return;
    autoTraceAbortRef.current?.abort();
    const ac = new AbortController();
    autoTraceAbortRef.current = ac;
    await runAutoTrace(client, startTxid, startOutputIndex, maxHops, ac.signal, makeAutoTraceCallbacks());
  }, [makeAutoTraceCallbacks]);

  const cancelAutoTrace = useCallback(() => {
    autoTraceAbortRef.current?.abort();
    setAutoTracing(false);
    setAutoTraceProgress(null);
  }, []);

  const autoTraceLinkability = useCallback(async (
    startTxid: string,
    startOutputIndex: number,
    opts?: AutoTraceLinkabilityOptions,
  ) => {
    const client = fetcherRef.current;
    if (!client) return;
    autoTraceAbortRef.current?.abort();
    const ac = new AbortController();
    autoTraceAbortRef.current = ac;
    await runAutoTraceLinkability(client, startTxid, startOutputIndex, ac.signal, makeAutoTraceCallbacks(), opts);
  }, [makeAutoTraceCallbacks]);

  // Expose outspend cache as readonly. The outspendTick counter above triggers
  // re-renders when new entries are added, keeping consumers in sync.
  /* eslint-disable react-hooks/refs -- reading ref for return value; tick state ensures re-renders */
  const outspendCache: ReadonlyMap<string, MempoolOutspend[]> = outspendCacheRef.current;

  return {
    nodes: state.nodes,
    rootTxid: state.rootTxid,
    rootTxids: state.rootTxids,
    loading: state.loading,
    errors: state.errors,
    nodeCount: state.nodes.size,
    maxNodes: state.maxNodes,
    setRoot,
    loadGraph,
    setRootWithNeighbors,
    setRootWithLayers,
    setMultiRoot,
    setMultiRootWithLayers,
    expandInput,
    expandOutput,
    collapse,
    undo,
    canUndo: state.undoStack.length > 0,
    reset,
    // Expanded node (UTXO ports)
    expandedNodeTxid,
    toggleExpand,
    expandPortInput,
    expandPortOutput,
    outspendCache,
    // Auto-trace
    autoTrace,
    cancelAutoTrace,
    autoTracing,
    autoTraceProgress,
    autoTraceLinkability,
  };
  /* eslint-enable react-hooks/refs */
}
