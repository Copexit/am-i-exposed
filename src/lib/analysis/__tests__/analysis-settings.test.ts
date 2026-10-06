import { describe, it, expect, vi } from "vitest";
import { DEFAULT_ANALYSIS_SETTINGS, getAnalysisSettings, clampGapLimit, gapLimitToStep, stepToGapLimit } from "@/lib/analysis/settings";

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

  it("clamps the gap limit to 1..1000", () => {
    expect(clampGapLimit(1000)).toBe(1000);
    expect(clampGapLimit(1001)).toBe(1000);
    expect(clampGapLimit(0)).toBe(1);
    expect(clampGapLimit("abc")).toBe(5);
  });

  it("clamps a stored gap limit on load", async () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => JSON.stringify({ walletGapLimit: 5000 }), setItem: () => {} },
    });
    vi.resetModules();
    try {
      expect((await import("@/lib/analysis/settings")).getAnalysisSettings().walletGapLimit).toBe(1000);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps slider steps to gap limits and back (nearest step for unknown values)", () => {
    expect(stepToGapLimit(0)).toBe(1);
    expect(stepToGapLimit(16)).toBe(1000);
    expect(stepToGapLimit(99)).toBe(1000);
    expect(gapLimitToStep(20)).toBe(6);
    expect(gapLimitToStep(1000)).toBe(16);
    expect(gapLimitToStep(250)).toBe(gapLimitToStep(200));
    expect(gapLimitToStep(4)).toBe(gapLimitToStep(3));
  });
});
