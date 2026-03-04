/**
 * Polyfills for AbortSignal.any() and AbortSignal.timeout().
 *
 * AbortSignal.any() requires Chrome 116+, Firefox 124+, Safari 17.4+.
 * AbortSignal.timeout() requires Chrome 103+, Firefox 100+, Safari 16.4+.
 *
 * Without these, the app is completely broken on older browsers.
 */

/** Combine multiple AbortSignals - aborts when any signal aborts. */
export function abortSignalAny(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }
  // Polyfill: create a controller that aborts when any input signal fires
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/** Sleep that respects an AbortSignal - rejects if signal fires during wait. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/** Create an AbortSignal that times out after the given milliseconds. */
export function abortSignalTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  // Polyfill: create a controller that aborts after a timeout
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("Signal timed out", "TimeoutError")), ms);
  return controller.signal;
}
