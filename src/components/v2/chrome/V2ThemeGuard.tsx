"use client";

import { useLayoutEffect } from "react";
import { syncThemeWithPath } from "@/hooks/useTheme";

/**
 * v2 is dark only and its tokens must also reach portals (settings panel,
 * modals, tooltips) rendered outside the v2 subtree: mark <html> while v2 is
 * mounted, and re-sync the theme when entering or leaving v2.
 */
export function V2ThemeGuard() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.ui = "v2";
    syncThemeWithPath();
    return () => {
      delete root.dataset.ui;
      // Runs before the classic page commits; restore the stored preference.
      requestAnimationFrame(syncThemeWithPath);
    };
  }, []);
  return null;
}
