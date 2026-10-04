"use client";

import { useSyncExternalStore, useCallback } from "react";
import { createLocalStorageStore } from "./createLocalStorageStore";
import { isLocalPayloadPrefix } from "@/lib/analysis/detect-input";

export interface RecentScan {
  input: string;
  type: "txid" | "address";
  grade: string;
  score: number;
  timestamp: number;
}

const MAX_RECENT = 5;

const store = createLocalStorageStore<RecentScan[]>(
  "recent-scans",
  [],
  (raw) => {
    const parsed: unknown = JSON.parse(raw);
    // Drop truncated PSBT entries saved by older versions
    return Array.isArray(parsed)
      ? parsed.filter((s: RecentScan) => typeof s?.input === "string" && !isLocalPayloadPrefix(s.input))
      : [];
  },
);

export function useRecentScans() {
  const scans = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const addScan = useCallback(
    (scan: Omit<RecentScan, "timestamp">) => {
      const existing = store.getSnapshot();

      // Remove duplicate if exists
      const filtered = existing.filter((s) => s.input !== scan.input);

      const updated = [
        { ...scan, timestamp: Date.now() },
        ...filtered,
      ].slice(0, MAX_RECENT);

      store.set(updated);
    },
    [],
  );

  const clearScans = useCallback(() => {
    store.remove();
  }, []);

  return { scans, addScan, clearScans };
}
