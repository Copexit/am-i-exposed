/**
 * SQLite-based persistent cache for CLI API responses.
 *
 * Mirrors the IndexedDB cache API (src/lib/api/idb-cache.ts) 1:1.
 * Uses better-sqlite3 for synchronous, zero-config single-file storage.
 *
 * Database: ~/.am-i-exposed/cache.sqlite
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CACHE_DIR = join(homedir(), ".am-i-exposed");
const DB_PATH = join(CACHE_DIR, "cache.sqlite");
const MAX_ENTRIES = 10_000;

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      stored_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stored_at ON cache(stored_at);
  `);

  return db;
}

/**
 * Get a cached value by key. Returns undefined if not found or expired.
 */
export function cacheGet<T>(key: string): T | undefined {
  const row = getDb()
    .prepare(
      "SELECT value FROM cache WHERE key = ? AND (expires_at = 0 OR expires_at > ?)",
    )
    .get(key, Date.now()) as { value: string } | undefined;

  if (!row) return undefined;
  return JSON.parse(row.value) as T;
}

/**
 * Store a value in the cache.
 * @param ttlMs - Time to live in ms. 0 or omitted = infinite.
 */
export function cacheSet(
  key: string,
  value: unknown,
  ttlMs?: number,
): void {
  const now = Date.now();
  const expiresAt = ttlMs ? now + ttlMs : 0;

  getDb()
    .prepare(
      "INSERT OR REPLACE INTO cache (key, value, stored_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(key, JSON.stringify(value), now, expiresAt);

  // Probabilistic eviction (5% of writes) - same pattern as idb-cache.ts
  if (Math.random() < 0.05) {
    const count = cacheCount();
    if (count > MAX_ENTRIES) {
      cacheEvict(MAX_ENTRIES);
    }
  }
}

/**
 * Delete a single entry.
 */
export function cacheDelete(key: string): void {
  getDb().prepare("DELETE FROM cache WHERE key = ?").run(key);
}

/**
 * Clear all cached entries.
 */
export function cacheClear(): void {
  getDb().exec("DELETE FROM cache");
  // Reclaim disk space
  getDb().exec("VACUUM");
}

/**
 * Count cached entries (including expired - they get cleaned lazily).
 */
export function cacheCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as cnt FROM cache")
    .get() as { cnt: number };
  return row.cnt;
}

/**
 * Evict oldest entries to bring count down to maxEntries.
 * Also purges expired entries. Returns the number of entries deleted.
 */
export function cacheEvict(maxEntries: number): number {
  const d = getDb();

  // First purge expired entries
  const purged = d
    .prepare("DELETE FROM cache WHERE expires_at > 0 AND expires_at < ?")
    .run(Date.now());
  let deleted = purged.changes;

  // If still over limit, delete oldest by stored_at
  const count = cacheCount();
  if (count > maxEntries) {
    const toDelete = count - maxEntries;
    const result = d
      .prepare(
        "DELETE FROM cache WHERE key IN (SELECT key FROM cache ORDER BY stored_at ASC LIMIT ?)",
      )
      .run(toDelete);
    deleted += result.changes;
  }

  return deleted;
}

/**
 * Get cache statistics.
 */
export function cacheStats(): {
  entries: number;
  sizeBytes: number;
  expired: number;
  oldestAt: number;
} {
  const d = getDb();
  const total = cacheCount();
  const now = Date.now();

  const expiredRow = d
    .prepare(
      "SELECT COUNT(*) as cnt FROM cache WHERE expires_at > 0 AND expires_at < ?",
    )
    .get(now) as { cnt: number };

  const oldestRow = d
    .prepare("SELECT MIN(stored_at) as oldest FROM cache")
    .get() as { oldest: number | null };

  let sizeBytes = 0;
  try {
    if (existsSync(DB_PATH)) {
      sizeBytes = statSync(DB_PATH).size;
    }
  } catch {
    // ignore
  }

  return {
    entries: total,
    sizeBytes,
    expired: expiredRow.cnt,
    oldestAt: oldestRow.oldest ?? 0,
  };
}

/**
 * Close the database connection. Call on CLI exit for clean shutdown.
 */
export function cacheClose(): void {
  if (db) {
    db.close();
    db = null;
  }
}
