"use client";

import { useSyncExternalStore, useCallback } from "react";
import { createLocalStorageStore } from "./createLocalStorageStore";

function isValidApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

const store = createLocalStorageStore<string | null>(
  "ami-custom-api-url",
  null,
  // Validate protocol to prevent data:/javascript: URI injection from localStorage
  (raw) => (raw && isValidApiUrl(raw) ? raw : null),
  (val) => val ?? "",
);

export function useCustomApi() {
  const customUrl = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const setCustomUrl = useCallback((url: string | null) => {
    if (url) {
      store.set(isValidApiUrl(url) ? url : null);
    } else {
      store.remove();
    }
  }, []);

  return { customUrl, setCustomUrl };
}
