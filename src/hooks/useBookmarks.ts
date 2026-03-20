"use client";

import { useSyncExternalStore, useCallback } from "react";
import { createLocalStorageStore } from "./createLocalStorageStore";
import { savedGraphStore } from "./useSavedGraphs";
import { validateSavedGraph } from "@/lib/graph/saved-graph-types";
import type { SavedGraph } from "@/lib/graph/saved-graph-types";

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

function isValidBookmark(b: unknown): b is Bookmark {
  return (
    typeof b === "object" && b !== null &&
    typeof (b as Bookmark).input === "string" &&
    ((b as Bookmark).type === "txid" || (b as Bookmark).type === "address") &&
    typeof (b as Bookmark).grade === "string" &&
    typeof (b as Bookmark).score === "number" &&
    typeof (b as Bookmark).savedAt === "number"
  );
}

function mergeBookmarks(items: unknown[]): number {
  const valid = items.filter(isValidBookmark);
  if (valid.length === 0) return 0;
  const existing = store.getSnapshot();
  const byInput = new Map(existing.map((b) => [b.input, b]));
  let count = 0;
  for (const entry of valid) {
    const cur = byInput.get(entry.input);
    if (!cur || entry.savedAt > cur.savedAt) {
      byInput.set(entry.input, entry);
      count++;
    }
  }
  const merged = Array.from(byInput.values()).sort((a, b) => b.savedAt - a.savedAt);
  try { store.set(merged); } catch { return 0; }
  return count;
}

function mergeGraphs(items: unknown[]): number {
  const valid = items.filter(validateSavedGraph) as SavedGraph[];
  if (valid.length === 0) return 0;
  const existing = savedGraphStore.getSnapshot();
  const byId = new Map(existing.map((g) => [g.id, g]));
  let count = 0;
  for (const entry of valid) {
    const cur = byId.get(entry.id);
    if (!cur || entry.savedAt > cur.savedAt) {
      byId.set(entry.id, entry);
      count++;
    }
  }
  const merged = Array.from(byId.values()).sort((a, b) => b.savedAt - a.savedAt);
  try { savedGraphStore.set(merged); } catch { return 0; }
  return count;
}

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

  /** Export workspace (bookmarks + saved graphs) as a single JSON file. */
  const exportBookmarks = useCallback(() => {
    const bookmarkData = store.getSnapshot();
    const graphData = savedGraphStore.getSnapshot();
    const workspace = { version: 1, bookmarks: bookmarkData, graphs: graphData };
    const json = JSON.stringify(workspace, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "am-i-exposed-workspace.json";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /** Import workspace. Handles: workspace {bookmarks,graphs}, legacy bookmark array, legacy graph export. */
  const importBookmarks = useCallback(
    (json: string): { imported: number; error?: string } => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return { imported: 0, error: "invalid_json" };
      }

      let importedCount = 0;

      // Format 1: Legacy bookmark array
      if (Array.isArray(parsed)) {
        const count = mergeBookmarks(parsed);
        if (count === 0) return { imported: 0, error: "no_valid_entries" };
        return { imported: count };
      }

      if (typeof parsed !== "object" || parsed === null) {
        return { imported: 0, error: "invalid_format" };
      }
      const obj = parsed as Record<string, unknown>;

      // Format 2: Workspace { version, bookmarks, graphs }
      if (Array.isArray(obj.bookmarks)) {
        importedCount += mergeBookmarks(obj.bookmarks);
      }
      if (Array.isArray(obj.graphs)) {
        importedCount += mergeGraphs(obj.graphs);
      }

      // Format 3: Legacy graph export { version, graphs } (no bookmarks field)
      if (importedCount === 0 && !Array.isArray(obj.bookmarks) && !Array.isArray(obj.graphs)) {
        return { imported: 0, error: "invalid_format" };
      }

      if (importedCount === 0) return { imported: 0, error: "no_valid_entries" };
      return { imported: importedCount };
    },
    [],
  );

  return { bookmarks, isBookmarked, addBookmark, removeBookmark, updateLabel, clearBookmarks, exportBookmarks, importBookmarks };
}
