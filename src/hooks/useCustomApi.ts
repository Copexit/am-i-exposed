"use client";

import { useSyncExternalStore, useCallback } from "react";
import { createLocalStorageStore } from "./createLocalStorageStore";
import { normalizeApiUrl } from "@/lib/api/normalize-api-url";

const store = createLocalStorageStore<string | null>(
  "ami-custom-api-url",
  null,
  // Validate protocol to prevent data:/javascript: URI injection from localStorage
  (raw) => (raw ? normalizeApiUrl(raw) : null),
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
      store.set(normalizeApiUrl(url));
    } else {
      store.remove();
    }
  }, []);

  return { customUrl, setCustomUrl };
}
