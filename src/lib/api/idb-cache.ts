/**
 * IndexedDB persistent cache for API responses.
 *
 * Stores confirmed transactions, outspends, address data, etc. across sessions.
 * Falls back to an in-memory Map when IndexedDB is unavailable (incognito, SSR).
 *
 * DB: "aie-cache", version 1, single object store "responses" (keyPath: "key").
 */

const DB_NAME = "aie-cache";
const DB_VERSION = 1;
const STORE_NAME = "responses";
const MAX_ENTRIES = 10_000;
/** Percentage of entries to evict when max is exceeded. */
const EVICT_RATIO = 0.2;

export interface CacheEntry {
  key: string;
  value: unknown;
  storedAt: number;
  expiresAt: number; // 0 = infinite
}

// ---------- IndexedDB helpers ----------

let dbPromise: Promise<IDBDatabase> | null = null;
let fallbackMap: Map<string, CacheEntry> | null = null;

function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  if (!idbAvailable()) {
    fallbackMap = fallbackMap ?? new Map();
    return Promise.reject(new Error("IndexedDB unavailable"));
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("storedAt", "storedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      fallbackMap = fallbackMap ?? new Map();
      reject(req.error);
    };
  });

  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// ---------- Fallback (in-memory) helpers ----------

function fallbackGet<T>(key: string): T | undefined {
  if (!fallbackMap) return undefined;
  const entry = fallbackMap.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
    fallbackMap.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function fallbackPut(key: string, value: unknown, ttlMs?: number): void {
  if (!fallbackMap) fallbackMap = new Map();
  const now = Date.now();
  fallbackMap.set(key, {
    key,
    value,
    storedAt: now,
    expiresAt: ttlMs ? now + ttlMs : 0,
  });
  // Simple eviction for in-memory fallback
  if (fallbackMap.size > MAX_ENTRIES) {
    const sorted = [...fallbackMap.entries()].sort(
      (a, b) => a[1].storedAt - b[1].storedAt,
    );
    const count = Math.ceil(fallbackMap.size * EVICT_RATIO);
    for (let i = 0; i < count; i++) {
      fallbackMap.delete(sorted[i][0]);
    }
  }
}

// ---------- Public API ----------

/**
 * Get a cached value by key. Returns undefined if not found or expired.
 */
export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const entry = await withStore<CacheEntry | undefined>(
      "readonly",
      (store) => store.get(key),
    );
    if (!entry) return undefined;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      // Expired - delete asynchronously
      idbDelete(key).catch(() => {});
      return undefined;
    }
    return entry.value as T;
  } catch {
    return fallbackGet<T>(key);
  }
}

/**
 * Store a value in the cache. Fire-and-forget by default.
 * @param ttlMs - Time to live in ms. 0 or omitted = infinite.
 */
export async function idbPut(
  key: string,
  value: unknown,
  ttlMs?: number,
): Promise<void> {
  const now = Date.now();
  const entry: CacheEntry = {
    key,
    value,
    storedAt: now,
    expiresAt: ttlMs ? now + ttlMs : 0,
  };

  try {
    await withStore("readwrite", (store) => store.put(entry));
    // Check count periodically (not every write - count is async)
    if (Math.random() < 0.05) {
      const count = await idbCount();
      if (count > MAX_ENTRIES) {
        await idbEvict(MAX_ENTRIES);
      }
    }
  } catch (err) {
    if (isQuotaError(err)) {
      // Evict 50% and retry once
      try {
        await idbEvict(Math.ceil(MAX_ENTRIES * 0.5));
        await withStore("readwrite", (store) => store.put(entry));
      } catch {
        fallbackPut(key, value, ttlMs);
      }
    } else {
      fallbackPut(key, value, ttlMs);
    }
  }
}

/**
 * Delete a single entry.
 */
export async function idbDelete(key: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(key));
  } catch {
    fallbackMap?.delete(key);
  }
}

/**
 * Clear all cached entries by deleting the entire database.
 * This leaves no forensic trace (no empty DB shell).
 */
export async function idbClear(): Promise<void> {
  // Close existing connection first
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore
    }
    dbPromise = null;
  }

  if (idbAvailable()) {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  fallbackMap?.clear();
}

/**
 * Count cached entries.
 */
export async function idbCount(): Promise<number> {
  try {
    return await withStore("readonly", (store) => store.count());
  } catch {
    return fallbackMap?.size ?? 0;
  }
}

/**
 * Evict oldest entries to bring count down to maxEntries.
 * Returns the number of entries deleted.
 */
export async function idbEvict(maxEntries: number): Promise<number> {
  try {
    const db = await openDb();
    const count = await withStore<number>("readonly", (store) => store.count());
    if (count <= maxEntries) return 0;

    const toDelete = count - maxEntries;
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("storedAt");
      const req = index.openCursor();
      let deleted = 0;

      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || deleted >= toDelete) {
          resolve(deleted);
          return;
        }
        cursor.delete();
        deleted++;
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fallback eviction
    if (fallbackMap && fallbackMap.size > maxEntries) {
      const sorted = [...fallbackMap.entries()].sort(
        (a, b) => a[1].storedAt - b[1].storedAt,
      );
      const toDelete = fallbackMap.size - maxEntries;
      for (let i = 0; i < toDelete; i++) {
        fallbackMap.delete(sorted[i][0]);
      }
      return toDelete;
    }
    return 0;
  }
}

// ---------- Internal ----------

function isQuotaError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === "QuotaExceededError" || err.code === 22;
  }
  return false;
}

/**
 * Reset internal state (for testing only).
 * Closes the existing connection and resets all state.
 */
export async function _resetForTest(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore
    }
  }
  dbPromise = null;
  fallbackMap = null;
}
