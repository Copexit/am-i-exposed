"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
  fetcherRef.current = fetcher;
  // Ref for auto-trace callbacks to read current state without stale closures
  const stateRef = useRef(state);
  stateRef.current = state;

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
    smartFilter?: boolean,
  ) => {
    dispatch({ type: "SET_ROOT_WITH_LAYERS", root, backwardLayers, forwardLayers, outspends, smartFilter });
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
    if (!client) {
      dispatch({ type: "SET_ERROR", txid: currentTxid, error: "No API client available" });
      return;
    }

    const node = state.nodes.get(currentTxid);
    if (!node) {
      dispatch({ type: "SET_ERROR", txid: currentTxid, error: "Transaction not found in graph" });
      return;
    }

    const vin = node.tx.vin[inputIndex];
    if (!vin || vin.is_coinbase) return;

    const parentTxid = vin.txid;
    if (state.nodes.has(parentTxid)) return; // already in graph - not an error
    if (state.nodes.size >= state.maxNodes) {
      dispatch({ type: "SET_ERROR", txid: currentTxid, error: "Maximum nodes reached" });
      return;
    }

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
  }, [state.nodes, state.maxNodes]);

  /** Try address-based fallback to find a child tx that spends a specific output.
   *  Scans the output address's transaction history for one that references our txid:vout. */
  const findChildViaAddress = useCallback(async (
    client: GraphExpansionFetcher,
    tx: MempoolTransaction,
    currentTxid: string,
    outputIndex: number,
    existingNodes: Map<string, GraphNode>,
  ): Promise<{ childTx: MempoolTransaction; outputIdx: number } | null> => {
    if (!client.getAddressTxs) return null;

    // Scan outputs starting from hint, wrapping around
    const vout = tx.vout;
    for (let offset = 0; offset < vout.length; offset++) {
      const oi = (outputIndex + offset) % vout.length;
      const addr = vout[oi].scriptpubkey_address;
      if (!addr || vout[oi].value === 0) continue;

      const addrTxs = await client.getAddressTxs(addr);
      for (const atx of addrTxs) {
        if (atx.txid === currentTxid) continue;
        if (existingNodes.has(atx.txid)) continue;
        // Check if this tx actually spends our output
        const spendsOur = atx.vin.some(
          (v) => v.txid === currentTxid && v.vout === oi,
        );
        if (spendsOur) return { childTx: atx, outputIdx: oi };
      }
    }
    return null;
  }, []);

  /** Expand forward: fetch the child tx that spends the given output.
   *  Scans all outputs starting from the hint index to find an expandable one.
   *  Falls back to address-based lookup if outspends endpoint is unavailable. */
  const expandOutput = useCallback(async (currentTxid: string, outputIndex: number) => {
    const client = fetcherRef.current;
    if (!client) {
      dispatch({ type: "SET_ERROR", txid: currentTxid, error: "No API client available" });
      return;
    }

    const node = state.nodes.get(currentTxid);
    if (!node) {
      dispatch({ type: "SET_ERROR", txid: currentTxid, error: "Transaction not found in graph" });
      return;
    }
    if (state.nodes.size >= state.maxNodes) {
      dispatch({ type: "SET_ERROR", txid: `${currentTxid}:out`, error: "Maximum nodes reached" });
      return;
    }

    const loadKey = `${currentTxid}:out`;
    dispatch({ type: "SET_LOADING", txid: loadKey, loading: true });

    try {
      let outspends: MempoolOutspend[] = [];
      let outspendsFailed = false;
      try {
        outspends = await client.getTxOutspends(currentTxid);
      } catch {
        outspendsFailed = true;
      }

      // Try outspends first (fast path)
      const total = outspends.length;
      const needsFallback = outspendsFailed
        || total === 0
        || outspends.some((os) => os?.spent && !os.txid);

      if (!needsFallback) {
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

        // Outspends worked but no expandable output found
        const allUnspent = outspends.every((os) => !os?.spent);
        dispatch({
          type: "SET_ERROR",
          txid: loadKey,
          error: allUnspent ? "Output not yet spent" : "All spent outputs already in graph",
        });
        return;
      }

      // Fallback: use address-based lookup
      if (client.getAddressTxs) {
        const result = await findChildViaAddress(client, node.tx, currentTxid, outputIndex, state.nodes);
        if (result) {
          dispatch({
            type: "ADD_NODE",
            node: {
              txid: result.childTx.txid,
              tx: result.childTx,
              depth: node.depth + 1,
              parentEdge: { fromTxid: currentTxid, outputIndex: result.outputIdx },
            },
          });
          return;
        }
      }

      // Neither outspends nor address fallback found a child
      dispatch({
        type: "SET_ERROR",
        txid: loadKey,
        error: outspendsFailed
          ? "Output not yet spent or address has no other transactions"
          : "Output not yet spent",
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
  }, [state.nodes, state.maxNodes, findChildViaAddress]);

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

  // ─── Expanded node state (UTXO port mode) ──────────────────────
  const [expandedNodeTxid, setExpandedNodeTxid] = useState<string | null>(null);
  const outspendCacheRef = useRef<Map<string, MempoolOutspend[]>>(new Map());
  // Force re-render counter - used when outspend data arrives for an already-expanded node
  const [, setOutspendTick] = useState(0);

  // Clear expanded node when graph is reset or root changes
  useEffect(() => {
    setExpandedNodeTxid(null);
    outspendCacheRef.current.clear();
  }, [state.rootTxid]);

  /** Fetch and cache outspends for a txid if not already cached. */
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

  /** Toggle node expansion. Clicking a new node collapses the previous one. */
  const toggleExpand = useCallback(async (txid: string) => {
    if (expandedNodeTxid === txid) {
      setExpandedNodeTxid(null);
      return;
    }
    setExpandedNodeTxid(txid);
    await fetchAndCacheOutspends(txid);
  }, [expandedNodeTxid, fetchAndCacheOutspends]);

  /** Expand backward from a specific input port. The new node becomes expanded. */
  const expandPortInput = useCallback(async (txid: string, inputIndex: number) => {
    await expandInput(txid, inputIndex);
    // After expansion completes, expand the newly added parent node
    const node = stateRef.current.nodes.get(txid);
    if (node) {
      const vin = node.tx.vin[inputIndex];
      if (vin && !vin.is_coinbase) {
        setExpandedNodeTxid(vin.txid);
        await fetchAndCacheOutspends(vin.txid);
      }
    }
  }, [expandInput, fetchAndCacheOutspends]);

  /** Pending forward port expansion (resolved by useEffect when state.nodes updates). */
  const [pendingPortExpand, setPendingPortExpand] = useState<{ txid: string; outputIndex: number } | null>(null);

  /** Expand forward from a specific output port. The new node becomes expanded. */
  const expandPortOutput = useCallback(async (txid: string, outputIndex: number) => {
    await expandOutput(txid, outputIndex);
    setPendingPortExpand({ txid, outputIndex });
  }, [expandOutput]);

  // Resolve pending port expansion after React processes the ADD_NODE dispatch
  useEffect(() => {
    if (!pendingPortExpand) return;
    const { txid, outputIndex } = pendingPortExpand;

    for (const [childTxid, childNode] of state.nodes) {
      if (childNode.parentEdge?.fromTxid === txid) {
        const matchesOutput = childNode.tx.vin.some(
          (v) => v.txid === txid && v.vout === outputIndex,
        );
        if (matchesOutput) {
          setExpandedNodeTxid(childTxid);
          setPendingPortExpand(null);
          fetchAndCacheOutspends(childTxid);
          return;
        }
      }
    }
  }, [pendingPortExpand, state.nodes, fetchAndCacheOutspends]);

  // ─── Auto-trace (peel chain following) ──────────────────────────
  const autoTraceAbortRef = useRef<AbortController | null>(null);
  const [autoTracing, setAutoTracing] = useState(false);
  const [autoTraceProgress, setAutoTraceProgress] = useState<AutoTraceProgress | null>(null);

  /** Shared callbacks for the extracted auto-trace functions. */
  const makeAutoTraceCallbacks = useCallback(() => ({
    dispatch,
    getState: () => ({ nodes: stateRef.current.nodes, maxNodes: stateRef.current.maxNodes }),
    onProgress: setAutoTraceProgress,
    onTracingChange: setAutoTracing,
  }), []);

  /** Auto-trace forward from a specific output, following the most likely change at each hop. */
  const autoTrace = useCallback(async (startTxid: string, startOutputIndex: number, maxHops = 20) => {
    const client = fetcherRef.current;
    if (!client) return;

    // Abort any previous trace
    autoTraceAbortRef.current?.abort();
    const ac = new AbortController();
    autoTraceAbortRef.current = ac;

    await runAutoTrace(client, startTxid, startOutputIndex, maxHops, ac.signal, makeAutoTraceCallbacks());
  }, [makeAutoTraceCallbacks]);

  /** Cancel any in-progress auto-trace. */
  const cancelAutoTrace = useCallback(() => {
    autoTraceAbortRef.current?.abort();
    setAutoTracing(false);
    setAutoTraceProgress(null);
  }, []);

  /** Auto-trace forward using compounding linkability. Stops when compound probability < threshold. */
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

  return {
    nodes: state.nodes,
    rootTxid: state.rootTxid,
    rootTxids: state.rootTxids,
    loading: state.loading,
    errors: state.errors,
    nodeCount: state.nodes.size,
    maxNodes: state.maxNodes,
    setRoot,
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
    outspendCache: outspendCacheRef.current,
    // Auto-trace
    autoTrace,
    cancelAutoTrace,
    autoTracing,
    autoTraceProgress,
    autoTraceLinkability,
  };
}
