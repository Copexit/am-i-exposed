"use client";

import { useSyncExternalStore, useCallback } from "react";
import { createLocalStorageStore } from "./createLocalStorageStore";

const store = createLocalStorageStore<boolean>(
  "ami-experience-mode",
  false,
  (raw) => raw === "1",
  (val) => (val ? "1" : "0"),
);

export function useExperienceMode() {
  const proMode = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const toggleMode = useCallback(() => {
    store.set(!store.getSnapshot());
  }, []);

  const setProMode = useCallback((val: boolean) => {
    store.set(val);
  }, []);

  return { proMode, toggleMode, setProMode };
}