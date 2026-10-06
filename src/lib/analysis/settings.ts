/**
 * Analysis settings: type, defaults, and a plain localStorage-backed store.
 * Framework-free so src/lib and the CLI can use it; the React hook in
 * src/hooks/useAnalysisSettings.ts is a thin wrapper over this store.
 */

export interface AnalysisSettings {
  /** Maximum chain analysis depth in hops (1-50, default 4) */
  maxDepth: number;
  /** Minimum satoshi threshold to stop tracing (default 1000) */
  minSats: number;
  /** Skip large clusters during analysis */
  skipLargeClusters: boolean;
  /** Skip batching/CoinJoin transactions during chain tracing */
  skipCoinJoins: boolean;
  /** Analysis timeout in seconds (1-600, default 30) */
  timeout: number;
  /** Wallet scan gap limit: consecutive unused addresses before stopping (1-1000, default 5) */
  walletGapLimit: number;
  /** Persist API cache in IndexedDB across sessions (default true) */
  enableCache: boolean;
  /** Boltzmann WASM computation timeout in seconds (10-600, default 300) */
  boltzmannTimeout: number;
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  maxDepth: 4,
  minSats: 1000,
  skipLargeClusters: false,
  skipCoinJoins: false,
  timeout: 30,
  walletGapLimit: 5,
  enableCache: true,
  boltzmannTimeout: 300,
};

export const MAX_GAP_LIMIT = 1000;

/** Clamp to an integer in 1..MAX_GAP_LIMIT; non-numbers fall back to the default. */
export function clampGapLimit(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_GAP_LIMIT, Math.max(1, v)) : DEFAULT_ANALYSIS_SETTINGS.walletGapLimit;
}

/** Slider steps for the gap limit (slider index -> value). */
export const GAP_LIMIT_STEPS = [1, 2, 3, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000] as const;

/** Index of the step nearest to a gap limit (display only). */
export function gapLimitToStep(limit: number): number {
  let best = 0;
  let bestDist = Infinity;
  GAP_LIMIT_STEPS.forEach((s, i) => {
    if (Math.abs(s - limit) < bestDist) { best = i; bestDist = Math.abs(s - limit); }
  });
  return best;
}

export function stepToGapLimit(index: number): number {
  return GAP_LIMIT_STEPS[Math.min(GAP_LIMIT_STEPS.length - 1, Math.max(0, Math.round(index)))] as number;
}

const STORAGE_KEY = "analysis-settings";

// Typed structurally: the CLI compiles this file without the DOM lib.
type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const browserStorage = () =>
  (globalThis as { window?: { localStorage: KeyValueStorage } }).window?.localStorage;

// Module-level cache for referential stability (useSyncExternalStore requirement)
let cachedSettings: AnalysisSettings | null = null;
const listeners = new Set<() => void>();

/** Current settings (defaults outside the browser, e.g. CLI and tests). */
export function getAnalysisSettings(): AnalysisSettings {
  if (cachedSettings) return cachedSettings;
  const storage = browserStorage();
  if (!storage) return DEFAULT_ANALYSIS_SETTINGS;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    cachedSettings = raw
      ? { ...DEFAULT_ANALYSIS_SETTINGS, ...JSON.parse(raw) }
      : DEFAULT_ANALYSIS_SETTINGS;
    cachedSettings = { ...cachedSettings!, walletGapLimit: clampGapLimit(cachedSettings!.walletGapLimit) };
  } catch {
    cachedSettings = DEFAULT_ANALYSIS_SETTINGS;
  }
  return cachedSettings!;
}

export function subscribeAnalysisSettings(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function saveAnalysisSettings(settings: AnalysisSettings): void {
  cachedSettings = settings;
  try {
    browserStorage()?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage full or unavailable
  }
  for (const cb of listeners) cb();
}
