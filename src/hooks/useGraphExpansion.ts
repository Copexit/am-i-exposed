"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import {
  graphReducer,
  makeInitialState,
  DEFAULT_MAX_NODES,
  type GraphNode,
  type GraphAction,
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

const EMPTY_OUTSPENDS: ReadonlyMap<string, MempoolOutspend[]> = new Map();

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

  // ---- Auto-trace state (declared first: replacing the graph cancels it) ----

  const autoTraceAbortRef = useRef<AbortController | null>(null);
  const [autoTracing, setAutoTracing] = useState(false);
  const [autoTraceProgress, setAutoTraceProgress] = useState<AutoTraceProgress | null>(null);
  /** Why the last finished trace stopped (unspent, threshold, ...); null while tracing or after a cancel. */
  const [lastAutoTraceStop, setLastAutoTraceStop] = useState<string | null>(null);

  const cancelAutoTrace = useCallback(() => {
    autoTraceAbortRef.current?.abort();
    setAutoTracing(false);
    setAutoTraceProgress(null);
    setLastAutoTraceStop(null);
  }, []);

  // Stop a running trace on unmount so it makes no further requests
  useEffect(() => () => autoTraceAbortRef.current?.abort(), []);

  // ---- Expanded node state (UTXO port mode) ----

  // Both are tagged with the root they belong to, so a root change resets them
  // by derivation; RESET and LOAD_GRAPH also clear them explicitly, since they
  // can land back on the same root. An expanded node that left the graph
  // (collapsed, or its ADD_NODE was rejected at capacity) is not expanded.
  const [expanded, setExpanded] = useState<{ root: string; txid: string | null }>({ root: "", txid: null });
  const expandedNodeTxid =
    expanded.root === state.rootTxid && expanded.txid && state.nodes.has(expanded.txid) ? expanded.txid : null;

  const [outspends, setOutspends] = useState<{ root: string; cache: ReadonlyMap<string, MempoolOutspend[]> }>(
    { root: "", cache: EMPTY_OUTSPENDS },
  );
  const outspendCache = outspends.root === state.rootTxid ? outspends.cache : EMPTY_OUTSPENDS;
  // Written synchronously next to every setOutspends, so back-to-back calls see the latest cache
  const outspendsRef = useRef(outspends);
  // In-flight fetches by txid, so concurrent expands share one request
  const outspendsInflight = useRef(new Map<string, Promise<void>>());
  // Bumped when the cache is cleared, so a fetch from before the clear is dropped
  const outspendsGen = useRef(0);

  const clearExpansion = useCallback(() => {
    outspendsGen.current++;
    outspendsInflight.current.clear();
    const empty = { root: "", cache: EMPTY_OUTSPENDS };
    outspendsRef.current = empty;
    setOutspends(empty);
    setExpanded({ root: "", txid: null });
  }, []);

  const fetchAndCacheOutspends = useCallback((txid: string, root: string): Promise<void> => {
    const current = outspendsRef.current;
    if (current.root === root && current.cache.has(txid)) return Promise.resolve();
    const client = fetcherRef.current;
    if (!client) return Promise.resolve();
    const key = `${root}:${txid}`;
    const pending = outspendsInflight.current.get(key);
    if (pending) return pending;

    const gen = outspendsGen.current;
    const request = (async () => {
      try {
        const result = await client.getTxOutspends(txid);
        // The graph was replaced while this was in flight - the entry belongs to the old graph.
        if (stateRef.current.rootTxid !== root || outspendsGen.current !== gen) return;
        const prev = outspendsRef.current;
        const next = { root, cache: new Map(prev.root === root ? prev.cache : []).set(txid, result) };
        outspendsRef.current = next;
        setOutspends(next);
      } catch {
        // Outspends unavailable - not critical, ports still render without spend status
      } finally {
        if (outspendsGen.current === gen) outspendsInflight.current.delete(key);
      }
    })();
    outspendsInflight.current.set(key, request);
    return request;
  }, []);


  // ---- Root initialization actions ----

  const setRoot = useCallback((tx: MempoolTransaction) => {
    cancelAutoTrace();
    dispatch({ type: "SET_ROOT", tx });
  }, [cancelAutoTrace]);

  const loadGraph = useCallback((
    nodes: Map<string, GraphNode>,
    rootTxid: string,
    rootTxids: Set<string>,
  ) => {
    cancelAutoTrace();
    clearExpansion();
    dispatch({ type: "LOAD_GRAPH", nodes, rootTxid, rootTxids });
  }, [cancelAutoTrace, clearExpansion]);

  const setRootWithNeighbors = useCallback((
    root: MempoolTransaction,
    parents: Map<string, MempoolTransaction>,
    children: Map<number, MempoolTransaction>,
  ) => {
    cancelAutoTrace();
    dispatch({ type: "SET_ROOT_WITH_NEIGHBORS", root, parents, children });
  }, [cancelAutoTrace]);

  const setRootWithLayers = useCallback((
    root: MempoolTransaction,
    backwardLayers: TraceLayer[],
    forwardLayers: TraceLayer[],
    outspends?: MempoolOutspend[],
    smartFilter?: boolean,
  ) => {
    cancelAutoTrace();
    dispatch({ type: "SET_ROOT_WITH_LAYERS", root, backwardLayers, forwardLayers, outspends, smartFilter });
  }, [cancelAutoTrace]);

  const setMultiRoot = useCallback((txs: Map<string, MempoolTransaction>) => {
    cancelAutoTrace();
    dispatch({ type: "SET_MULTI_ROOT", txs });
  }, [cancelAutoTrace]);

  const setMultiRootWithLayers = useCallback((roots: Map<string, MultiRootEntry>, preExpandBudget?: number) => {
    cancelAutoTrace();
    dispatch({ type: "SET_MULTI_ROOT_WITH_LAYERS", roots, preExpandBudget });
  }, [cancelAutoTrace]);

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
    cancelAutoTrace();
    clearExpansion();
    dispatch({ type: "RESET" });
  }, [cancelAutoTrace, clearExpansion]);

  // Auto-clear errors after 5 seconds
  useEffect(() => {
    if (state.errors.size === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const txid of state.errors.keys()) {
      timers.push(setTimeout(() => dispatch({ type: "CLEAR_ERROR", txid }), 5000));
    }
    return () => timers.forEach(clearTimeout);
  }, [state.errors]);

  /** Expand a node's UTXO ports and load its spend status. */
  const expandNode = useCallback(async (txid: string) => {
    const root = stateRef.current.rootTxid;
    setExpanded({ root, txid });
    await fetchAndCacheOutspends(txid, root);
  }, [fetchAndCacheOutspends]);

  const toggleExpand = useCallback(async (txid: string) => {
    if (expandedNodeTxid === txid) {
      setExpanded((prev) => ({ ...prev, txid: null }));
      return;
    }
    await expandNode(txid);
  }, [expandedNodeTxid, expandNode]);

  const expandPortInput = useCallback(async (txid: string, inputIndex: number) => {
    await expandInput(txid, inputIndex);
    const vin = stateRef.current.nodes.get(txid)?.tx.vin[inputIndex];
    if (vin && !vin.is_coinbase) await expandNode(vin.txid);
  }, [expandInput, expandNode]);

  const expandPortOutput = useCallback(async (txid: string, outputIndex: number) => {
    // The op may pick a different output than the one clicked (it skips spends
    // already in the graph), so take the child from the ADD_NODE it dispatches.
    let childTxid: string | null = null;
    await expandOutputOp({
      ...expansionCtx,
      dispatch: (action) => {
        if (action.type === "ADD_NODE") childTxid = action.node.txid;
        dispatch(action);
      },
    }, txid, outputIndex);
    if (childTxid) await expandNode(childTxid);
  }, [expansionCtx, expandNode]);

  // ---- Auto-trace (peel chain following) ----

  // A cancelled trace's late updates are dropped (cancelAutoTrace already reset the UI)
  const makeAutoTraceCallbacks = useCallback((signal: AbortSignal) => ({
    dispatch: (action: GraphAction) => { if (!signal.aborted) dispatch(action); },
    getState: () => ({ nodes: stateRef.current.nodes, maxNodes: stateRef.current.maxNodes }),
    onProgress: (p: AutoTraceProgress | null) => { if (!signal.aborted) setAutoTraceProgress(p); },
    onTracingChange: (tracing: boolean) => { if (!signal.aborted) setAutoTracing(tracing); },
  }), []);

  const autoTrace = useCallback(async (startTxid: string, startOutputIndex: number, maxHops = 20) => {
    const client = fetcherRef.current;
    if (!client) return;
    autoTraceAbortRef.current?.abort();
    const ac = new AbortController();
    autoTraceAbortRef.current = ac;
    setLastAutoTraceStop(null);
    const stop = await runAutoTrace(client, startTxid, startOutputIndex, maxHops, ac.signal, makeAutoTraceCallbacks(ac.signal));
    if (!ac.signal.aborted) setLastAutoTraceStop(stop);
  }, [makeAutoTraceCallbacks]);

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
    setLastAutoTraceStop(null);
    const stop = await runAutoTraceLinkability(client, startTxid, startOutputIndex, ac.signal, makeAutoTraceCallbacks(ac.signal), opts);
    if (!ac.signal.aborted) setLastAutoTraceStop(stop);
  }, [makeAutoTraceCallbacks]);

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
    lastAutoTraceStop,
    autoTraceLinkability,
  };
}
