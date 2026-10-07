// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { usePolled } from "../useWabisator";

vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ isUmbrel: false }) }));

const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
  document.dispatchEvent(new Event("visibilitychange"));
};
beforeEach(() => { vi.useFakeTimers(); setVisibility("visible"); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("usePolled", () => {
  it("polls while visible and stops while hidden, refetching on return when stale", async () => {
    const f = vi.fn().mockResolvedValue(1);
    renderHook(() => usePolled("k", f, 1000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(f).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(f).toHaveBeenCalledTimes(3);
    act(() => setVisibility("hidden"));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(f).toHaveBeenCalledTimes(3);
    await act(async () => { setVisibility("visible"); await vi.advanceTimersByTimeAsync(0); });
    expect(f).toHaveBeenCalledTimes(4);
  });
  it("keeps data when a refresh fails", async () => {
    const f = vi.fn().mockResolvedValueOnce("ok").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePolled("k", f, 1000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toBe("ok");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.data).toBe("ok");
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.updatedAt).not.toBeNull();
  });
  it("aborts the in-flight request on key change and drops it", async () => {
    const signals: AbortSignal[] = [];
    const f = vi.fn((s: AbortSignal) => { signals.push(s); return new Promise<string>(() => {}); });
    const { rerender } = renderHook(({ k }) => usePolled(k, f, 1000), { initialProps: { k: "a" } });
    rerender({ k: "b" });
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });
  it("is idle with a null key", async () => {
    const f = vi.fn().mockResolvedValue(1);
    const { result } = renderHook(() => usePolled(null, f, 1000));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(f).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });
});
