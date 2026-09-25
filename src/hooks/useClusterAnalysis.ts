"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { mapApiErrorMessage } from "@/lib/api/error-message";
import { NETWORK_CONFIG } from "@/lib/bitcoin/networks";
import {
  buildFirstDegreeCluster,
  type ClusterResult,
  type ClusterProgress,
} from "@/lib/analysis/cluster/build-cluster";
import type { MempoolTransaction } from "@/lib/api/types";

type ClusterPhase = "idle" | "analyzing" | "complete" | "error";

interface ClusterState {
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
  const { network, config, isUmbrel } = useNetwork();
  const { t } = useTranslation();
  const isCustomApi = config.mempoolBaseUrl !== NETWORK_CONFIG[network].mempoolBaseUrl;
  const abortRef = useRef<AbortController | null>(null);

  const analyze = useCallback(
    async (targetAddress: string, txs: MempoolTransaction[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ phase: "analyzing", progress: null, result: null, error: null });

      try {
        const api = createApiClient(config, controller.signal);
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
          error: mapApiErrorMessage(err, t, { isUmbrel, isCustomApi }).message,
        });
      }
    },
    [config, t, isUmbrel, isCustomApi],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  // Abort in-flight requests on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  return { ...state, analyze, reset };
}
