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
  /** Stable code (translated by the UI): change reason, "compound", "below-threshold", ... */
  reason: string;
  /** Percentage for "compound" (current probability) and "below-threshold" (the threshold). */
  percent?: number;
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

// ─── Shared hop step ───────────────────────────────────────────────────

/** Why a hop could not advance: unspent output, fetch failure (SET_ERROR sent), or abort. */
type HopStop = "unspent" | "fetch-failed" | "aborted";

/**
 * Follow `currentTxid:outputIndex` one hop forward: find the spending tx via
 * outspends, fetch it, add it to the graph at `depth`, and pause briefly so
 * the UI shows the node appearing. Fetch failures dispatch SET_ERROR.
 */
async function advanceHop(
  client: GraphExpansionFetcher,
  currentTxid: string,
  outputIndex: number,
  depth: number,
  signal: AbortSignal,
  dispatch: (action: GraphAction) => void,
  label: string,
): Promise<{ childTxid: string; childTx: MempoolTransaction } | { stop: HopStop }> {
  let outspends: MempoolOutspend[];
  try {
    outspends = await client.getTxOutspends(currentTxid);
  } catch {
    dispatch({ type: "SET_ERROR", txid: currentTxid, error: `${label}: failed to fetch outspends` });
    return { stop: "fetch-failed" };
  }
  if (signal.aborted) return { stop: "aborted" };

  const os = outspends[outputIndex];
  if (!os?.spent || !os.txid) return { stop: "unspent" };
  const childTxid = os.txid;

  // Always fetch the child tx fresh (don't rely on stale graph state)
  let childTx: MempoolTransaction;
  try {
    childTx = await client.getTransaction(childTxid);
  } catch (err) {
    dispatch({ type: "SET_ERROR", txid: childTxid, error: `${label}: ${err instanceof Error ? err.message : "fetch failed"}` });
    return { stop: "fetch-failed" };
  }
  if (signal.aborted) return { stop: "aborted" };

  dispatch({
    type: "ADD_NODE",
    node: { txid: childTxid, tx: childTx, depth, parentEdge: { fromTxid: currentTxid, outputIndex } },
  });
  await new Promise((r) => setTimeout(r, 80));
  if (signal.aborted) return { stop: "aborted" };
  return { childTxid, childTx };
}

// ─── Auto-trace (peel chain following) ─────────────────────────────────

/**
 * Auto-trace forward from a specific output, following the most likely
 * change output at each hop (peel chain following).
 * Resolves with why the trace stopped (null when aborted).
 */
