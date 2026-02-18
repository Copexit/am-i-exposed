/**
 * Simple rate limiter that enforces a minimum delay between sequential calls.
 * Used for H14 cluster analysis which makes many API calls.
 */
export function createRateLimiter(delayMs: number = 200) {
  let lastCall = 0;

  return async function throttle<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const wait = Math.max(0, delayMs - (now - lastCall));
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastCall = Date.now();
    return fn();
  };
}
