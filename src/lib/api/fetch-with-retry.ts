export class ApiError extends Error {
  constructor(
    public code: "NOT_FOUND" | "RATE_LIMITED" | "API_UNAVAILABLE" | "NETWORK_ERROR",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) return response;

      if (response.status === 404) {
        throw new ApiError("NOT_FOUND", `Not found: ${url}`);
      }
      if (response.status === 429) {
        throw new ApiError("RATE_LIMITED", "API rate limit reached. Try again in a moment.");
      }

      // 5xx: retry
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }

      throw new ApiError("API_UNAVAILABLE", `HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof ApiError) throw error;

      lastError = error as Error;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }
    }
  }

  throw new ApiError("NETWORK_ERROR", lastError?.message);
}
