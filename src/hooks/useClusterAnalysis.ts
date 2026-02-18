"use client";

import { useState, useCallback, useRef } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import {
  buildFirstDegreeCluster,
  type ClusterResult,
  type ClusterProgress,
} from "@/lib/analysis/cluster/build-cluster";
import type { MempoolTransaction } from "@/lib/api/types";

export type ClusterPhase = "idle" | "analyzing" | "complete" | "error";

export interface ClusterState {
  phase: ClusterPhase;
  progress: ClusterProgress | null;
  result: ClusterResult | null;
  error: string | null;
}

const INITIAL: ClusterState = {
  phase: "idle",
  progress: null,
  result: null,
  error: null,
};

export function useClusterAnalysis() {
  const [state, setState] = useState<ClusterState>(INITIAL);
  const { config } = useNetwork();
  const abortRef = useRef<AbortController | null>(null);

  const analyze = useCallback(
    async (targetAddress: string, txs: MempoolTransaction[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ phase: "analyzing", progress: null, result: null, error: null });

      try {
        const api = createApiClient(config);
        const result = await buildFirstDegreeCluster(
          targetAddress,
          txs,
          api,
          controller.signal,
          (progress) => {
            setState((prev) => ({ ...prev, progress }));
          },
        );

        if (controller.signal.aborted) return;

        setState({ phase: "complete", progress: null, result, error: null });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          phase: "error",
          progress: null,
          result: null,
          error: err instanceof Error ? err.message : "Cluster analysis failed",
        });
      }
    },
    [config],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  return { ...state, analyze, reset };
}