export async function runAutoTrace(
  client: GraphExpansionFetcher,
  startTxid: string,
  startOutputIndex: number,
  maxHops: number,
  signal: AbortSignal,
  callbacks: AutoTraceCallbacks,
): Promise<string | null> {
  const { identifyChangeOutput } = await import("@/lib/graph/autoTrace");
  const { dispatch, getState, onProgress, onTracingChange } = callbacks;

  onTracingChange(true);
  onProgress({ hop: 0, txid: startTxid, reason: "starting" });

  let currentTxid = startTxid;
  let currentOutputIndex = startOutputIndex;
  let currentDepth = getState().nodes.get(startTxid)?.depth ?? 0;
  let addedThisTrace = 0;
  let stopReason: string | null = "max-hops";

  try {
    for (let hop = 0; hop < maxHops; hop++) {
      if (signal.aborted) { stopReason = null; break; }
      const state = getState();
      if (state.nodes.size + addedThisTrace >= state.maxNodes) {
        dispatch({ type: "SET_ERROR", txid: currentTxid, error: "Auto-trace stopped: max nodes reached" });
        stopReason = "max-nodes";
        break;
      }

      onProgress({ hop: hop + 1, txid: currentTxid, reason: "expanding" });

      const step = await advanceHop(client, currentTxid, currentOutputIndex, currentDepth + 1, signal, dispatch, "Auto-trace");
      if ("stop" in step) {
        if (step.stop === "unspent") onProgress({ hop: hop + 1, txid: currentTxid, reason: "unspent" });
        stopReason = step.stop === "aborted" ? null : step.stop;
        break;
      }
      const { childTxid, childTx } = step;
      currentDepth++;
      addedThisTrace++;

      // Analyze the freshly fetched tx directly (not from stale state)
      const changeResult = identifyChangeOutput(childTx);
      onProgress({ hop: hop + 1, txid: childTxid, reason: changeResult.reason });

      if (changeResult.changeOutputIndex === null) {
        // Terminal condition reached
        stopReason = changeResult.reason;
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
  return signal.aborted ? null : stopReason;
}

// ─── Auto-trace with linkability (Boltzmann) ───────────────────────────

/**
 * Auto-trace forward using compounding linkability.
 * Stops when compound probability drops below threshold.
 * Resolves with why the trace stopped (null when aborted).
 */
export async function runAutoTraceLinkability(
  client: GraphExpansionFetcher,
  startTxid: string,
  startOutputIndex: number,
  signal: AbortSignal,
  callbacks: AutoTraceCallbacks,
  opts?: AutoTraceLinkabilityOptions,
): Promise<string | null> {
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
  let stopReason: string | null = "max-hops";

  try {
    for (let hop = 0; hop < maxHops; hop++) {
      if (signal.aborted) { stopReason = null; break; }
      const state = getState();
      if (state.nodes.size + addedThisTrace >= state.maxNodes) {
        stopReason = "max-nodes";
        break;
      }

      onProgress({ hop: hop + 1, txid: currentTxid, reason: "compound", percent: Math.round(compoundProb * 100) });

      const step = await advanceHop(client, currentTxid, currentOutputIndex, currentDepth + 1, signal, dispatch, "Linkability trace");
      if ("stop" in step) {
        if (step.stop === "unspent") onProgress({ hop: hop + 1, txid: currentTxid, reason: "unspent" });
        stopReason = step.stop === "aborted" ? null : step.stop;
        break;
      }
      const { childTxid, childTx } = step;
      currentDepth++;
      addedThisTrace++;

      // Compute Boltzmann for the child tx (use cache or compute fresh)
      let boltzResult = cache?.get(childTxid);
      // 1-input txs are trivially 100% linked (no WASM needed); anything else
      // needs a matrix, and a hop without one (too large, preempted, failed)
      // has unknown linkability.
      let singleInput = false;
      if (!boltzResult) {
        const { inputValues, outputValues } = extractTxValues(childTx);
        singleInput = inputValues.length === 1;
        if (inputValues.length >= 2 && inputValues.length + outputValues.length <= 80) {
          try {
            boltzResult = await computeBoltzmann(childTx, { signal }) ?? undefined;
            // Share the result so later consumers (graph heat map) do not recompute it
            if (boltzResult) cache?.set(childTxid, boltzResult);
          } catch { /* unknown linkability, handled below */ }
        }
      }
      if (signal.aborted) { stopReason = null; break; }

      // Identify the change output for the next hop
      const changeResult = identifyChangeOutput(childTx);
      if (changeResult.changeOutputIndex === null) {
        onProgress({ hop: hop + 1, txid: childTxid, reason: changeResult.reason });
        stopReason = changeResult.reason;
        break;
      }

      // Unknown linkability: stop rather than silently compounding it as 100%
      if (!singleInput && !boltzResult?.matLnkProbabilities) {
        onProgress({ hop: hop + 1, txid: childTxid, reason: "linkability-unknown" });
        stopReason = "linkability-unknown";
        break;
      }

      // Compute the linkability: P(change output | spending input) for this hop
      if (boltzResult?.matLnkProbabilities) {
        const mat = boltzResult.matLnkProbabilities;
        const spendingInputIdx = childTx.vin.findIndex(
          (v) => v.txid === currentTxid && v.vout === currentOutputIndex,
        );
        const linkProb = mat[changeResult.changeOutputIndex]?.[spendingInputIdx];
        if (spendingInputIdx >= 0 && linkProb !== undefined) {
          compoundProb *= linkProb;
        }
      }

      onProgress({ hop: hop + 1, txid: childTxid, reason: "compound", percent: Math.round(compoundProb * 100) });

      // Check threshold
      if (compoundProb < threshold) {
        stopReason = "below-threshold";
        onProgress({ hop: hop + 1, txid: childTxid, reason: stopReason, percent: Math.round(threshold * 100) });
        break;
      }

      currentTxid = childTxid;
      currentOutputIndex = changeResult.changeOutputIndex;
    }
  } finally {
    onTracingChange(false);
    onProgress(null);
  }
  return signal.aborted ? null : stopReason;
}
