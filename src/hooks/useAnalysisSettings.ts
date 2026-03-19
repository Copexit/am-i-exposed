"use client";

import { useSyncExternalStore, useCallback } from "react";

export interface AnalysisSettings {
  /** Maximum chain analysis depth in hops (1-50, default 6) */
  maxDepth: number;
  /** Minimum satoshi threshold to stop tracing (default 1000) */
  minSats: number;
  /** Skip large clusters during analysis */
  skipLargeClusters: boolean;
  /** Skip batching/CoinJoin transactions during chain tracing */
  skipCoinJoins: boolean;
  /** Analysis timeout in seconds (1-600, default 10) */
  timeout: number;
  /** Wallet scan gap limit: consecutive unused addresses before stopping (1-100, default 5) */
  walletGapLimit: number;
  /** Persist API cache in IndexedDB across sessions (default true) */
  enableCache: boolean;
  /** Boltzmann WASM computation timeout in seconds (10-600, default 300) */
  boltzmannTimeout: number;
}

const STORAGE_KEY = "analysis-settings";

const DEFAULTS: AnalysisSettings = {
  maxDepth: 4,
  minSats: 1000,
  skipLargeClusters: false,
  skipCoinJoins: false,
  timeout: 30,
  walletGapLimit: 5,
  enableCache: true,
  boltzmannTimeout: 300,
};

// Module-level cache for referential stability (useSyncExternalStore requirement)
let cachedSettings: AnalysisSettings | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): AnalysisSettings {
  if (cachedSettings) return cachedSettings;
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      cachedSettings = { ...DEFAULTS, ...parsed };
    } else {
      cachedSettings = DEFAULTS;
    }
  } catch {
    cachedSettings = DEFAULTS;
  }
  return cachedSettings!;
}

function getServerSnapshot(): AnalysisSettings {
  return DEFAULTS;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function persist(settings: AnalysisSettings): void {
  cachedSettings = settings;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage full or unavailable
  }
  for (const cb of listeners) cb();
}

export function useAnalysisSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const update = useCallback((partial: Partial<AnalysisSettings>) => {
    const current = getSnapshot();
    persist({ ...current, ...partial });
  }, []);

  const reset = useCallback(() => {
    persist(DEFAULTS);
  }, []);

  return { settings, update, reset, DEFAULTS };
}

/** Get current settings without React hook (for use in analysis code). */
export function getAnalysisSettings(): AnalysisSettings {
  return getSnapshot();
}
