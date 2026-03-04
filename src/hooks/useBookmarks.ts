"use client";

import { useSyncExternalStore, useCallback } from "react";

export interface Bookmark {
  input: string;
  type: "txid" | "address";
  grade: string;
  score: number;
  label?: string;
  savedAt: number;
}

const STORAGE_KEY = "bookmarks";

// Cache to ensure referential stability for useSyncExternalStore
let cachedJson = "";
let cachedBookmarks: Bookmark[] = [];
const EMPTY: Bookmark[] = [];

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): Bookmark[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? "";
    if (stored === cachedJson) return cachedBookmarks;
    cachedJson = stored;
    const parsed = stored ? JSON.parse(stored) : [];
    cachedBookmarks = Array.isArray(parsed) ? parsed : [];
    return cachedBookmarks;
  } catch {
    return EMPTY;
  }
}

function getServerSnapshot(): Bookmark[] {
  return EMPTY;
}

export function useBookmarks() {
  const bookmarks = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const isBookmarked = useCallback(
    (input: string) => bookmarks.some((b) => b.input === input),
    [bookmarks],
  );

  const addBookmark = useCallback(
    (bookmark: Omit<Bookmark, "savedAt">) => {
      const existing = getSnapshot();
      // Remove duplicate if exists
      const filtered = existing.filter((b) => b.input !== bookmark.input);
      const updated = [{ ...bookmark, savedAt: Date.now() }, ...filtered];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch { /* storage full / private browsing */ }
      window.dispatchEvent(new StorageEvent("storage"));
    },
    [],
  );

  const removeBookmark = useCallback((input: string) => {
    const existing = getSnapshot();
    const updated = existing.filter((b) => b.input !== input);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch { /* storage full / private browsing */ }
    window.dispatchEvent(new StorageEvent("storage"));
  }, []);

  const updateLabel = useCallback((input: string, label: string) => {
    const existing = getSnapshot();
    const updated = existing.map((b) =>
      b.input === input ? { ...b, label: label || undefined } : b,
    );
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch { /* storage full / private browsing */ }
    window.dispatchEvent(new StorageEvent("storage"));
  }, []);

  const clearBookmarks = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* private browsing */ }
    cachedJson = "";
    cachedBookmarks = [];
    window.dispatchEvent(new StorageEvent("storage"));
  }, []);

  const exportBookmarks = useCallback(() => {
    const data = getSnapshot();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "am-i-exposed-bookmarks.json";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const importBookmarks = useCallback(
    (json: string): { imported: number; error?: string } => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return { imported: 0, error: "invalid_json" };
      }
      if (!Array.isArray(parsed)) return { imported: 0, error: "invalid_format" };

      const valid = parsed.filter(
        (b): b is Bookmark =>
          typeof b === "object" &&
          b !== null &&
          typeof b.input === "string" &&
          (b.type === "txid" || b.type === "address") &&
          typeof b.grade === "string" &&
          typeof b.score === "number" &&
          typeof b.savedAt === "number",
      );
      if (valid.length === 0) return { imported: 0, error: "no_valid_entries" };

      const existing = getSnapshot();
      const byInput = new Map(existing.map((b) => [b.input, b]));
      let importedCount = 0;
      for (const entry of valid) {
        const cur = byInput.get(entry.input);
        if (!cur || entry.savedAt > cur.savedAt) {
          byInput.set(entry.input, entry);
          importedCount++;
        }
      }
      const merged = Array.from(byInput.values()).sort(
        (a, b) => b.savedAt - a.savedAt,
      );
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {
        return { imported: 0, error: "storage_full" };
      }
      window.dispatchEvent(new StorageEvent("storage"));
      return { imported: importedCount };
    },
    [],
  );

  return { bookmarks, isBookmarked, addBookmark, removeBookmark, updateLabel, clearBookmarks, exportBookmarks, importBookmarks };
}
