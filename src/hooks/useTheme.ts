"use client";

import { useSyncExternalStore, useCallback, useEffect } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "ami-theme";

let listeners: Array<() => void> = [];

function notify() {
  for (const fn of listeners) fn();
}

/** Read theme from localStorage. */
function storedTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    if (localStorage.getItem(STORAGE_KEY) === "light") return "light";
  } catch { /* private browsing */ }
  return "dark";
}

/** Read theme from the DOM attribute (the visual ground truth). */
function domTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    if (theme === "light") {
      document.documentElement.dataset.theme = "light";
    } else {
      delete document.documentElement.dataset.theme;
    }
    // Update browser chrome color to match theme
    const meta = document.getElementById("meta-theme-color") as HTMLMetaElement | null;
    if (meta) meta.content = theme === "light" ? "#f8fafc" : "#0a0a0a";
  }
}

// Apply on module load (client-side) so the DOM is correct before first render
if (typeof window !== "undefined") {
  applyTheme(storedTheme());
}

function subscribe(callback: () => void): () => void {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((fn) => fn !== callback);
  };
}

/** Snapshot reads from the DOM so it always matches the visual state. */
function getSnapshot(): Theme {
  return domTheme();
}

function getServerSnapshot(): Theme {
  return "dark";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Post-hydration sync: if React hydration removed data-theme,
  // re-apply from localStorage. This runs once after mount.
  useEffect(() => {
    const stored = storedTheme();
    if (domTheme() !== stored) {
      applyTheme(stored);
      notify();
    }
  }, []);

  const setTheme = useCallback((val: Theme) => {
    try { localStorage.setItem(STORAGE_KEY, val); } catch { /* */ }
    applyTheme(val);
    notify();
  }, []);

  const toggleTheme = useCallback(() => {
    const next = domTheme() === "dark" ? "light" : "dark";
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* */ }
    applyTheme(next);
    notify();
  }, []);

  return { theme, setTheme, toggleTheme };
}