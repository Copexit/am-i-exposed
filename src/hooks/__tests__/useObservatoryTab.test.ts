// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { resolveObservatoryTab, useObservatoryTab } from "../useObservatoryTab";

describe("resolveObservatoryTab", () => {
  it("prefers the hash, then the stored choice, then whirlpool", () => {
    expect(resolveObservatoryTab("#wabisabi", "whirlpool")).toBe("wabisabi");
    expect(resolveObservatoryTab("#WhirlPool", "wabisabi")).toBe("whirlpool");
    expect(resolveObservatoryTab("", "wabisabi")).toBe("wabisabi");
    expect(resolveObservatoryTab("#tx=abc", "junk")).toBe("whirlpool");
    expect(resolveObservatoryTab("", null)).toBe("whirlpool");
  });
});

describe("useObservatoryTab", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/observatory/");
  });

  it("selecting a tab updates the hash and remembers it", () => {
    const { result } = renderHook(() => useObservatoryTab());
    expect(result.current[0]).toBe("whirlpool");
    act(() => result.current[1]("wabisabi"));
    expect(result.current[0]).toBe("wabisabi");
    expect(window.location.hash).toBe("#wabisabi");
    expect(window.localStorage.getItem("ami-observatory-tab")).toBe("wabisabi");
  });

  it("restores the remembered tab when the URL has no hash", () => {
    window.localStorage.setItem("ami-observatory-tab", "wabisabi");
    const { result } = renderHook(() => useObservatoryTab());
    expect(result.current[0]).toBe("wabisabi");
  });

  it("follows the hash on navigation", () => {
    const { result } = renderHook(() => useObservatoryTab());
    act(() => {
      window.location.hash = "#wabisabi";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current[0]).toBe("wabisabi");
  });
});
