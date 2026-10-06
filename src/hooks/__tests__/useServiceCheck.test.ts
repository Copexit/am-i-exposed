// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ isUmbrel: false }) }));
const lookupTx = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/wabisabi-attribution", async (orig) => ({ ...(await orig<object>()), lookupTx }));
import { useServiceCheck } from "../useServiceCheck";

const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
afterEach(() => { cleanup(); lookupTx.mockReset(); });

describe("useServiceCheck", () => {
  it("does nothing until start, then checks all txids and summarizes", async () => {
    lookupTx.mockImplementation(async (txid: string) => ({ kind: "none", txid }));
    const { result } = renderHook(() => useServiceCheck([A, B, C], () => false));
    expect(lookupTx).not.toHaveBeenCalled();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.done).toBe(3);
    expect(result.current.summary?.checked).toBe(3);
  });
  it("one failure does not stop the batch; retryFailed re-runs only failures", async () => {
    lookupTx.mockImplementation(async (txid: string) => (txid === B ? { kind: "error", txid, message: "x" } : { kind: "none", txid }));
    const { result } = renderHook(() => useServiceCheck([A, B, C], () => false));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.summary?.failed).toBe(1);
    lookupTx.mockClear();
    lookupTx.mockImplementation(async (txid: string) => ({ kind: "none", txid }));
    act(() => result.current.retryFailed());
    await waitFor(() => expect(result.current.summary?.failed).toBe(0));
    expect(lookupTx).toHaveBeenCalledTimes(1);
    expect(lookupTx.mock.calls[0]![0]).toBe(B);
  });
  it("a new txid set aborts and resets, dropping late results", async () => {
    let resolveLate: (v: unknown) => void = () => {};
    lookupTx.mockImplementation((txid: string) => new Promise((r) => { if (txid === A) resolveLate = r; else r({ kind: "none", txid }); }));
    const { result, rerender } = renderHook(({ ids }) => useServiceCheck(ids, () => false), { initialProps: { ids: [A] } });
    act(() => result.current.start());
    rerender({ ids: [B] });
    expect(result.current.phase).toBe("idle");
    resolveLate({ kind: "none", txid: A });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.results).toEqual([]);
  });
  it("aborts the in-flight lookup's signal on a new txid set and on unmount", () => {
    const signals: AbortSignal[] = [];
    lookupTx.mockImplementation((_txid: string, ctx: { signal: AbortSignal }) => { signals.push(ctx.signal); return new Promise(() => {}); });
    const { result, rerender, unmount } = renderHook(({ ids }) => useServiceCheck(ids, () => false), { initialProps: { ids: [A] } });
    act(() => result.current.start());
    return waitFor(() => expect(signals).toHaveLength(1)).then(() => {
      expect(signals[0]!.aborted).toBe(false);
      rerender({ ids: [B] });
      expect(signals[0]!.aborted).toBe(true);
      act(() => result.current.start());
      return waitFor(() => expect(signals).toHaveLength(2)).then(() => {
        unmount();
        expect(signals[1]!.aborted).toBe(true);
      });
    });
  });
  it("returning to an aborted txid set shows the consent state again", () => {
    lookupTx.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ ids }) => useServiceCheck(ids, () => false), { initialProps: { ids: [A] } });
    act(() => result.current.start());
    expect(result.current.phase).toBe("running");
    rerender({ ids: [B] });
    rerender({ ids: [A] });
    expect(result.current.phase).toBe("idle");
    expect(result.current.results).toEqual([]);
  });
  it("returning to a completed txid set shows the consent state again", async () => {
    lookupTx.mockImplementation(async (txid: string) => ({ kind: "none", txid }));
    const { result, rerender } = renderHook(({ ids }) => useServiceCheck(ids, () => false), { initialProps: { ids: [A] } });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("done"));
    rerender({ ids: [B] });
    rerender({ ids: [A] });
    expect(result.current.phase).toBe("idle");
    expect(result.current.results).toEqual([]);
  });
});
