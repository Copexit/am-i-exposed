"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { createApiQueue, isLocalInstance, type QueuePriority } from "@/lib/api/queue";
import { withCache } from "@/lib/api/cache";
import type { ApiClient } from "@/lib/api/client";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";

/**
 * Analysis depth levels for progressive loading:
 * - 0: Current tx only (instant, default analysis)
 * - 1: Input provenance + output spend status (2-10 calls, <5s)
 * - 2: 2 hops backward + 1 forward (20-50 calls, <15s)
 * - 3: Full clustering (100+ calls, 30-60s with progress)
 */
export type AnalysisLevel = 0 | 1 | 2 | 3;

export interface DeepAnalysisState {
  level: AnalysisLevel;
  status: "idle" | "loading" | "complete" | "error";
  progress: number; // 0-100
  totalCalls: number;
  completedCalls: number;
  /** Parent transactions for each input (keyed by input index) */
  parentTxs: Map<number, MempoolTransaction>;
  /** Outspends for the current transaction */
  outspends: MempoolOutspend[] | null;
  /** Child transactions for each spent output (keyed by output index) */
  childTxs: Map<number, MempoolTransaction>;
  error: string | null;
}

interface UseDeepAnalysisOptions {
  client: ApiClient;
  baseUrl: string;
}

export function useDeepAnalysis({ client, baseUrl }: UseDeepAnalysisOptions) {
  const [state, setState] = useState<DeepAnalysisState>({
    level: 0,
    status: "idle",
    progress: 0,
    totalCalls: 0,
    completedCalls: 0,
    parentTxs: new Map(),
    outspends: null,
    childTxs: new Map(),
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  const isLocal = isLocalInstance(baseUrl);
  const queueRef = useRef(createApiQueue({
    delayMs: isLocal ? 0 : 100,
    concurrency: isLocal ? 10 : 3,
  }));

  // Recreate queue when baseUrl changes (different rate-limit settings)
  useEffect(() => {
    const local = isLocalInstance(baseUrl);
    queueRef.current.clear();
    queueRef.current = createApiQueue({
      delayMs: local ? 0 : 100,
      concurrency: local ? 10 : 3,
    });
  }, [baseUrl]);

  const trackProgress = useCallback((total: number) => {
    let completed = 0;
    return () => {
      completed++;
      setState((prev) => ({
        ...prev,
        completedCalls: completed,
        totalCalls: total,
        progress: Math.round((completed / total) * 100),
      }));
    };
  }, []);

  const runLevel1 = useCallback(async (
    tx: MempoolTransaction,
    signal: AbortSignal,
  ) => {
    const queue = queueRef.current;
    const nonCoinbase = tx.vin.filter((v) => !v.is_coinbase);
    const totalCalls = nonCoinbase.length + 1; // parent txs + outspends
    const tick = trackProgress(totalCalls);

    const parentTxs = new Map<number, MempoolTransaction>();
    const outspends: MempoolOutspend[] = [];

    // Fetch parent transactions (priority 1)
    const parentPromises = nonCoinbase.map((vin) => {
      const inputIdx = tx.vin.indexOf(vin);
      return queue.enqueue(
        () => withCache(`tx:${vin.txid}`, () => client.getTransaction(vin.txid)),
        1 as QueuePriority,
        signal,
      ).then((parentTx) => {
        parentTxs.set(inputIdx, parentTx);
        tick();
      });
    });

    // Fetch outspends (priority 1)
    const outspendPromise = queue.enqueue(
      () => withCache(`outspend:${tx.txid}`, () => client.getTxOutspends(tx.txid)),
      1 as QueuePriority,
      signal,
    ).then((result) => {
      outspends.push(...result);
      tick();
    });

    await Promise.all([...parentPromises, outspendPromise]);

    return { parentTxs, outspends };
  }, [client, trackProgress]);

  const runLevel2 = useCallback(async (
    tx: MempoolTransaction,
    level1ParentTxs: Map<number, MempoolTransaction>,
    level1Outspends: MempoolOutspend[],
    signal: AbortSignal,
  ) => {
    const queue = queueRef.current;
    const childTxs = new Map<number, MempoolTransaction>();

    // Estimate total calls: grandparent txs + child txs for spent outputs
    const spentOutputs = level1Outspends.filter((o) => o.spent);
    const grandparentCount = Array.from(level1ParentTxs.values())
      .reduce((sum, ptx) => sum + ptx.vin.filter((v) => !v.is_coinbase).length, 0);
    const totalCalls = grandparentCount + spentOutputs.length;
    const tick = trackProgress(totalCalls);

    // Fetch child transactions for spent outputs (priority 2)
    // Use original output index as key so consumers can cross-reference outspends
    const childPromises = level1Outspends.map((outspend, outputIdx) => {
      if (!outspend.spent || !outspend.txid) return Promise.resolve();
      return queue.enqueue(
        () => withCache(`tx:${outspend.txid}`, () => client.getTransaction(outspend.txid!)),
        2 as QueuePriority,
        signal,
      ).then((childTx) => {
        childTxs.set(outputIdx, childTx);
        tick();
      });
    });

    // Fetch grandparent transactions (priority 2)
    const grandparentPromises = Array.from(level1ParentTxs.values()).flatMap((ptx) =>
      ptx.vin.filter((v) => !v.is_coinbase).map((vin) =>
        queue.enqueue(
          () => withCache(`tx:${vin.txid}`, () => client.getTransaction(vin.txid)),
          2 as QueuePriority,
          signal,
        ).then(() => tick()),
      ),
    );

    await Promise.all([...childPromises, ...grandparentPromises]);

    return { childTxs };
  }, [client, trackProgress]);

  const analyze = useCallback(async (
    tx: MempoolTransaction,
    targetLevel: AnalysisLevel,
  ) => {
    // Cancel any previous analysis
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      level: targetLevel,
      status: "loading",
      progress: 0,
      totalCalls: 0,
      completedCalls: 0,
      parentTxs: new Map(),
      outspends: null,
      childTxs: new Map(),
      error: null,
    });

    try {
      if (targetLevel >= 1) {
        const { parentTxs, outspends } = await runLevel1(tx, controller.signal);
        setState((prev) => ({
          ...prev,
          parentTxs,
          outspends,
          ...(targetLevel === 1 ? { status: "complete", progress: 100 } : {}),
        }));

        if (targetLevel >= 2) {
          const { childTxs } = await runLevel2(tx, parentTxs, outspends, controller.signal);
          setState((prev) => ({
            ...prev,
            childTxs,
            status: "complete",
            progress: 100,
          }));
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : "Deep analysis failed",
      }));
    }
  }, [runLevel1, runLevel2]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    queueRef.current.clear();
    setState((prev) => ({ ...prev, status: "idle", progress: 0 }));
  }, []);

  // Abort in-flight requests and clear queue on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      queueRef.current.clear();
    };
  }, []);

  return { state, analyze, cancel };
}
