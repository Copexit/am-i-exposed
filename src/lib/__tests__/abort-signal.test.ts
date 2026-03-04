import { describe, it, expect, vi, afterEach } from "vitest";
import { abortSignalAny, abortSignalTimeout } from "../abort-signal";

describe("abortSignalAny (polyfill path)", () => {
  const origAny = AbortSignal.any;

  afterEach(() => {
    // Restore native if it was monkey-patched
    if (origAny) {
      AbortSignal.any = origAny;
    }
  });

  it("returns an already-aborted signal if any input is aborted", () => {
    // Force polyfill path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AbortSignal as any).any = undefined;

    const c1 = new AbortController();
    c1.abort("reason1");
    const c2 = new AbortController();

    const combined = abortSignalAny([c1.signal, c2.signal]);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe("reason1");
  });

  it("aborts when a later signal fires", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AbortSignal as any).any = undefined;

    const c1 = new AbortController();
    const c2 = new AbortController();
    const combined = abortSignalAny([c1.signal, c2.signal]);

    expect(combined.aborted).toBe(false);
    c2.abort("reason2");
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe("reason2");
  });

  it("uses native AbortSignal.any when available", () => {
    // The native should be available in the test environment (Node 20+)
    if (typeof AbortSignal.any !== "function") return;

    const c1 = new AbortController();
    const result = abortSignalAny([c1.signal]);
    expect(result.aborted).toBe(false);
    c1.abort();
    expect(result.aborted).toBe(true);
  });
});

describe("abortSignalTimeout (polyfill path)", () => {
  const origTimeout = AbortSignal.timeout;

  afterEach(() => {
    vi.useRealTimers();
    if (origTimeout) {
      AbortSignal.timeout = origTimeout;
    }
  });

  it("aborts after the specified timeout", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AbortSignal as any).timeout = undefined;
    vi.useFakeTimers();

    const signal = abortSignalTimeout(1000);
    expect(signal.aborted).toBe(false);

    vi.advanceTimersByTime(999);
    expect(signal.aborted).toBe(false);

    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
    expect(signal.reason.name).toBe("TimeoutError");
  });
});
