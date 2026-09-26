"use client";

import { useSyncExternalStore, useCallback, useEffect } from "react";
import { COLORS, LIGHT_COLORS, V2_COLORS, V2_LIGHT_COLORS } from "@/lib/palette";

type Theme = "dark" | "light";
/** Stored preference: "system" (key absent) follows prefers-color-scheme live. */
export type ThemePreference = "system" | Theme;

const STORAGE_KEY = "ami-theme";
const LIGHT_QUERY = "(prefers-color-scheme: light)";

let listeners: Array<() => void> = [];

function notify() {
  for (const fn of listeners) fn();
}

function readPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch { /* private browsing */ }
  return "system";
}

function systemTheme(): Theme {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(LIGHT_QUERY).matches
    ? "light"
    : "dark";
}

/** Theme to show for the stored preference. Mirrors the pre-paint script in app/layout.tsx. */
function resolvedTheme(): Theme {
  const pref = readPreference();
  return pref === "system" ? systemTheme() : pref;
}

/** Read theme from the DOM attribute (the visual ground truth). */
function domTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  // Update browser chrome color to match theme
  const meta = document.getElementById("meta-theme-color") as HTMLMetaElement | null;
  const v2 = document.documentElement.dataset.ui === "v2";
  if (meta) meta.content = (theme === "light" ? (v2 ? V2_LIGHT_COLORS : LIGHT_COLORS) : v2 ? V2_COLORS : COLORS).background;
}

/**
 * Re-apply the theme and re-render subscribers. Also used when `data-ui`
 * changes on <html>, since JS-drawn colors (SVG_COLORS) depend on it.
 */
export function syncTheme(): void {
  applyTheme(resolvedTheme());
  notify();
}

// Apply on module load (client-side) so the DOM is correct before first render,
// and follow OS theme changes while the preference is "system".
if (typeof window !== "undefined") {
  applyTheme(resolvedTheme());
  if (typeof window.matchMedia === "function") {
    window.matchMedia(LIGHT_QUERY).addEventListener?.("change", () => {
      if (readPreference() === "system") syncTheme();
    });
  }
}

function subscribe(callback: () => void): () => void {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((fn) => fn !== callback);
  };
}

const getServerTheme = (): Theme => "dark";
const getServerPreference = (): ThemePreference => "system";

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, domTheme, getServerTheme);
  const preference = useSyncExternalStore(subscribe, readPreference, getServerPreference);

  // Post-hydration sync: if React hydration removed data-theme, re-apply.
  useEffect(() => {
    if (domTheme() !== resolvedTheme()) syncTheme();
  }, []);

  const setTheme = useCallback((val: ThemePreference) => {
    try {
      if (val === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, val);
    } catch { /* */ }
    syncTheme();
  }, []);

  /** Classic toggle: switches to the explicit opposite of what is shown. */
  const toggleTheme = useCallback(() => {
    setTheme(domTheme() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { theme, preference, setTheme, toggleTheme };
}
