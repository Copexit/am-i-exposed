"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { computeBoltzmann } from "@/lib/analysis/boltzmann-compute";
import { detectJoinMarketForTurbo, isPoolBusy } from "@/lib/analysis/boltzmann-pool";
import type { BoltzmannWorkerResult, BoltzmannProgress } from "@/lib/analysis/boltzmann-pool";
import type { MempoolTransaction } from "@/lib/api/types";
import type { GraphNode } from "@/hooks/useGraphExpansion";
import { getBoltzmannEligibility, extractTxValues } from "@/lib/analysis/boltzmann-eligibility";
import { expandMatrixToTx } from "@/lib/analysis/boltzmann-detection";

interface UseGraphBoltzmannParams {
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  rootBoltzmannResult?: BoltzmannWorkerResult | null;
  /**
   * Suspend the eager loop, e.g. while a linkability auto-trace runs: any
   * computeBoltzmann call preempts the one in flight, so both cannot share the pool.
   */
  paused?: boolean;
}

interface UseGraphBoltzmannReturn {
  getBoltzmannResult: (txid: string) => BoltzmannWorkerResult | undefined;
  triggerBoltzmann: (txid: string) => Promise<void>;
  /** Txids with a WASM compute in flight. */
  computingBoltzmann: Set<string>;
  boltzmannProgressMap: Map<string, number>;
  /** The raw cache map, for passing to components that expect Map<string, BoltzmannWorkerResult>. */
  boltzmannCache: Map<string, BoltzmannWorkerResult>;
}

/** Graph explorer size cap for Boltzmann (smaller than the single-tx heatmap's). */
const GRAPH_MAX_TOTAL = 80;

/**
 * Build a synthetic Boltzmann result for 1-input txs (trivially 100% deterministic),
 * indexed by raw tx position like computed results.
 */
export function buildSyntheticResult(tx: MempoolTransaction): BoltzmannWorkerResult {
  return expandMatrixToTx(buildSyntheticCompact(tx), tx);
}

function buildSyntheticCompact(tx: MempoolTransaction): BoltzmannWorkerResult {
  const { inputValues, outputValues } = extractTxValues(tx);
  const nIn = inputValues.length;
  const nOut = outputValues.length;
  // 1 input -> every output is 100% linked to it
  const matProb = Array.from({ length: nOut }, () => Array.from({ length: nIn }, () => 1));
  const matComb = Array.from({ length: nOut }, () => Array.from({ length: nIn }, () => 1));
  const detLinks: [number, number][] = Array.from({ length: nOut }, (_, oi) => [oi, 0] as [number, number]);
  return {
    type: "result", id: tx.txid,
    matLnkCombinations: matComb, matLnkProbabilities: matProb,
    nbCmbn: 1, entropy: 0, efficiency: 0, nbCmbnPrfctCj: 1,
    deterministicLinks: detLinks, timedOut: false, elapsedMs: 0,
    nInputs: nIn, nOutputs: nOut,
    fees: tx.fee, intraFeesMaker: 0, intraFeesTaker: 0,
  };
}

/**
 * How the graph gets a tx's Boltzmann matrix: synthetic (1 input), eager
 * background compute (small, or small JoinMarket), the sidebar's manual
 * button, or not at all.
 */
export function graphBoltzmannMode(tx: MempoolTransaction): "synthetic" | "auto-compute" | "manual-button" | "ineligible" {
  const { canCompute, inputValues, outputValues } = getBoltzmannEligibility(tx, GRAPH_MAX_TOTAL);
  if (!canCompute) return "ineligible";
  if (inputValues.length === 1) return "synthetic";
  const total = inputValues.length + outputValues.length;
  if (total < 18) return "auto-compute";
  if (total < 24 && detectJoinMarketForTurbo(inputValues, outputValues).isJoinMarket) return "auto-compute";
  return "manual-button";
}

