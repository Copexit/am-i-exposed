// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCustomApi } from "../useCustomApi";

const KEY = "ami-custom-api-url";

beforeEach(() => localStorage.clear());

describe("useCustomApi", () => {
  it("defaults to null, then stores and clears a URL", () => {
    const { result } = renderHook(() => useCustomApi());
    expect(result.current.customUrl).toBeNull();

    act(() => result.current.setCustomUrl("http://umbrel.local:3006/api"));
    expect(result.current.customUrl).toBe("http://umbrel.local:3006/api");
    expect(localStorage.getItem(KEY)).toBe("http://umbrel.local:3006/api");

    act(() => result.current.setCustomUrl(null));
    expect(result.current.customUrl).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("rejects non-http(s) URLs, both when set and when stored", () => {
    const { result } = renderHook(() => useCustomApi());
    act(() => result.current.setCustomUrl("javascript:alert(1)"));
    expect(result.current.customUrl).toBeNull();

    localStorage.setItem(KEY, "data:text/html,x");
    const { result: fresh } = renderHook(() => useCustomApi());
    expect(fresh.current.customUrl).toBeNull();
  });
});
