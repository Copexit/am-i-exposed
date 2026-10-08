"use client";

import { useSyncExternalStore, useCallback, useEffect } from "react";
import { createLocalStorageStore } from "./createLocalStorageStore";
import { isLocalPayloadPrefix } from "@/lib/analysis/detect-input";
import { savedGraphStore } from "./useSavedGraphs";
import { validateSavedGraph } from "@/lib/graph/saved-graph-types";
import type { SavedGraph } from "@/lib/graph/saved-graph-types";
import { parseXpub } from "@/lib/bitcoin/descriptor";

export interface Bookmark {
  /** txid, address, or (type "wallet") the raw xpub/descriptor, stored only after an explicit opt-in */
  input: string;
  type: "txid" | "address" | "wallet";
  grade: string;
  score: number;
  /** User label (a wallet bookmark's name) */
  label?: string;
  savedAt: number;
  /** Wallet only: address type, network, and the hashed key of its saved scan */
  scriptType?: string;
  network?: string;
  snapshotKey?: string;
}

/** A wallet entry must carry a key that parses (checksum included). */
function isValidWallet(b: Bookmark): boolean {
  if (typeof b.scriptType !== "string" || typeof b.network !== "string") return false;
  if (b.snapshotKey !== undefined && !/^[0-9a-f]{64}$/.test(b.snapshotKey)) return false;
  try {
    parseXpub(b.input);
    return true;
  } catch {
    return false;
  }
}

function isValidBookmark(b: unknown): b is Bookmark {
  return (
    typeof b === "object" && b !== null &&
    typeof (b as Bookmark).input === "string" &&
    // Truncated PSBT entries saved by older versions (and imports of them) are dropped
    !isLocalPayloadPrefix((b as Bookmark).input) &&
    ((b as Bookmark).type === "txid" || (b as Bookmark).type === "address" ||
      ((b as Bookmark).type === "wallet" && isValidWallet(b as Bookmark))) &&
    typeof (b as Bookmark).grade === "string" &&
    typeof (b as Bookmark).score === "number" &&
    typeof (b as Bookmark).savedAt === "number"
  );
}

const store = createLocalStorageStore<Bookmark[]>(
  "bookmarks",
  [],
  (raw) => {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidBookmark) : [];
  },
);

/** Valid wallet entries in a list (they carry raw keys). */
const countWallets = (items: unknown[]) => items.filter((b) => isValidBookmark(b) && b.type === "wallet").length;

/** Wallet bookmarks (raw xpubs) in an import file: the UI asks before importing them. */
export function walletsInImport(json: string): number {
  try {
    const parsed: unknown = JSON.parse(json);
    const items = Array.isArray(parsed) ? parsed : (parsed as { bookmarks?: unknown } | null)?.bookmarks;
    return Array.isArray(items) ? countWallets(items) : 0;
  } catch {
    return 0;
  }
}

/** Merge entries into storage. Returns the count merged, or null when the write failed. */
function mergeBookmarks(items: unknown[], includeWallets: boolean): number | null {
  // Labels are capped as when typed (40 characters); wallet keys only after a confirmation
  const valid = items.filter(isValidBookmark).filter((b) => includeWallets || b.type !== "wallet").map((b) => (typeof b.label === "string" ? { ...b, label: b.label.slice(0, 40) } : { ...b, label: undefined }));
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
  return store.set(merged) ? count : null;
}

/** Merge entries into storage. Returns the count merged, or null when the write failed. */
function mergeGraphs(items: unknown[]): number | null {
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
  return savedGraphStore.set(merged) ? count : null;
}

export function useBookmarks() {
  // Remove entries the parser drops (truncated PSBTs saved by older versions) from storage
  useEffect(() => store.persistParsed(), []);

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

  const removeWalletBookmarks = useCallback(() => {
    store.set(store.getSnapshot().filter((b) => b.type !== "wallet"));
  }, []);

  /** Export workspace (bookmarks + saved graphs) as a single JSON file. Wallet keys only when asked. */
  const exportBookmarks = useCallback(({ includeWallets = false }: { includeWallets?: boolean } = {}) => {
    const bookmarkData = store.getSnapshot().filter((b) => includeWallets || b.type !== "wallet");
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

  /**
   * Import workspace. Handles: workspace {bookmarks,graphs}, legacy bookmark array, legacy graph export.
   * Wallet bookmarks are skipped unless `includeWallets` (after the privacy confirmation).
   */
  const importBookmarks = useCallback(
    (json: string, { includeWallets = false }: { includeWallets?: boolean } = {}): { imported: number; error?: string } => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return { imported: 0, error: "invalid_json" };
      }

      let importedCount = 0;

      const storageFull = { imported: 0, error: "storage_full" };

      // Format 1: Legacy bookmark array
      if (Array.isArray(parsed)) {
        const count = mergeBookmarks(parsed, includeWallets);
        if (count === null) return storageFull;
        if (count === 0) return { imported: 0, error: "no_valid_entries" };
        return { imported: count };
      }

      if (typeof parsed !== "object" || parsed === null) {
        return { imported: 0, error: "invalid_format" };
      }
      const obj = parsed as Record<string, unknown>;

      // Format 2: Workspace { version, bookmarks, graphs }
      if (Array.isArray(obj.bookmarks)) {
        const count = mergeBookmarks(obj.bookmarks, includeWallets);
        if (count === null) return storageFull;
        importedCount += count;
      }
      if (Array.isArray(obj.graphs)) {
        const count = mergeGraphs(obj.graphs);
        if (count === null) return storageFull;
        importedCount += count;
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

  return { bookmarks, isBookmarked, addBookmark, removeBookmark, updateLabel, clearBookmarks, removeWalletBookmarks, exportBookmarks, importBookmarks };
}