export function useGraphBoltzmann({
  nodes,
  rootTxid,
  rootBoltzmannResult,
  paused = false,
}: UseGraphBoltzmannParams): UseGraphBoltzmannReturn {
  // The refs are the working sets the async compute loop checks; the state
  // copies are what renders. Every write updates both, outside render.
  const boltzmannCacheRef = useRef<Map<string, BoltzmannWorkerResult>>(new Map());
  const [computedCache, setComputedCache] = useState<Map<string, BoltzmannWorkerResult>>(() => new Map());
  const computingBoltzmannRef = useRef<Set<string>>(new Set());
  const [computingBoltzmann, setComputingBoltzmann] = useState<Set<string>>(() => new Set());
  const [boltzmannProgressMap, setBoltzmannProgressMap] = useState<Map<string, number>>(new Map());
  /** Bumped to re-run the eager loop without a graph change (pool went idle, manual compute done). */
  const [eagerRetry, setEagerRetry] = useState(0);

  // Abort controller for the current computation cycle
  const boltzmannAbortRef = useRef<AbortController | null>(null);

  const cacheResult = useCallback((txid: string, result: BoltzmannWorkerResult) => {
    boltzmannCacheRef.current.set(txid, result);
    setComputedCache(new Map(boltzmannCacheRef.current));
  }, []);

  const setComputing = useCallback((txid: string, computing: boolean) => {
    if (computing) computingBoltzmannRef.current.add(txid);
    else computingBoltzmannRef.current.delete(txid);
    setComputingBoltzmann(new Set(computingBoltzmannRef.current));
  }, []);

  // Seed the working cache with the root result so the eager loop skips the
  // root. Renders read the root result from props (see boltzmannCache below).
  useEffect(() => {
    if (rootBoltzmannResult && rootTxid) boltzmannCacheRef.current.set(rootTxid, rootBoltzmannResult);
  }, [rootBoltzmannResult, rootTxid]);

  /** Compute Boltzmann for a specific txid (1-input txs come from the synthetic cache). */
  const computeSingleBoltzmann = useCallback(async (txid: string, signal?: AbortSignal): Promise<void> => {
    if (boltzmannCacheRef.current.has(txid)) return;
    const node = nodes.get(txid);
    if (!node) return;

    const tx = node.tx;
    const mode = graphBoltzmannMode(tx);
    if (mode !== "auto-compute" && mode !== "manual-button") return;
    if (signal?.aborted) return;

    setComputing(txid, true);
    try {
      const result = await computeBoltzmann(tx, {
        signal,
        onProgress: (p: BoltzmannProgress) => {
          if (!signal?.aborted) {
            setBoltzmannProgressMap((prev) => new Map(prev).set(txid, p.fraction));
          }
        },
      });
      if (result && !signal?.aborted) cacheResult(txid, result);
    } catch { /* computation failed or aborted - not critical */ }
    setComputing(txid, false);
    setBoltzmannProgressMap((prev) => { const next = new Map(prev); next.delete(txid); return next; });
  }, [nodes, cacheResult, setComputing]);

  /** Manual trigger (sidebar button). Uses a fresh AbortController. */
  const triggerBoltzmann = useCallback(async (txid: string) => {
    // Abort any in-flight computation to free the worker pool
    boltzmannAbortRef.current?.abort();
    const ac = new AbortController();
    boltzmannAbortRef.current = ac;
    await computeSingleBoltzmann(txid, ac.signal);
    // The abort above also stopped the eager loop: resume it
    if (!ac.signal.aborted) setEagerRetry((n) => n + 1);
  }, [computeSingleBoltzmann]);

  // 1-input txs are trivially deterministic: derive their results from the graph.
  const syntheticCache = useMemo(() => {
    const synthetic = new Map<string, BoltzmannWorkerResult>();
    for (const [txid, node] of nodes) {
      if (graphBoltzmannMode(node.tx) === "synthetic") synthetic.set(txid, buildSyntheticResult(node.tx));
    }
    return synthetic;
  }, [nodes]);

  // Eagerly compute Boltzmann for the multi-input nodes whenever the graph changes.
  // Debounced by 300ms so rapid node additions (e.g. auto-trace) don't cause WASM churn.
  useEffect(() => {
    if (paused) return;
    let idlePoll: ReturnType<typeof setTimeout> | undefined;
    // ponytail: polls isPoolBusy(); an idle event from boltzmann-pool would avoid the timer
    const retryWhenIdle = () => {
      idlePoll = setTimeout(() => (isPoolBusy() ? retryWhenIdle() : setEagerRetry((n) => n + 1)), 500);
    };
    const debounceTimer = setTimeout(() => {
      // Abort previous computation cycle before starting a new one
      boltzmannAbortRef.current?.abort();
      const ac = new AbortController();
      boltzmannAbortRef.current = ac;

      // Build queue of eligible txids (snapshot - stable across the async loop)
      const queue: Array<{ txid: string; tx: MempoolTransaction }> = [];
      for (const [txid, node] of nodes) {
        if (boltzmannCacheRef.current.has(txid)) continue;
        if (computingBoltzmannRef.current.has(txid)) continue;
        if (graphBoltzmannMode(node.tx) !== "auto-compute") continue;
        queue.push({ txid, tx: node.tx });
      }

      // Process queue sequentially with abort signal
      if (queue.length > 0) {
        // Fire-and-forget: the callee catches its own errors.
        void (async () => {
          for (const { txid } of queue) {
            if (ac.signal.aborted) break;
            // Yield to any other job on the shared pool (heatmap, pipeline):
            // starting a compute would preempt it. Retry once the pool is idle.
            if (isPoolBusy()) { retryWhenIdle(); break; }
            await computeSingleBoltzmann(txid, ac.signal);
          }
        })();
      }
    }, 300);

    return () => {
      clearTimeout(debounceTimer);
      clearTimeout(idlePoll);
      boltzmannAbortRef.current?.abort();
    };
  }, [nodes, computeSingleBoltzmann, paused, eagerRetry]);

  const boltzmannCache = useMemo(() => {
    const merged = new Map([...syntheticCache, ...computedCache]);
    if (rootBoltzmannResult && rootTxid) merged.set(rootTxid, rootBoltzmannResult);
    return merged;
  }, [syntheticCache, computedCache, rootBoltzmannResult, rootTxid]);

  /** Get Boltzmann result for a txid (reads the render-safe snapshot). */
  const getBoltzmannResult = useCallback(
    (txid: string): BoltzmannWorkerResult | undefined => boltzmannCache.get(txid),
    [boltzmannCache],
  );

  return {
    getBoltzmannResult,
    triggerBoltzmann,
    computingBoltzmann,
    boltzmannProgressMap,
    boltzmannCache,
  };
}
