export class ApiError extends Error {
  constructor(
    public code: "NOT_FOUND" | "RATE_LIMITED" | "API_UNAVAILABLE" | "NETWORK_ERROR" | "INVALID_INPUT",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];
/** Per-request timeout - prevents individual fetch attempts hanging on Tor */
const REQUEST_TIMEOUT_MS = 15_000;

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const fetchSignal = options?.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;
      const response = await fetch(url, { ...options, signal: fetchSignal });

      if (response.ok) return response;

      if (response.status === 404) {
        throw new ApiError("NOT_FOUND", `Not found: ${url}`);
      }
      // 429 rate limit: retry with backoff (reading Retry-After if available)
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get("Retry-After");
        const parsed = retryAfter ? parseInt(retryAfter, 10) : NaN;
        const delay = !isNaN(parsed)
          ? Math.min(parsed * 1000, 10_000)
          : RETRY_DELAYS[attempt];
        await sleep(delay, options?.signal as AbortSignal | undefined);
        continue;
      }
      if (response.status === 429) {
        throw new ApiError("RATE_LIMITED", "API rate limit reached. Try again in a moment.");
      }

      // 5xx: retry
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS[attempt], options?.signal as AbortSignal | undefined);
        continue;
      }

      throw new ApiError("API_UNAVAILABLE", `HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw error;

      lastError = error as Error;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS[attempt], options?.signal as AbortSignal | undefined);
        continue;
      }
    }
  }

  throw new ApiError("NETWORK_ERROR", lastError?.message);
}
