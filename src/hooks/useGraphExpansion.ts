"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
  /** Optional: used as fallback when outspends endpoint is unavailable. */
  getAddressTxs?(address: string): Promise<MempoolTransaction[]>;
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

  /** Toggle node expansion. Clicking a new node collapses the previous one. */
  const toggleExpand = useCallback(async (txid: string) => {
    if (expandedNodeTxid === txid) {
      setExpandedNodeTxid(null);
      return;
    }
    setExpandedNodeTxid(txid);

    // Fetch outspends if not cached
    if (!outspendCacheRef.current.has(txid)) {
      const client = fetcherRef.current;
      if (client) {
        try {
          const outspends = await client.getTxOutspends(txid);
          outspendCacheRef.current.set(txid, outspends);
          // Force re-render so the expanded node picks up the outspend data
          setOutspendTick((c) => c + 1);
        } catch {
          // Outspends unavailable - not critical, ports still render without spend status
        }
      }
    }
  }, [expandedNodeTxid]);

  /** Expand backward from a specific input port. The new node becomes expanded. */
  const expandPortInput = useCallback(async (txid: string, inputIndex: number) => {
    await expandInput(txid, inputIndex);
    // After expansion completes, expand the newly added parent node
    const node = stateRef.current.nodes.get(txid);
    if (node) {
      const vin = node.tx.vin[inputIndex];
      if (vin && !vin.is_coinbase) {
        setExpandedNodeTxid(vin.txid);
        // Fetch outspends for the new node
        const client = fetcherRef.current;
        if (client && !outspendCacheRef.current.has(vin.txid)) {
          try {
            const outspends = await client.getTxOutspends(vin.txid);
            outspendCacheRef.current.set(vin.txid, outspends);
            setOutspendTick((c) => c + 1);
          } catch { /* not critical */ }
        }
      }
    }
  }, [expandInput]);

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
          // Fetch outspends for the new node
          const client = fetcherRef.current;
          if (client && !outspendCacheRef.current.has(childTxid)) {
            client.getTxOutspends(childTxid).then((os) => {
              outspendCacheRef.current.set(childTxid, os);
              setOutspendTick((c) => c + 1);
            }).catch(() => { /* not critical */ });
          }
          return;
        }
      }
    }
  }, [pendingPortExpand, state.nodes]);

  // ─── Auto-trace (peel chain following) ──────────────────────────
  const autoTraceAbortRef = useRef<AbortController | null>(null);
  const [autoTracing, setAutoTracing] = useState(false);
  const [autoTraceProgress, setAutoTraceProgress] = useState<{ hop: number; txid: string; reason: string } | null>(null);

  /** Auto-trace forward from a specific output, following the most likely change at each hop. */
  const autoTrace = useCallback(async (startTxid: string, startOutputIndex: number, maxHops = 20) => {
    const { identifyChangeOutput } = await import("@/components/viz/graph/autoTrace");
    const client = fetcherRef.current;
    if (!client) return;

    // Abort any previous trace
    autoTraceAbortRef.current?.abort();
    const ac = new AbortController();
    autoTraceAbortRef.current = ac;

    setAutoTracing(true);
    setAutoTraceProgress({ hop: 0, txid: startTxid, reason: "starting" });

    let currentTxid = startTxid;
    let currentOutputIndex = startOutputIndex;
    let currentDepth = stateRef.current.nodes.get(startTxid)?.depth ?? 0;
    let addedThisTrace = 0;

    try {
      for (let hop = 0; hop < maxHops; hop++) {
        if (ac.signal.aborted) break;
        if (stateRef.current.nodes.size + addedThisTrace >= stateRef.current.maxNodes) {
          dispatch({ type: "SET_ERROR", txid: currentTxid, error: "Auto-trace stopped: max nodes reached" });
          break;
        }

        setAutoTraceProgress({ hop: hop + 1, txid: currentTxid, reason: "expanding" });

        // Fetch outspends to find the spending tx for this output
        let outspends: MempoolOutspend[];
        try {
          outspends = await client.getTxOutspends(currentTxid);
        } catch {
          dispatch({ type: "SET_ERROR", txid: currentTxid, error: "Auto-trace: failed to fetch outspends" });
          break;
        }

        if (ac.signal.aborted) break;

        const os = outspends[currentOutputIndex];
        if (!os?.spent || !os.txid) {
          setAutoTraceProgress({ hop: hop + 1, txid: currentTxid, reason: "unspent" });
          break;
        }

        const childTxid = os.txid;

        // Always fetch the child tx (don't rely on stale state.nodes)
        let childTx: MempoolTransaction;
        try {
          childTx = await client.getTransaction(childTxid);
        } catch (err) {
          dispatch({ type: "SET_ERROR", txid: childTxid, error: `Auto-trace: ${err instanceof Error ? err.message : "fetch failed"}` });
          break;
        }
        if (ac.signal.aborted) break;

        // Add to graph
        currentDepth++;
        dispatch({
          type: "ADD_NODE",
          node: {
            txid: childTxid,
            tx: childTx,
            depth: currentDepth,
            parentEdge: { fromTxid: currentTxid, outputIndex: currentOutputIndex },
          },
        });
        addedThisTrace++;
        await new Promise((r) => setTimeout(r, 80));

        // Analyze the freshly fetched tx directly (not from stale state)
        const changeResult = identifyChangeOutput(childTx);
        setAutoTraceProgress({ hop: hop + 1, txid: childTxid, reason: changeResult.reason });

        if (changeResult.changeOutputIndex === null) {
          // Terminal condition reached
          break;
        }

        // Continue tracing from the change output
        currentTxid = childTxid;
        currentOutputIndex = changeResult.changeOutputIndex;
      }
    } finally {
      setAutoTracing(false);
      setAutoTraceProgress(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    opts?: { threshold?: number; maxHops?: number; boltzmannCache?: Map<string, import("@/lib/analysis/boltzmann-pool").BoltzmannWorkerResult> },
  ) => {
    const { identifyChangeOutput } = await import("@/components/viz/graph/autoTrace");
    const { computeBoltzmann, extractTxValues } = await import("@/lib/analysis/boltzmann-compute");
    const client = fetcherRef.current;
    if (!client) return;

    const threshold = opts?.threshold ?? 0.05;
    const maxHops = opts?.maxHops ?? 10;
    const cache = opts?.boltzmannCache;

    autoTraceAbortRef.current?.abort();
    const ac = new AbortController();
    autoTraceAbortRef.current = ac;

    setAutoTracing(true);
    let compoundProb = 1.0;
    let currentTxid = startTxid;
    let currentOutputIndex = startOutputIndex;
    // Track depth from the starting node for ADD_NODE depth field
    let currentDepth = stateRef.current.nodes.get(startTxid)?.depth ?? 0;
    let addedThisTrace = 0;

    try {
      for (let hop = 0; hop < maxHops; hop++) {
        if (ac.signal.aborted) break;
        if (stateRef.current.nodes.size + addedThisTrace >= stateRef.current.maxNodes) break;

        setAutoTraceProgress({ hop: hop + 1, txid: currentTxid, reason: `compound: ${Math.round(compoundProb * 100)}%` });

        // Fetch outspends for the current tx
        let outspends: import("@/lib/api/types").MempoolOutspend[];
        try { outspends = await client.getTxOutspends(currentTxid); } catch { break; }
        if (ac.signal.aborted) break;

        const os = outspends[currentOutputIndex];
        if (!os?.spent || !os.txid) {
          setAutoTraceProgress({ hop: hop + 1, txid: currentTxid, reason: "unspent" });
          break;
        }

        const childTxid = os.txid;

        // Fetch the child tx (always fetch fresh - don't rely on stale state.nodes)
        let childTx: import("@/lib/api/types").MempoolTransaction;
        try {
          childTx = await client.getTransaction(childTxid);
        } catch {
          dispatch({ type: "SET_ERROR", txid: childTxid, error: "Linkability trace: failed to fetch tx" });
          break;
        }
        if (ac.signal.aborted) break;

        // Add to graph if not already there
        currentDepth++;
        dispatch({
          type: "ADD_NODE",
          node: { txid: childTxid, tx: childTx, depth: currentDepth, parentEdge: { fromTxid: currentTxid, outputIndex: currentOutputIndex } },
        });
        addedThisTrace++;
        // Small delay so the UI shows the node appearing
        await new Promise((r) => setTimeout(r, 100));
        if (ac.signal.aborted) break;

        // Compute Boltzmann for the child tx (use cache or compute fresh)
        let boltzResult = cache?.get(childTxid);
        if (!boltzResult) {
          const { inputValues, outputValues } = extractTxValues(childTx);
          if (inputValues.length === 1) {
            // 1-input: synthetic 100% deterministic (no need for WASM)
            compoundProb *= 1.0; // doesn't change compound
          } else if (inputValues.length >= 2 && inputValues.length + outputValues.length <= 80) {
            try {
              boltzResult = await computeBoltzmann(childTx, { signal: ac.signal }) ?? undefined;
            } catch { /* treat as 100% worst case */ }
          }
        }
        if (ac.signal.aborted) break;

        // Identify the change output for the next hop
        const changeResult = identifyChangeOutput(childTx);
        if (changeResult.changeOutputIndex === null) {
          setAutoTraceProgress({ hop: hop + 1, txid: childTxid, reason: changeResult.reason });
          break;
        }

        // Compute the linkability: P(change output | spending input) for this hop
        if (boltzResult?.matLnkProbabilities) {
          const mat = boltzResult.matLnkProbabilities;
          const spendingInputIdx = childTx.vin.findIndex(
            (v) => v.txid === currentTxid && v.vout === currentOutputIndex,
          );
          if (spendingInputIdx >= 0 && mat[changeResult.changeOutputIndex]?.[spendingInputIdx] !== undefined) {
            compoundProb *= mat[changeResult.changeOutputIndex][spendingInputIdx];
          }
        }

        setAutoTraceProgress({ hop: hop + 1, txid: childTxid, reason: `compound: ${Math.round(compoundProb * 100)}%` });

        // Check threshold
        if (compoundProb < threshold) {
          setAutoTraceProgress({ hop: hop + 1, txid: childTxid, reason: `below ${Math.round(threshold * 100)}% threshold` });
          break;
        }

        currentTxid = childTxid;
        currentOutputIndex = changeResult.changeOutputIndex;
      }
    } finally {
      setAutoTracing(false);
      setAutoTraceProgress(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
