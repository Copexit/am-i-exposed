import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry, ApiError } from "../fetch-with-retry";

const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
  // AbortSignal.timeout uses internal timers that conflict with fake timers.
  // Stub it to return a never-aborting signal so tests control timing cleanly.
  vi.spyOn(AbortSignal, "timeout").mockImplementation(
    () => new AbortController().signal,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function ok(body = "ok") {
  return new Response(body, { status: 200 });
}
function notFound() {
  return new Response("", { status: 404 });
}
function rateLimited(retryAfter?: string) {
  const headers = retryAfter ? new Headers({ "Retry-After": retryAfter }) : undefined;
  return new Response("", { status: 429, headers });
}
function serverError() {
  return new Response("", { status: 500 });
}

/**
 * Capture the result/error of a promise without triggering "unhandled rejection".
 * Must be called BEFORE advancing timers so the rejection handler is attached.
 */
function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  return p.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe("fetchWithRetry", () => {
  it("returns response on first success", async () => {
    mockFetch.mockResolvedValueOnce(ok());
    const res = await fetchWithRetry("https://example.com");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws NOT_FOUND for 404 without retrying", async () => {
    mockFetch.mockResolvedValueOnce(notFound());
    const result = await settle(fetchWithRetry("https://example.com"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ApiError);
      expect((result.error as ApiError).code).toBe("NOT_FOUND");
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 then throws RATE_LIMITED after max retries", async () => {
    mockFetch.mockResolvedValue(rateLimited());
    // Attach handler BEFORE advancing timers to avoid "unhandled rejection"
    const result = settle(fetchWithRetry("https://example.com"));
    await vi.runAllTimersAsync();

    const settled = await result;
    expect(settled.ok).toBe(false);
    if (!settled.ok) {
      expect((settled.error as ApiError).code).toBe("RATE_LIMITED");
    }
    // 1 initial + 3 retries = 4 calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("retries on 500 then succeeds on second attempt", async () => {
    mockFetch
      .mockResolvedValueOnce(serverError())
      .mockResolvedValueOnce(ok());

    const result = settle(fetchWithRetry("https://example.com"));
    await vi.runAllTimersAsync();

    const settled = await result;
    expect(settled.ok).toBe(true);
    if (settled.ok) {
      expect(settled.value.status).toBe(200);
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws API_UNAVAILABLE for 5xx after all retries exhausted", async () => {
    mockFetch.mockResolvedValue(serverError());
    const result = settle(fetchWithRetry("https://example.com"));
    await vi.runAllTimersAsync();

    const settled = await result;
    expect(settled.ok).toBe(false);
    if (!settled.ok) {
      expect((settled.error as ApiError).code).toBe("API_UNAVAILABLE");
    }
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("respects pre-aborted AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    mockFetch.mockRejectedValue(new DOMException("Aborted", "AbortError"));

    const result = await settle(
      fetchWithRetry("https://example.com", { signal: controller.signal }),
    );
    expect(result.ok).toBe(false);
  });

  it("throws NETWORK_ERROR after retries on network failure", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const result = settle(fetchWithRetry("https://example.com"));
    await vi.runAllTimersAsync();

    const settled = await result;
    expect(settled.ok).toBe(false);
    if (!settled.ok) {
      expect((settled.error as ApiError).code).toBe("NETWORK_ERROR");
    }
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("uses Retry-After header for 429 delay", async () => {
    mockFetch
      .mockResolvedValueOnce(rateLimited("2"))
      .mockResolvedValueOnce(ok());

    const result = settle(fetchWithRetry("https://example.com"));
    await vi.runAllTimersAsync();

    const settled = await result;
    expect(settled.ok).toBe(true);
    if (settled.ok) {
      expect(settled.value.status).toBe(200);
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
