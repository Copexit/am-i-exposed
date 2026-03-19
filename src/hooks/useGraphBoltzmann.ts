"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { computeBoltzmann } from "@/lib/analysis/boltzmann-compute";
import { detectJoinMarketForTurbo } from "@/lib/analysis/boltzmann-pool";
import type { BoltzmannWorkerResult, BoltzmannProgress } from "@/lib/analysis/boltzmann-pool";
import type { MempoolTransaction } from "@/lib/api/types";
import type { GraphNode } from "@/hooks/useGraphExpansion";
import { getBoltzmannEligibility, extractTxValues } from "@/lib/analysis/boltzmann-eligibility";

interface UseGraphBoltzmannParams {
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  rootBoltzmannResult?: BoltzmannWorkerResult | null;
}

interface UseGraphBoltzmannReturn {
  getBoltzmannResult: (txid: string) => BoltzmannWorkerResult | undefined;
  triggerBoltzmann: (txid: string) => Promise<void>;
  computingBoltzmannRef: React.RefObject<Set<string>>;
  boltzmannProgressMap: Map<string, number>;
  /** The raw cache map, for passing to components that expect Map<string, BoltzmannWorkerResult>. */
  boltzmannCache: Map<string, BoltzmannWorkerResult>;
}

/** Build a synthetic Boltzmann result for 1-input txs (trivially 100% deterministic). */
function buildSyntheticResult(tx: MempoolTransaction): BoltzmannWorkerResult {
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

export function useGraphBoltzmann({
  nodes,
  rootTxid,
  rootBoltzmannResult,
}: UseGraphBoltzmannParams): UseGraphBoltzmannReturn {
  const boltzmannCacheRef = useRef<Map<string, BoltzmannWorkerResult>>(new Map());
  const [boltzmannVersion, setBoltzmannVersion] = useState(0);
  const computingBoltzmannRef = useRef<Set<string>>(new Set());
  const [_computingBoltzmannVersion, setComputingBoltzmannVersion] = useState(0);
  const [boltzmannProgressMap, setBoltzmannProgressMap] = useState<Map<string, number>>(new Map());

  // Abort controller for the current computation cycle
  const boltzmannAbortRef = useRef<AbortController | null>(null);

  // Seed cache with root Boltzmann result if available
  useEffect(() => {
    if (rootBoltzmannResult && rootTxid) {
      boltzmannCacheRef.current.set(rootTxid, rootBoltzmannResult);
      setBoltzmannVersion((v) => v + 1);
    }
  }, [rootBoltzmannResult, rootTxid]);

  /** Compute Boltzmann for a specific txid (or generate synthetic for 1-input). */
  const computeSingleBoltzmann = useCallback(async (txid: string, signal?: AbortSignal): Promise<void> => {
    if (boltzmannCacheRef.current.has(txid)) return;
    const node = nodes.get(txid);
    if (!node) return;

    const tx = node.tx;
    const eligibility = getBoltzmannEligibility(tx, 80);
    if (!eligibility.canCompute) return;

    // 1-input txs: trivially 100% deterministic, no WASM needed
    if (eligibility.inputValues.length === 1) {
      boltzmannCacheRef.current.set(txid, buildSyntheticResult(tx));
      setBoltzmannVersion((v) => v + 1);
      return;
    }

    if (signal?.aborted) return;

    computingBoltzmannRef.current.add(txid);
    setComputingBoltzmannVersion((v) => v + 1);
    try {
      const result = await computeBoltzmann(tx, {
        signal,
        onProgress: (p: BoltzmannProgress) => {
          if (!signal?.aborted) {
            setBoltzmannProgressMap((prev) => new Map(prev).set(txid, p.fraction));
          }
        },
      });
      if (result && !signal?.aborted) {
        boltzmannCacheRef.current.set(txid, result);
        setBoltzmannVersion((v) => v + 1);
      }
    } catch { /* computation failed or aborted - not critical */ }
    computingBoltzmannRef.current.delete(txid);
    setComputingBoltzmannVersion((v) => v + 1);
    setBoltzmannProgressMap((prev) => { const next = new Map(prev); next.delete(txid); return next; });
  }, [nodes]);

  /** Manual trigger (sidebar button). Uses a fresh AbortController. */
  const triggerBoltzmann = useCallback(async (txid: string) => {
    // Abort any in-flight computation to free the worker pool
    boltzmannAbortRef.current?.abort();
    const ac = new AbortController();
    boltzmannAbortRef.current = ac;
    await computeSingleBoltzmann(txid, ac.signal);
  }, [computeSingleBoltzmann]);

  // Eagerly compute Boltzmann for ALL nodes in the graph whenever the graph changes
  useEffect(() => {
    // First pass: instantly fill synthetic results for all 1-input txs
    let anyNew = false;
    for (const [txid, node] of nodes) {
      if (boltzmannCacheRef.current.has(txid)) continue;
      const tx = node.tx;
      const eligibility = getBoltzmannEligibility(tx, 80);
      if (!eligibility.canCompute) continue;
      if (eligibility.inputValues.length === 1 && eligibility.outputValues.length > 0) {
        boltzmannCacheRef.current.set(txid, buildSyntheticResult(tx));
        anyNew = true;
      }
    }
    if (anyNew) setBoltzmannVersion((v) => v + 1);

    // Second pass: async compute for auto-computable multi-input txs (sequential)
    // Abort previous computation cycle before starting a new one
    boltzmannAbortRef.current?.abort();
    const ac = new AbortController();
    boltzmannAbortRef.current = ac;

    // Build queue of eligible txids (snapshot - stable across the async loop)
    const queue: Array<{ txid: string; tx: MempoolTransaction }> = [];
    for (const [txid, node] of nodes) {
      if (boltzmannCacheRef.current.has(txid)) continue;
      if (computingBoltzmannRef.current.has(txid)) continue;

      const tx = node.tx;
      const eligibility = getBoltzmannEligibility(tx, 80);
      if (!eligibility.canCompute) continue;

      const { inputValues, outputValues } = eligibility;
      if (inputValues.length < 2) continue;
      const total = inputValues.length + outputValues.length;
      if (total >= 18) {
        if (total >= 24) continue;
        if (!detectJoinMarketForTurbo(inputValues, outputValues).isJoinMarket) continue;
      }

      queue.push({ txid, tx });
    }

    // Process queue sequentially with abort signal
    if (queue.length > 0) {
      (async () => {
        for (const { txid } of queue) {
          if (ac.signal.aborted) break;
          await computeSingleBoltzmann(txid, ac.signal);
        }
      })();
    }

    return () => { ac.abort(); };
  }, [nodes, computeSingleBoltzmann]);

  /** Get Boltzmann result for a txid (from cache or root result). */
  const getBoltzmannResult = useCallback((txid: string): BoltzmannWorkerResult | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    boltzmannVersion; // depend on version to re-read cache after updates
    return boltzmannCacheRef.current.get(txid);
  }, [boltzmannVersion]);

  // Snapshot the cache as a new Map whenever the version bumps, so consumers
  // get a render-safe value without accessing the ref during render.
  const boltzmannCache = useMemo(
    () => new Map(boltzmannCacheRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boltzmannVersion],
  );

  return {
    getBoltzmannResult,
    triggerBoltzmann,
    computingBoltzmannRef,
    boltzmannProgressMap,
    boltzmannCache,
  };
}
