"use client";

import { useSyncExternalStore, useCallback, useEffect } from "react";
import { COLORS, LIGHT_COLORS } from "@/lib/palette";
import { isV2Path } from "@/lib/v2/paths";

type Theme = "dark" | "light";

const STORAGE_KEY = "ami-theme";

let listeners: Array<() => void> = [];

function notify() {
  for (const fn of listeners) fn();
}

/**
 * Theme to show: the stored preference, except in the v2 UI, which is dark
 * only. The stored preference is never changed by visiting v2.
 */
function storedTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  if (isV2Path(window.location.pathname)) return "dark";
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
    if (meta) meta.content = theme === "light" ? LIGHT_COLORS.background : COLORS.background;
  }
}

// Apply on module load (client-side) so the DOM is correct before first render
if (typeof window !== "undefined") {
  applyTheme(storedTheme());
}

/** Re-apply the theme for the current path (client-side navigation into or out of v2). */
export function syncThemeWithPath(): void {
  applyTheme(storedTheme());
  notify();
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