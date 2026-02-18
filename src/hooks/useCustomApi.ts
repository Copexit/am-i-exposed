"use client";

import { useSyncExternalStore, useCallback } from "react";

const STORAGE_KEY = "ami-custom-api-url";

let cachedUrl: string | null = null;
let cachedRaw = "";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? "";
    if (stored === cachedRaw) return cachedUrl;
    cachedRaw = stored;
    cachedUrl = stored || null;
    return cachedUrl;
  } catch {
    return null;
  }
}

function getServerSnapshot(): string | null {
  return null;
}

export function useCustomApi() {
  const customUrl = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setCustomUrl = useCallback((url: string | null) => {
    if (url) {
      localStorage.setItem(STORAGE_KEY, url);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    cachedRaw = url ?? "";
    cachedUrl = url;
    window.dispatchEvent(new StorageEvent("storage"));
  }, []);

  return { customUrl, setCustomUrl };
}
