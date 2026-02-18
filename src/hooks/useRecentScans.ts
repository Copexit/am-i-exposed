"use client";

import { useSyncExternalStore, useCallback } from "react";

export interface RecentScan {
  input: string;
  type: "txid" | "address";
  grade: string;
  score: number;
  timestamp: number;
}

const STORAGE_KEY = "recent-scans";
const MAX_RECENT = 5;

// Cache to ensure referential stability for useSyncExternalStore
let cachedJson = "";
let cachedScans: RecentScan[] = [];
const EMPTY: RecentScan[] = [];

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): RecentScan[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? "";
    if (stored === cachedJson) return cachedScans;
    cachedJson = stored;
    cachedScans = stored ? JSON.parse(stored) : [];
    return cachedScans;
  } catch {
    return EMPTY;
  }
}

function getServerSnapshot(): RecentScan[] {
  return EMPTY;
}

export function useRecentScans() {
  const scans = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const addScan = useCallback(
    (scan: Omit<RecentScan, "timestamp">) => {
      const existing = getSnapshot();

      // Remove duplicate if exists
      const filtered = existing.filter((s) => s.input !== scan.input);

      const updated = [
        { ...scan, timestamp: Date.now() },
        ...filtered,
      ].slice(0, MAX_RECENT);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(new StorageEvent("storage"));
    },
    [],
  );

  const clearScans = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    cachedJson = "";
    cachedScans = [];
    window.dispatchEvent(new StorageEvent("storage"));
  }, []);

  return { scans, addScan, clearScans };
}
