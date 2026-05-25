"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { getObservatoryEndpoints } from "@/lib/observatory/endpoints";
import { getWhirlpoolCharts, getWhirlpoolSummary } from "@/lib/observatory/whirlpool-client";
import { getLiquiSabiDashboard } from "@/lib/observatory/liquisabi-client";
import type {
  LiquiSabiDashboard,
  WhirlpoolCharts,
  WhirlpoolSummary,
} from "@/lib/observatory/types";

export interface WhirlpoolBundle {
  summary: WhirlpoolSummary;
  charts: WhirlpoolCharts;
}

export interface UseObservatoryResult {
  whirlpool: WhirlpoolBundle | null;
  liquisabi: LiquiSabiDashboard | null;
  loading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  refresh: () => void;
}

interface ObservatoryState {
  forKey: string;
  whirlpool: WhirlpoolBundle | null;
  liquisabi: LiquiSabiDashboard | null;
  error: string | null;
  lastUpdatedAt: number | null;
}

const INITIAL_STATE: ObservatoryState = {
  forKey: "",
  whirlpool: null,
  liquisabi: null,
  error: null,
  lastUpdatedAt: null,
};

/**
 * Page-level hook. Fetches the three upstream endpoints in parallel via the
 * routing chosen by NetworkContext (CF Worker on hosted, tor-proxy sidecar on
 * Umbrel). Tab-focus revalidation; no background polling.
 */
export function useObservatory(): UseObservatoryResult {
  const { isUmbrel } = useNetwork();
  const [state, setState] = useState<ObservatoryState>(INITIAL_STATE);
  const [refreshKey, setRefreshKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const currentKey = useMemo(
    () => `${isUmbrel ? "u" : "h"}:${refreshKey}`,
    [isUmbrel, refreshKey],
  );

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const endpoints = getObservatoryEndpoints({ isUmbrel });
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    let cancelled = false;

    void Promise.allSettled([
      getWhirlpoolSummary(endpoints.whirlpoolBase, controller.signal),
      getWhirlpoolCharts(endpoints.whirlpoolBase, controller.signal),
      getLiquiSabiDashboard(endpoints.liquiSabiUrl, controller.signal),
    ]).then((results) => {
      if (cancelled) return;
      const [summaryRes, chartsRes, lsRes] = results;
      const whirlpool: WhirlpoolBundle | null =
        summaryRes.status === "fulfilled" && chartsRes.status === "fulfilled"
          ? { summary: summaryRes.value, charts: chartsRes.value }
          : null;
      const liquisabi: LiquiSabiDashboard | null =
        lsRes.status === "fulfilled" ? lsRes.value : null;
      const anySuccess = whirlpool != null || liquisabi != null;
      const allFailed = results.every((r) => r.status === "rejected");
      const error = allFailed
        ? extractMessage((results[0] as PromiseRejectedResult).reason)
        : null;
      setState((prev) => ({
        forKey: currentKey,
        whirlpool,
        liquisabi,
        error,
        // Only refresh the timestamp when at least one upstream actually
        // delivered data. Otherwise keep the prior value so the UI can show
        // "stale, last fetched Xm ago" honestly.
        lastUpdatedAt: anySuccess ? Date.now() : prev.lastUpdatedAt,
      }));
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isUmbrel, currentKey]);

  useEffect(() => {
    function onFocus() {
      refresh();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const loading = state.forKey !== currentKey;

  return {
    whirlpool: state.whirlpool,
    liquisabi: state.liquisabi,
    loading,
    error: loading ? null : state.error,
    lastUpdatedAt: state.lastUpdatedAt,
    refresh,
  };
}

function extractMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}
