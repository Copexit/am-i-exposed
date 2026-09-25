// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Mod = typeof import("../useAnalysisSettings");
let useAnalysisSettings: Mod["useAnalysisSettings"];

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules(); // fresh settings cache per test
  ({ useAnalysisSettings } = await import("../useAnalysisSettings"));
});

describe("useAnalysisSettings", () => {
  it("starts at the defaults", () => {
    const { result } = renderHook(() => useAnalysisSettings());
    expect(result.current.settings).toEqual(result.current.DEFAULTS);
  });

  it("merges a partial update, persists it, and resets to defaults", () => {
    const { result } = renderHook(() => useAnalysisSettings());
    act(() => result.current.update({ maxDepth: 9 }));
    expect(result.current.settings.maxDepth).toBe(9);
    expect(result.current.settings.minSats).toBe(result.current.DEFAULTS.minSats);
    expect(JSON.parse(localStorage.getItem("analysis-settings")!).maxDepth).toBe(9);

    act(() => result.current.reset());
    expect(result.current.settings).toEqual(result.current.DEFAULTS);
  });

  it("loads stored settings over the defaults", () => {
    localStorage.setItem("analysis-settings", JSON.stringify({ minSats: 5000 }));
    const { result } = renderHook(() => useAnalysisSettings());
    expect(result.current.settings.minSats).toBe(5000);
    expect(result.current.settings.maxDepth).toBe(result.current.DEFAULTS.maxDepth);
  });
});
