"use client";

import { useSyncExternalStore, useCallback } from "react";

const STORAGE_KEY = "ami-dev-mode";

let cachedValue = false;

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): boolean {
  try {
    const val = localStorage.getItem(STORAGE_KEY) === "1";
    cachedValue = val;
    return val;
  } catch {
    return cachedValue;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

export function useDevMode() {
  const devMode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleDevMode = useCallback(() => {
    const next = !getSnapshot();
    try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* private browsing */ }
    window.dispatchEvent(new StorageEvent("storage"));
  }, []);

  return { devMode, toggleDevMode };
}
