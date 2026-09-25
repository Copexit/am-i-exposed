// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDevMode } from "../useDevMode";

beforeEach(() => localStorage.clear());

describe("useDevMode", () => {
  it("defaults to off and toggles with persistence", () => {
    const { result } = renderHook(() => useDevMode());
    expect(result.current.devMode).toBe(false);

    act(() => result.current.toggleDevMode());
    expect(result.current.devMode).toBe(true);
    expect(localStorage.getItem("ami-dev-mode")).toBe("1");

    act(() => result.current.toggleDevMode());
    expect(result.current.devMode).toBe(false);
    expect(localStorage.getItem("ami-dev-mode")).toBe("0");
  });

  it("is shared across hook instances", () => {
    const a = renderHook(() => useDevMode());
    const b = renderHook(() => useDevMode());
    act(() => a.result.current.toggleDevMode());
    expect(b.result.current.devMode).toBe(true);
  });
});
