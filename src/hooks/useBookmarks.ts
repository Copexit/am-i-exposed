"use client";

import { useSyncExternalStore, useCallback } from "react";
import { createLocalStorageStore } from "./createLocalStorageStore";

export interface Bookmark {
  input: string;
  type: "txid" | "address";
  grade: string;
  score: number;
  label?: string;
  savedAt: number;
}

const store = createLocalStorageStore<Bookmark[]>(
  "bookmarks",
  [],
  (raw) => {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  },
);

export function useBookmarks() {
  const bookmarks = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const isBookmarked = useCallback(
    (input: string) => bookmarks.some((b) => b.input === input),
    [bookmarks],
  );

  const addBookmark = useCallback(
    (bookmark: Omit<Bookmark, "savedAt">) => {
      const existing = store.getSnapshot();
      // Remove duplicate if exists
      const filtered = existing.filter((b) => b.input !== bookmark.input);
      const updated = [{ ...bookmark, savedAt: Date.now() }, ...filtered];
      store.set(updated);
    },
    [],
  );

  const removeBookmark = useCallback((input: string) => {
    const existing = store.getSnapshot();
    const updated = existing.filter((b) => b.input !== input);
    store.set(updated);
  }, []);

  const updateLabel = useCallback((input: string, label: string) => {
    const existing = store.getSnapshot();
    const updated = existing.map((b) =>
      b.input === input ? { ...b, label: label || undefined } : b,
    );
    store.set(updated);
  }, []);

  const clearBookmarks = useCallback(() => {
    store.remove();
  }, []);

  const exportBookmarks = useCallback(() => {
    const data = store.getSnapshot();
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

      const existing = store.getSnapshot();
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
        store.set(merged);
      } catch {
        return { imported: 0, error: "storage_full" };
      }
      return { imported: importedCount };
    },
    [],
  );

  return { bookmarks, isBookmarked, addBookmark, removeBookmark, updateLabel, clearBookmarks, exportBookmarks, importBookmarks };
}
