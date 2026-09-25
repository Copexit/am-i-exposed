"use client";

import { useSyncExternalStore, useCallback } from "react";
import { createLocalStorageStore } from "./createLocalStorageStore";
import { validateSavedGraph, type SavedGraph } from "@/lib/graph/saved-graph-types";

export const MAX_SAVED_GRAPHS = 50;

export const savedGraphStore = createLocalStorageStore<SavedGraph[]>(
  "ami-saved-graphs",
  [],
  (raw) => {
    const parsed: unknown = JSON.parse(raw);
    // Drop entries from older schemas or manual edits so they cannot crash the graph page
    return Array.isArray(parsed) ? parsed.filter(validateSavedGraph) : [];
  },
);

export function useSavedGraphs() {
  const graphs = useSyncExternalStore(
    savedGraphStore.subscribe,
    savedGraphStore.getSnapshot,
    savedGraphStore.getServerSnapshot,
  );

  /** Save a new graph. Returns the generated id, or empty string on failure. */
  const saveGraph = useCallback(
    (graph: Omit<SavedGraph, "id" | "savedAt">): string => {
      const existing = savedGraphStore.getSnapshot();
      if (existing.length >= MAX_SAVED_GRAPHS) return "";
      const id = crypto.randomUUID();
      const entry: SavedGraph = { ...graph, id, savedAt: Date.now() };
      return savedGraphStore.set([entry, ...existing]) ? id : "";
    },
    [],
  );

  /** Update an existing saved graph by id. Returns false when the write failed. */
  const updateGraph = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<SavedGraph, "name" | "nodes" | "rootTxid" | "rootTxids" | "viewTransform" | "changeOutputs">
      >,
    ): boolean => {
      const existing = savedGraphStore.getSnapshot();
      const updated = existing.map((g) =>
        g.id === id ? { ...g, ...patch, savedAt: Date.now() } : g,
      );
      return savedGraphStore.set(updated);
    },
    [],
  );

  /** Delete a saved graph by id. */
  const deleteGraph = useCallback((id: string) => {
    const existing = savedGraphStore.getSnapshot();
    savedGraphStore.set(existing.filter((g) => g.id !== id));
  }, []);

  /** Clear all saved graphs. */
  const clearAll = useCallback(() => {
    savedGraphStore.remove();
  }, []);

  return {
    graphs,
    saveGraph,
    updateGraph,
    deleteGraph,
    clearAll,
  };
}
