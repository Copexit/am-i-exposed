import { abortableSleep } from "@/lib/abort-signal";

/**
 * Priority-based API request queue.
 *
 * Enforces rate limits for public mempool.space (~10 req/sec) while
 * allowing unlimited throughput for local/Umbrel instances.
 * Requests are processed in priority order (lower number = higher priority).
 */

export type QueuePriority = 0 | 1 | 2 | 3;

interface QueuedRequest<T> {
  fn: () => Promise<T>;
  priority: QueuePriority;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
}

interface QueueOptions {
  /** Minimum delay between requests in ms. 0 = unlimited (local node). Default: 100 (10 req/s). */
  delayMs?: number;
  /** Maximum concurrent requests. Default: 3 for public, 10 for local. */
  concurrency?: number;
}

export function createApiQueue(options: QueueOptions = {}) {
  const delayMs = options.delayMs ?? 100;
  const maxConcurrent = options.concurrency ?? 3;

  const queue: QueuedRequest<unknown>[] = [];
  let activeCount = 0;
  let lastRequestTime = 0;
  let processing = false;

  function enqueue<T>(
    fn: () => Promise<T>,
    priority: QueuePriority = 1,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }

      const request: QueuedRequest<unknown> = {
        fn,
        priority,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal,
      };

      // Insert in priority order (stable sort: same priority = FIFO)
      let inserted = false;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].priority > priority) {
          queue.splice(i, 0, request);
          inserted = true;
          break;
        }
      }
      if (!inserted) queue.push(request);

      // Listen for abort
      signal?.addEventListener("abort", () => {
        const idx = queue.indexOf(request);
        if (idx !== -1) {
          queue.splice(idx, 1);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        }
      }, { once: true });

      processQueue();
    });
  }

  async function processQueue() {
    if (processing) return;
    processing = true;

    while (queue.length > 0 && activeCount < maxConcurrent) {
      const request = queue.shift();
      if (!request) break;

      // Skip aborted requests
      if (request.signal?.aborted) {
        request.reject(request.signal.reason ?? new DOMException("Aborted", "AbortError"));
        continue;
      }

      // Rate limit
      if (delayMs > 0) {
        const now = Date.now();
        const wait = Math.max(0, delayMs - (now - lastRequestTime));
        if (wait > 0) {
          try {
            await abortableSleep(wait, request.signal);
          } catch {
            request.reject(request.signal?.reason ?? new DOMException("Aborted", "AbortError"));
            continue;
          }
        }
        lastRequestTime = Date.now();
      }

      activeCount++;
      request.fn()
        .then((result) => {
          request.resolve(result);
        })
        .catch((error) => {
          request.reject(error);
        })
        .finally(() => {
          activeCount--;
          processQueue();
        });
    }

    processing = false;
  }

  return {
    enqueue,
    /** Number of pending requests in the queue */
    get pending() { return queue.length; },
    /** Number of currently active requests */
    get active() { return activeCount; },
    /** Clear all pending requests (does not cancel active ones) */
    clear() {
      while (queue.length > 0) {
        const req = queue.shift()!;
        req.reject(new DOMException("Queue cleared", "AbortError"));
      }
    },
  };
}

export type ApiQueue = ReturnType<typeof createApiQueue>;

/**
 * Detect if the user is on a local mempool instance (unlimited rate).
 * Local = URL starts with /, is localhost, or is an IP on private range.
 */
export function isLocalInstance(baseUrl: string): boolean {
  if (baseUrl.startsWith("/")) return true;
  try {
    const url = new URL(baseUrl);
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    // Private IP ranges
    if (host.startsWith("192.168.") || host.startsWith("10.")) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    // Umbrel .local domains
    if (host.endsWith(".local")) return true;
    return false;
  } catch {
    return false;
  }
}
