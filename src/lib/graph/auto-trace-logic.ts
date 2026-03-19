/**
 * Auto-trace algorithms for the transaction graph.
 *
 * Standalone async functions extracted from useGraphExpansion.
 * They accept callback/accessor parameters instead of directly using React state.
 */

import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { GraphNode, GraphExpansionFetcher, GraphAction } from "./graph-reducer";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

// ─── Types for callers ─────────────────────────────────────────────────

export interface AutoTraceProgress {
  hop: number;
  txid: string;
  reason: string;
}

export interface AutoTraceCallbacks {
  /** Dispatch a graph action (ADD_NODE, SET_ERROR, etc.). */
  dispatch: (action: GraphAction) => void;
  /** Read current graph state without stale closures. */
  getState: () => { nodes: Map<string, GraphNode>; maxNodes: number };
  /** Report progress to the UI. */
  onProgress: (progress: AutoTraceProgress | null) => void;
  /** Signal start/end of tracing. */
  onTracingChange: (tracing: boolean) => void;
}

export interface AutoTraceLinkabilityOptions {
  threshold?: number;
  maxHops?: number;
  boltzmannCache?: Map<string, BoltzmannWorkerResult>;
}

// ─── Auto-trace (peel chain following) ─────────────────────────────────

/**
 * Auto-trace forward from a specific output, following the most likely
 * change output at each hop (peel chain following).
 */
export async function runAutoTrace(
  client: GraphExpansionFetcher,
  startTxid: string,
  startOutputIndex: number,
  maxHops: number,
  signal: AbortSignal,
  callbacks: AutoTraceCallbacks,
): Promise<void> {
  const { identifyChangeOutput } = await import("@/lib/graph/autoTrace");
  const { dispatch, getState, onProgress, onTracingChange } = callbacks;

  onTracingChange(true);
  onProgress({ hop: 0, txid: startTxid, reason: "starting" });

  let currentTxid = startTxid;
  let currentOutputIndex = startOutputIndex;
  let currentDepth = getState().nodes.get(startTxid)?.depth ?? 0;
  let addedThisTrace = 0;

  try {
    for (let hop = 0; hop < maxHops; hop++) {
      if (signal.aborted) break;
      const state = getState();
      if (state.nodes.size + addedThisTrace >= state.maxNodes) {
        dispatch({ type: "SET_ERROR", txid: currentTxid, error: "Auto-trace stopped: max nodes reached" });
        break;
      }

      onProgress({ hop: hop + 1, txid: currentTxid, reason: "expanding" });

      // Fetch outspends to find the spending tx for this output
      let outspends: MempoolOutspend[];
      try {
        outspends = await client.getTxOutspends(currentTxid);
      } catch {
        dispatch({ type: "SET_ERROR", txid: currentTxid, error: "Auto-trace: failed to fetch outspends" });
        break;
      }

      if (signal.aborted) break;

      const os = outspends[currentOutputIndex];
      if (!os?.spent || !os.txid) {
        onProgress({ hop: hop + 1, txid: currentTxid, reason: "unspent" });
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
      if (signal.aborted) break;

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
      onProgress({ hop: hop + 1, txid: childTxid, reason: changeResult.reason });

      if (changeResult.changeOutputIndex === null) {
        // Terminal condition reached
        break;
      }

      // Continue tracing from the change output
      currentTxid = childTxid;
      currentOutputIndex = changeResult.changeOutputIndex;
    }
  } finally {
    onTracingChange(false);
    onProgress(null);
  }
}

// ─── Auto-trace with linkability (Boltzmann) ───────────────────────────

/**
 * Auto-trace forward using compounding linkability.
 * Stops when compound probability drops below threshold.
 */
export async function runAutoTraceLinkability(
  client: GraphExpansionFetcher,
  startTxid: string,
  startOutputIndex: number,
  signal: AbortSignal,
  callbacks: AutoTraceCallbacks,
  opts?: AutoTraceLinkabilityOptions,
): Promise<void> {
  const { identifyChangeOutput } = await import("@/lib/graph/autoTrace");
  const { computeBoltzmann, extractTxValues } = await import("@/lib/analysis/boltzmann-compute");
  const { dispatch, getState, onProgress, onTracingChange } = callbacks;

  const threshold = opts?.threshold ?? 0.05;
  const maxHops = opts?.maxHops ?? 10;
  const cache = opts?.boltzmannCache;

  onTracingChange(true);
  let compoundProb = 1.0;
  let currentTxid = startTxid;
  let currentOutputIndex = startOutputIndex;
  let currentDepth = getState().nodes.get(startTxid)?.depth ?? 0;
  let addedThisTrace = 0;

  try {
    for (let hop = 0; hop < maxHops; hop++) {
      if (signal.aborted) break;
      const state = getState();
      if (state.nodes.size + addedThisTrace >= state.maxNodes) break;

      onProgress({ hop: hop + 1, txid: currentTxid, reason: `compound: ${Math.round(compoundProb * 100)}%` });

      // Fetch outspends for the current tx
      let outspends: MempoolOutspend[];
      try { outspends = await client.getTxOutspends(currentTxid); } catch { break; }
      if (signal.aborted) break;

      const os = outspends[currentOutputIndex];
      if (!os?.spent || !os.txid) {
        onProgress({ hop: hop + 1, txid: currentTxid, reason: "unspent" });
        break;
      }

      const childTxid = os.txid;

      // Fetch the child tx (always fetch fresh - don't rely on stale state.nodes)
      let childTx: MempoolTransaction;
      try {
        childTx = await client.getTransaction(childTxid);
      } catch {
        dispatch({ type: "SET_ERROR", txid: childTxid, error: "Linkability trace: failed to fetch tx" });
        break;
      }
      if (signal.aborted) break;

      // Add to graph if not already there
      currentDepth++;
      dispatch({
        type: "ADD_NODE",
        node: { txid: childTxid, tx: childTx, depth: currentDepth, parentEdge: { fromTxid: currentTxid, outputIndex: currentOutputIndex } },
      });
      addedThisTrace++;
      // Small delay so the UI shows the node appearing
      await new Promise((r) => setTimeout(r, 100));
      if (signal.aborted) break;

      // Compute Boltzmann for the child tx (use cache or compute fresh)
      let boltzResult = cache?.get(childTxid);
      if (!boltzResult) {
        const { inputValues, outputValues } = extractTxValues(childTx);
        if (inputValues.length === 1) {
          // 1-input: synthetic 100% deterministic (no need for WASM)
          compoundProb *= 1.0; // doesn't change compound
        } else if (inputValues.length >= 2 && inputValues.length + outputValues.length <= 80) {
          try {
            boltzResult = await computeBoltzmann(childTx, { signal }) ?? undefined;
          } catch { /* treat as 100% worst case */ }
        }
      }
      if (signal.aborted) break;

      // Identify the change output for the next hop
      const changeResult = identifyChangeOutput(childTx);
      if (changeResult.changeOutputIndex === null) {
        onProgress({ hop: hop + 1, txid: childTxid, reason: changeResult.reason });
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

      onProgress({ hop: hop + 1, txid: childTxid, reason: `compound: ${Math.round(compoundProb * 100)}%` });

      // Check threshold
      if (compoundProb < threshold) {
        onProgress({ hop: hop + 1, txid: childTxid, reason: `below ${Math.round(threshold * 100)}% threshold` });
        break;
      }

      currentTxid = childTxid;
      currentOutputIndex = changeResult.changeOutputIndex;
    }
  } finally {
    onTracingChange(false);
    onProgress(null);
  }
}
