// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExperienceMode } from "../useExperienceMode";

beforeEach(() => localStorage.clear());

describe("useExperienceMode", () => {
  it("defaults to normal mode", () => {
    const { result } = renderHook(() => useExperienceMode());
    expect(result.current.proMode).toBe(false);
  });

  it("toggles and sets pro mode, persisting it", () => {
    const { result } = renderHook(() => useExperienceMode());
    act(() => result.current.toggleMode());
    expect(result.current.proMode).toBe(true);
    expect(localStorage.getItem("ami-experience-mode")).toBe("1");

    act(() => result.current.setProMode(false));
    expect(result.current.proMode).toBe(false);
    expect(localStorage.getItem("ami-experience-mode")).toBe("0");
  });

  it("reads a stored value", () => {
    localStorage.setItem("ami-experience-mode", "1");
    const { result } = renderHook(() => useExperienceMode());
    expect(result.current.proMode).toBe(true);
  });
});
