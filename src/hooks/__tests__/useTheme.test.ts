// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Mod = typeof import("../useTheme");
const load = async (): Promise<Mod["useTheme"]> => (await import("../useTheme")).useTheme;

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.resetModules(); // the module applies the stored theme on load
});

describe("useTheme", () => {
  it("defaults to dark and toggles to light, persisting and applying it", async () => {
    const useTheme = await load();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");

    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("ami-theme")).toBe("light");

    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("ami-theme")).toBe("dark");
  });

  it("applies a stored light theme", async () => {
    localStorage.setItem("ami-theme", "light");
    const useTheme = await load();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });

  it("re-applies the stored theme when the DOM attribute was lost", async () => {
    localStorage.setItem("ami-theme", "light");
    const useTheme = await load();
    delete document.documentElement.dataset.theme; // e.g. removed by hydration
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
