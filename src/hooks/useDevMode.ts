"use client";

import { useSyncExternalStore, useCallback } from "react";
import { createLocalStorageStore } from "./createLocalStorageStore";

const store = createLocalStorageStore<boolean>(
  "ami-dev-mode",
  false,
  (raw) => raw === "1",
  (val) => (val ? "1" : "0"),
);

export function useDevMode() {
  const devMode = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const toggleDevMode = useCallback(() => {
    const next = !store.getSnapshot();
    store.set(next);
  }, []);

  return { devMode, toggleDevMode };
}
