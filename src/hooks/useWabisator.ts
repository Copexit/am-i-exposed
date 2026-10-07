"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNetwork } from "@/context/NetworkContext";
import {
  getCoordinatorsStatus, getFlowMap, getRounds, getVolumeHistory, REFRESH_MS, type Period,
} from "@/lib/observatory/wabisator-client";
import type { CoordinatorsStatus, FlowMap, RoundsPage, VolumeHistory } from "@/lib/observatory/wabisator-types";

export interface Polled<T> { data: T | null; error: Error | null; loading: boolean; updatedAt: number | null; refresh: () => void }

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** Fetches on mount/key change, then every intervalMs while the tab is visible. Keeps last data on error. */
export function usePolled<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>, intervalMs: number): Polled<T> {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: Error | null; loading: boolean; updatedAt: number | null }>(
    { key, data: null, error: null, loading: key !== null, updatedAt: null },
  );
  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; });
  const runRef = useRef<() => void>(() => {});

  // Reset during render on key change so stale data from another key never shows.
  if (state.key !== key) setState({ key, data: null, error: null, loading: key !== null, updatedAt: null });

  useEffect(() => {
    if (key === null) return;
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let last = 0;
    let disposed = false;

    const run = () => {
      ctrl?.abort();
      const c = (ctrl = new AbortController());
      last = Date.now();
      fetcherRef.current(c.signal).then(
        (data) => { if (!c.signal.aborted && !disposed) setState((s) => ({ ...s, data, error: null, loading: false, updatedAt: Date.now() })); },
        (e: unknown) => { if (!c.signal.aborted && !disposed) setState((s) => ({ ...s, error: e instanceof Error ? e : new Error(String(e)), loading: false })); },
      );
    };
    const start = () => { if (timer === undefined) timer = setInterval(run, intervalMs); };
    const stop = () => { clearInterval(timer); timer = undefined; };
    const onVis = () => {
      if (!visible()) return stop();
      if (Date.now() - last >= intervalMs) run();
      start();
    };

    runRef.current = run;
    run();
    if (visible()) start();
    document.addEventListener("visibilitychange", onVis);
    return () => { disposed = true; ctrl?.abort(); stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [key, intervalMs]);

  const refresh = useCallback(() => runRef.current(), []);
  return { data: state.key === key ? state.data : null, error: state.error, loading: state.loading, updatedAt: state.updatedAt, refresh };
}

export function useFlowMap(period: Period): Polled<FlowMap> {
  const { isUmbrel } = useNetwork();
  return usePolled(`flow:${period}:${isUmbrel}`, (signal) => getFlowMap(period, { isUmbrel, signal }), REFRESH_MS.flowMap[period]);
}

export function useCoordinatorsStatus(): Polled<CoordinatorsStatus> {
  const { isUmbrel } = useNetwork();
  return usePolled(`status:${isUmbrel}`, (signal) => getCoordinatorsStatus({ isUmbrel, signal }), REFRESH_MS.status);
}

export function useVolumeHistory(): Polled<VolumeHistory> {
  const { isUmbrel } = useNetwork();
  return usePolled(`volume:${isUmbrel}`, (signal) => getVolumeHistory({ isUmbrel, signal }), REFRESH_MS.volume);
}

export function useRounds(coordinator: string | null, page: number): Polled<RoundsPage> {
  const { isUmbrel } = useNetwork();
  return usePolled(coordinator === null ? null : `rounds:${coordinator}:${page}:${isUmbrel}`, (signal) => getRounds(coordinator ?? "", page, { isUmbrel, signal }), REFRESH_MS.rounds);
}
