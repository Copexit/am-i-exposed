import { abortSignalAny, abortSignalTimeout, abortableSleep } from "@/lib/abort-signal";

export class ApiError extends Error {
  constructor(
    public code: "NOT_FOUND" | "RATE_LIMITED" | "API_UNAVAILABLE" | "NETWORK_ERROR" | "INVALID_INPUT",
    message?: string,
    /** HTTP status when the backend answered with an error response. */
    public status?: number,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000] as const;
/** Per-request timeout - prevents individual fetch attempts hanging on Tor */
const REQUEST_TIMEOUT_MS = 15_000;

interface FetchRetryOptions extends RequestInit {
  /** Per-attempt timeout in ms. Defaults to 15_000. */
  timeoutMs?: number;
}

const sleep = abortableSleep;

/** Backoff before retry `attempt`; attempts past the table reuse the longest delay. */
function retryDelay(attempt: number): number {
  return RETRY_DELAYS[attempt] ?? RETRY_DELAYS[2];
}

export async function fetchWithRetry(
  url: string,
  options?: FetchRetryOptions,
): Promise<Response> {
  const perAttemptTimeout = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const timeoutSignal = abortSignalTimeout(perAttemptTimeout);
      const fetchSignal = options?.signal
        ? abortSignalAny([options.signal, timeoutSignal])
        : timeoutSignal;
      const response = await fetch(url, { ...options, signal: fetchSignal });

      if (response.ok) return response;

      if (response.status === 404) {
        throw new ApiError("NOT_FOUND", "Not found");
      }
      // 429 rate limit: retry with backoff (reading Retry-After if available)
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get("Retry-After");
        const parsed = retryAfter ? parseInt(retryAfter, 10) : NaN;
        const delay = !isNaN(parsed)
          ? Math.min(parsed * 1000, 10_000)
          : retryDelay(attempt);
        await sleep(delay, options?.signal ?? undefined);
        continue;
      }
      if (response.status === 429) {
        throw new ApiError("RATE_LIMITED", "API rate limit reached. Try again in a moment.");
      }

      // 5xx: retry
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(retryDelay(attempt), options?.signal ?? undefined);
        continue;
      }

      throw new ApiError("API_UNAVAILABLE", `HTTP ${response.status}`, response.status);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options?.signal?.aborted) throw error;
      // A per-attempt timeout is final: retrying would send a slow backend the
      // same heavy query again and multiply the wait (60s per attempt on Umbrel).
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ApiError("NETWORK_ERROR", "Request timed out");
      }

      if (attempt < MAX_RETRIES) {
        await sleep(retryDelay(attempt), options?.signal ?? undefined);
        continue;
      }
    }
  }

  throw new ApiError("NETWORK_ERROR", "Network request failed");
}
