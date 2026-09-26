// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Mod = typeof import("../useTheme");
const load = async (): Promise<Mod["useTheme"]> => (await import("../useTheme")).useTheme;

/** Stub prefers-color-scheme; returns a trigger for the change event. */
function stubOs(light: boolean) {
  const state = { light, fire: () => {} };
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return state.light; },
    addEventListener: (_: string, fn: () => void) => { state.fire = fn; },
  }));
  return state;
}

beforeEach(() => {
  vi.unstubAllGlobals();
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

  it("follows the OS live while the preference is system, and setTheme(system) clears the stored value", async () => {
    const os = stubOs(true);
    const useTheme = await load();
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    expect(result.current.theme).toBe("light");

    act(() => { os.light = false; os.fire(); });
    expect(result.current.theme).toBe("dark");

    act(() => result.current.setTheme("light"));
    act(() => { os.light = false; os.fire(); });
    expect(result.current.theme).toBe("light");
    expect(result.current.preference).toBe("light");

    act(() => result.current.setTheme("system"));
    expect(localStorage.getItem("ami-theme")).toBeNull();
    expect(result.current.preference).toBe("system");
    expect(result.current.theme).toBe("dark");
  });

  it("an explicit dark preference beats a light OS", async () => {
    stubOs(true);
    localStorage.setItem("ami-theme", "dark");
    const useTheme = await load();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
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
