/**
 * Thin cache wrapper around idb-cache for observatory responses.
 *
 * Single TTL in Phase 1 (60s). Namespace prefix prevents collision with
 * mempool/analysis cache keys.
 */

import { idbGet, idbPut } from "@/lib/api/idb-cache";

const CACHE_NAMESPACE = "observatory:";
export const DEFAULT_TTL_MS = 60_000;

export async function withObservatoryCache<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const fullKey = `${CACHE_NAMESPACE}${key}`;
  const cached = await idbGet<T>(fullKey);
  if (cached !== undefined) return cached;
  const value = await fn();
  await idbPut(fullKey, value, ttlMs);
  return value;
}

/**
 * Get the cached value if present, otherwise undefined.
 * Used by the error state to render stale data without refetching.
 */
export async function getObservatoryStale<T>(key: string): Promise<T | undefined> {
  return idbGet<T>(`${CACHE_NAMESPACE}${key}`);
}
