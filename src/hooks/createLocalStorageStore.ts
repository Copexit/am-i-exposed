/**
 * Factory for creating a localStorage-backed store compatible with
 * React's useSyncExternalStore. Handles caching for referential
 * stability, storage event subscriptions, and SSR-safe snapshots.
 */
export function createLocalStorageStore<T>(
  key: string,
  defaultValue: T,
  parse: (raw: string) => T = JSON.parse,
  serialize: (val: T) => string = JSON.stringify,
) {
  let cachedRaw: string | null = null;
  let cachedValue: T = defaultValue;

  function getSnapshot(): T {
    try {
      const stored = localStorage.getItem(key) ?? "";
      if (stored === cachedRaw) return cachedValue;
      cachedRaw = stored;
      cachedValue = stored ? parse(stored) : defaultValue;
      return cachedValue;
    } catch {
      return defaultValue;
    }
  }

  function getServerSnapshot(): T {
    return defaultValue;
  }

  function subscribe(callback: () => void): () => void {
    window.addEventListener("storage", callback);
    return () => window.removeEventListener("storage", callback);
  }

  function set(value: T): void {
    try {
      const serialized = serialize(value);
      localStorage.setItem(key, serialized);
    } catch {
      /* storage full / private browsing */
    }
    cachedRaw = null; // invalidate cache so next getSnapshot reads fresh
    cachedValue = value;
    window.dispatchEvent(new StorageEvent("storage"));
  }

  function remove(): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* private browsing */
    }
    cachedRaw = "";
    cachedValue = defaultValue;
    window.dispatchEvent(new StorageEvent("storage"));
  }

  return { getSnapshot, getServerSnapshot, subscribe, set, remove };
}
