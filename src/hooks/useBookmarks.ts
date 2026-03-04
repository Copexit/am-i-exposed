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

  return { bookmarks, isBookmarked, addBookmark, removeBookmark, updateLabel, clearBookmarks };
}
