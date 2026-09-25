// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCjLinkabilityView } from "../useCjLinkabilityView";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const flush = () => act(() => { vi.runAllTimers(); });

describe("useCjLinkabilityView", () => {
  it("auto-enables in pro mode once Boltzmann is computed for a CoinJoin", () => {
    const { result, rerender } = renderHook(
      ({ boltz }: { boltz: unknown }) => useCjLinkabilityView("q", true, true, boltz),
      { initialProps: { boltz: null as unknown } },
    );
    flush();
    expect(result.current[0]).toBe(false);

    rerender({ boltz: {} });
    flush();
    expect(result.current[0]).toBe(true);
  });

  it("resets when the query changes", () => {
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useCjLinkabilityView(q, true, true, null),
      { initialProps: { q: "a" } },
    );
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);

    rerender({ q: "b" });
    flush();
    expect(result.current[0]).toBe(false);
  });

  it("stays off in normal mode", () => {
    const { result } = renderHook(() => useCjLinkabilityView("q", true, false, {}));
    flush();
    expect(result.current[0]).toBe(false);
  });
});
