/**
 * Cached mempool client for CLI.
 *
 * Same keys and TTLs as src/lib/api/cached-client.ts (both use
 * src/lib/api/cache-policy.ts), but stored in SQLite instead of IndexedDB.
 */

import {
  createMempoolClient,
  type MempoolClient,
  type MempoolClientOptions,
} from "@/lib/api/mempool";
import { cacheKeyPrefix, withCachePolicy, type WithCache } from "@/lib/api/cache-policy";
import { cacheGet, cacheSet } from "./sqlite-cache";

/**
 * Cache-or-fetch helper. Checks SQLite cache first, falls back to fetch,
 * then stores the result.
 */
const withCache: WithCache = async (key, fn, ttlFn) => {
  const cached = cacheGet<Awaited<ReturnType<typeof fn>>>(key);
  if (cached !== undefined) return cached;

  const value = await fn();
  const ttl = ttlFn ? ttlFn(value) : undefined;
  // Negative TTL signals "don't cache"
  if (ttl === undefined || ttl >= 0) {
    cacheSet(key, value, ttl);
  }
  return value;
};

/**
 * Create a MempoolClient with transparent SQLite caching.
 * Same interface as createCachedMempoolClient in cached-client.ts.
 */
export function createCachedNodeClient(
  baseUrl: string,
  network?: string,
  options?: MempoolClientOptions,
): MempoolClient {
  return withCachePolicy(createMempoolClient(baseUrl, options), cacheKeyPrefix(baseUrl, network), withCache);
}
