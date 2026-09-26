/**
 * Cached mempool client wrapper.
 *
 * Wraps a MempoolClient with transparent IndexedDB caching.
 * Returns the same interface so consumers need zero code changes.
 * Keys and TTLs live in cache-policy.ts (shared with the CLI).
 */

import { createMempoolClient, type MempoolClient, type MempoolClientOptions } from "./mempool";
import { idbGet, idbPut } from "./idb-cache";
import { cacheKeyPrefix, withCachePolicy, type WithCache } from "./cache-policy";
import { getAnalysisSettings } from "@/lib/analysis/settings";

/**
 * Cache-or-fetch helper. Checks IDB cache first (if caching is enabled),
 * falls back to the fetch function, then stores the result with the given TTL.
 * The ttlFn receives the fetched value so TTL can adapt to the data.
 */
const withIdbCache: WithCache = async (key, fn, ttlFn) => {
  const { enableCache } = getAnalysisSettings();
  if (enableCache) {
    const cached = await idbGet<Awaited<ReturnType<typeof fn>>>(key);
    if (cached !== undefined) return cached;
  }

  const value = await fn();
  if (enableCache) {
    const ttl = ttlFn ? ttlFn(value) : undefined;
    // Negative TTL signals "don't cache this result"
    if (ttl === undefined || ttl >= 0) {
      idbPut(key, value, ttl).catch((e) => console.warn("cache write failed:", e));
    }
  }
  return value;
};

/**
 * Create a MempoolClient with transparent IndexedDB caching.
 * All methods have the same signature as the base MempoolClient.
 */
export function createCachedMempoolClient(
  baseUrl: string,
  network?: string,
  options?: MempoolClientOptions,
): MempoolClient {
  return withCachePolicy(
    createMempoolClient(baseUrl, options),
    cacheKeyPrefix(baseUrl, network),
    withIdbCache,
  );
}
