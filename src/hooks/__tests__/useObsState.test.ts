// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useObsState } from "../useObsState";

describe("useObsState", () => {
  beforeEach(() => window.history.replaceState(null, "", "/observatory/"));

  it("defaults to the WabiSabi map for the last 24 h without a hash", () => {
    const { result } = renderHook(() => useObsState());
    expect(result.current[0]).toEqual({ tab: "wabisabi", period: 1, coordinator: null, tx: null, view: "map" });
  });

  it("reads a deep link and ignores malformed values", () => {
    window.history.replaceState(null, "", "/observatory/#whirlpool&period=30&tx=zz&view=table");
    const { result } = renderHook(() => useObsState());
    expect(result.current[0]).toMatchObject({ tab: "whirlpool", period: 30, tx: null, view: "table" });
  });

  it("writes patches to the hash, pushing an entry for period, tab and view", () => {
    const { result } = renderHook(() => useObsState());
    const before = window.history.length;
    act(() => result.current[1]({ period: 7 }));
    expect(window.location.hash).toBe("#wabisabi&period=7");
    expect(result.current[0].period).toBe(7);
    act(() => result.current[1]({ view: "table" }));
    expect(window.location.hash).toBe("#wabisabi&period=7&view=table");
    expect(window.history.length).toBe(before + 2);
  });

  it("replaces the entry for coordinator and tx changes", () => {
    const { result } = renderHook(() => useObsState());
    act(() => result.current[1]({ period: 7 }));
    const before = window.history.length;
    act(() => result.current[1]({ coordinator: "kruw" }));
    act(() => result.current[1]({ tx: "a".repeat(64) }));
    expect(window.location.hash).toBe(`#wabisabi&period=7&coordinator=kruw&tx=${"a".repeat(64)}`);
    expect(window.history.length).toBe(before);
    act(() => result.current[1]({ coordinator: null, tx: null }));
    expect(window.location.hash).toBe("#wabisabi&period=7");
  });

  it("restores state on back and forward", async () => {
    const { result } = renderHook(() => useObsState());
    act(() => result.current[1]({ period: 7 }));
    act(() => result.current[1]({ period: 30 }));
    act(() => window.history.back());
    await waitFor(() => expect(result.current[0].period).toBe(7));
    act(() => window.history.forward());
    await waitFor(() => expect(result.current[0].period).toBe(30));
  });
});
