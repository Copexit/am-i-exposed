import { abortableSleep } from "@/lib/abort-signal";

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
      await abortableSleep(wait, signal);
    }
    lastCall = Date.now();
    return fn();
  };
}
