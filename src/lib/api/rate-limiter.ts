/**
 * Simple rate limiter that enforces a minimum delay between sequential calls.
 * Used for H14 cluster analysis which makes many API calls.
 * Accepts an optional AbortSignal to cancel pending delays.
 */
export function createRateLimiter(delayMs: number = 200) {
  let lastCall = 0;

  return async function throttle<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const now = Date.now();
    const wait = Math.max(0, delayMs - (now - lastCall));
    if (wait > 0) {
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason); return; }
        const timer = setTimeout(resolve, wait);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      });
    }
    lastCall = Date.now();
    return fn();
  };
}
