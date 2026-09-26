import { describe, it, expect, vi } from "vitest";
import { DEFAULT_ANALYSIS_SETTINGS, getAnalysisSettings } from "@/lib/analysis/settings";

describe("analysis settings store", () => {
  it("has the documented defaults", () => {
    expect(DEFAULT_ANALYSIS_SETTINGS).toEqual({
      maxDepth: 4,
      minSats: 1000,
      skipLargeClusters: false,
      skipCoinJoins: false,
      timeout: 30,
      walletGapLimit: 5,
      enableCache: true,
      boltzmannTimeout: 300,
    });
  });

  it("getAnalysisSettings returns the defaults outside the browser (CLI, workers)", () => {
    expect(getAnalysisSettings()).toBe(DEFAULT_ANALYSIS_SETTINGS);
  });

  it("merges stored settings over defaults and persists saves in the browser", async () => {
    const store = new Map([["analysis-settings", JSON.stringify({ maxDepth: 9 })]]);
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    });
    vi.resetModules();
    try {
      const s = await import("@/lib/analysis/settings");
      expect(s.getAnalysisSettings()).toEqual({ ...s.DEFAULT_ANALYSIS_SETTINGS, maxDepth: 9 });

      const listener = vi.fn();
      s.subscribeAnalysisSettings(listener);
      s.saveAnalysisSettings({ ...s.getAnalysisSettings(), minSats: 5000 });
      expect(listener).toHaveBeenCalledOnce();
      expect(JSON.parse(store.get("analysis-settings")!)).toMatchObject({ maxDepth: 9, minSats: 5000 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
