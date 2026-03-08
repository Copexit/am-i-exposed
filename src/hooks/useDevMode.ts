"use client";

import { useSyncExternalStore, useCallback } from "react";

const STORAGE_KEY = "ami-dev-mode";

/** Module-level cache so getSnapshot never touches localStorage. */
let cachedValue = false;
let cacheInitialized = false;

/** Read localStorage once and populate the cache. */
function readStorage(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return cachedValue;
  }
}

function subscribe(callback: () => void) {
  // Hydrate cache on first subscribe (i.e. first mount in the browser).
  if (!cacheInitialized) {
    cachedValue = readStorage();
    cacheInitialized = true;
  }

  const handler = () => {
    cachedValue = readStorage();
    callback();
  };

  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

/** Must be fast - React calls this on every render. Returns cached value only. */
function getSnapshot(): boolean {
  return cachedValue;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useDevMode() {
  const devMode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleDevMode = useCallback(() => {
    const next = !cachedValue;
    try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* private browsing */ }
    cachedValue = next;
    window.dispatchEvent(new StorageEvent("storage"));
  }, []);

  return { devMode, toggleDevMode };
}
