import { describe, it, expect } from "vitest";
import type { AnalysisSettings } from "@/hooks/useAnalysisSettings";
import { getAnalysisSettings } from "@/hooks/useAnalysisSettings";

describe("AnalysisSettings defaults", () => {
  it("default shape has all required fields", () => {
    const defaults: AnalysisSettings = {
      maxDepth: 4,
      minSats: 1000,
      skipLargeClusters: false,
      skipCoinJoins: false,
      timeout: 30,
      walletGapLimit: 5,
      enableCache: true,
    };
    expect(defaults.maxDepth).toBe(4);
    expect(defaults.minSats).toBe(1000);
    expect(defaults.skipLargeClusters).toBe(false);
    expect(defaults.skipCoinJoins).toBe(false);
    expect(defaults.timeout).toBe(30);
    expect(defaults.walletGapLimit).toBe(5);
  });

  it("settings can be serialized to JSON", () => {
    const settings: AnalysisSettings = {
      maxDepth: 10,
      minSats: 500,
      skipLargeClusters: true,
      skipCoinJoins: true,
      timeout: 120,
      walletGapLimit: 20,
      enableCache: false,
    };
    const json = JSON.stringify(settings);
    const parsed = JSON.parse(json) as AnalysisSettings;
    expect(parsed).toEqual(settings);
  });

  it("partial settings merge with defaults correctly", () => {
    const defaults: AnalysisSettings = {
      maxDepth: 4,
      minSats: 1000,
      skipLargeClusters: false,
      skipCoinJoins: false,
      timeout: 30,
      walletGapLimit: 5,
      enableCache: true,
    };
    const partial = { maxDepth: 10 };
    const merged = { ...defaults, ...partial };
    expect(merged.maxDepth).toBe(10);
    expect(merged.minSats).toBe(1000);
    expect(merged.skipLargeClusters).toBe(false);
    expect(merged.timeout).toBe(30);
  });

  it("getAnalysisSettings returns defaults when no localStorage", () => {
    const settings = getAnalysisSettings();
    expect(settings.maxDepth).toBe(4);
    expect(settings.minSats).toBe(1000);
    expect(settings.skipLargeClusters).toBe(false);
    expect(settings.skipCoinJoins).toBe(false);
    expect(settings.timeout).toBe(30);
  });
});
