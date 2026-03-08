/**
 * Session-based cache for API responses.
 *
 * Caches fetched transactions and addresses in sessionStorage to avoid
 * re-fetching during graph exploration. Automatically invalidated on session end.
 *
 * Key structure: `aie:tx:{txid}` for transactions, `aie:addr:{address}` for addresses.
 */

const PREFIX = "aie:";
const MAX_ENTRIES = 500;

function storageAvailable(): boolean {
  try {
    const test = "__aie_test__";
    sessionStorage.setItem(test, "1");
    sessionStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

const hasStorage = typeof window !== "undefined" && storageAvailable();

export function cacheGet<T>(key: string): T | null {
  if (!hasStorage) return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, value: T): void {
  if (!hasStorage) return;
  try {
    // Evict oldest entries if approaching limit
    if (sessionStorage.length > MAX_ENTRIES) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k?.startsWith(PREFIX)) keysToRemove.push(k);
      }
      // Remove oldest half
      keysToRemove.slice(0, Math.floor(keysToRemove.length / 2)).forEach((k) => {
        sessionStorage.removeItem(k);
      });
    }
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or quota exceeded - silently fail
  }
}

export function cacheHas(key: string): boolean {
  if (!hasStorage) return false;
  return sessionStorage.getItem(PREFIX + key) !== null;
}

export function cacheClear(): void {
  if (!hasStorage) return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k?.startsWith(PREFIX)) keysToRemove.push(k);
  }
  keysToRemove.forEach((k) => sessionStorage.removeItem(k));
}

/**
 * Wrap an async function with session caching.
 * Returns cached result if available, otherwise calls the function and caches the result.
 */
export function withCache<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== null) return Promise.resolve(cached);

  return fn().then((result) => {
    cacheSet(key, result);
    return result;
  });
}
