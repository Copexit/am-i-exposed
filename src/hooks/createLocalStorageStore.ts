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
    let stored: string;
    try {
      stored = localStorage.getItem(key) ?? "";
    } catch {
      return defaultValue;
    }
    if (stored === cachedRaw) return cachedValue;
    cachedRaw = stored;
    try {
      cachedValue = stored ? parse(stored) : defaultValue;
    } catch {
      // Corrupt data: cache the default so consecutive snapshots agree
      cachedValue = defaultValue;
    }
    return cachedValue;
  }

  function getServerSnapshot(): T {
    return defaultValue;
  }

  function subscribe(callback: () => void): () => void {
    window.addEventListener("storage", callback);
    return () => window.removeEventListener("storage", callback);
  }

  /** Persist a value. Returns false (and changes nothing) when storage is full or unavailable. */
  function set(value: T): boolean {
    try {
      localStorage.setItem(key, serialize(value));
    } catch {
      return false;
    }
    cachedRaw = null; // invalidate cache so next getSnapshot reads fresh
    cachedValue = value;
    window.dispatchEvent(new StorageEvent("storage"));
    return true;
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
