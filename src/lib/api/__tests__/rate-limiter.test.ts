import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "../rate-limiter";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes function immediately on first call", async () => {
    const limiter = createRateLimiter(200);
    const fn = vi.fn().mockResolvedValue("result");

    const promise = limiter(fn);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe("result");
  });

  it("enforces delay between sequential calls", async () => {
    const limiter = createRateLimiter(100);
    const calls: number[] = [];

    // First call - immediate
    const p1 = limiter(async () => {
      calls.push(Date.now());
      return 1;
    });
    await vi.runAllTimersAsync();
    await p1;

    // Second call - should be delayed
    const p2 = limiter(async () => {
      calls.push(Date.now());
      return 2;
    });
    await vi.runAllTimersAsync();
    await p2;

    expect(calls).toHaveLength(2);
    expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(100);
  });

  it("throws immediately if signal already aborted", async () => {
    const limiter = createRateLimiter(200);
    const controller = new AbortController();
    controller.abort();

    await expect(
      limiter(() => Promise.resolve("nope"), controller.signal),
    ).rejects.toThrow();
  });

  it("uses default delay of 200ms", () => {
    // Just verify it can be created without arguments
    const limiter = createRateLimiter();
    expect(limiter).toBeTypeOf("function");
  });

  it("returns the result of the wrapped function", async () => {
    const limiter = createRateLimiter(0);
    const result = await limiter(async () => ({ data: 42 }));
    expect(result).toEqual({ data: 42 });
  });

  it("propagates errors from the wrapped function", async () => {
    const limiter = createRateLimiter(0);
    await expect(
      limiter(async () => { throw new Error("boom"); }),
    ).rejects.toThrow("boom");
  });
});
