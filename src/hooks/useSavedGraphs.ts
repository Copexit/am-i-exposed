"use client";

import { useSyncExternalStore, useCallback } from "react";
import { createLocalStorageStore } from "./createLocalStorageStore";
import type { SavedGraph } from "@/lib/graph/saved-graph-types";

const MAX_SAVED_GRAPHS = 50;

export const savedGraphStore = createLocalStorageStore<SavedGraph[]>(
  "ami-saved-graphs",
  [],
  (raw) => {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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
      try {
        savedGraphStore.set([entry, ...existing]);
      } catch {
        return "";
      }
      return id;
    },
    [],
  );

  /** Update an existing saved graph by id. */
  const updateGraph = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<SavedGraph, "name" | "nodes" | "rootTxid" | "rootTxids" | "viewTransform" | "changeOutputs">
      >,
    ) => {
      const existing = savedGraphStore.getSnapshot();
      const updated = existing.map((g) =>
        g.id === id ? { ...g, ...patch, savedAt: Date.now() } : g,
      );
      savedGraphStore.set(updated);
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
