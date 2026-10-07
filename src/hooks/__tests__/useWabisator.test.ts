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
  it("does not stack requests while one is in flight", async () => {
    const f = vi.fn(() => new Promise<number>(() => {}));
    renderHook(() => usePolled("k", f, 1000));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("a slow fetcher (>1 interval) still lands its data", async () => {
    const f = vi.fn(() => new Promise<string>((r) => setTimeout(() => r("slow"), 1500)));
    const { result } = renderHook(() => usePolled("k", f, 1000));
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(result.current.data).toBe("slow");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("unmount aborts the in-flight signal and sets no state", async () => {
    let sig!: AbortSignal;
    let resolve!: (v: string) => void;
    const f = vi.fn((s: AbortSignal) => { sig = s; return new Promise<string>((r) => { resolve = r; }); });
    const { unmount, result } = renderHook(() => usePolled("k", f, 1000));
    unmount();
    expect(sig.aborted).toBe(true);
    await act(async () => { resolve("late"); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toBeNull();
  });
  it("is idle with a null key", async () => {
    const f = vi.fn().mockResolvedValue(1);
    const { result } = renderHook(() => usePolled(null, f, 1000));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(f).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });
});
