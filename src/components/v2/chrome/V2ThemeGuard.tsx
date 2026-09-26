"use client";

import { useLayoutEffect } from "react";
import { syncTheme } from "@/hooks/useTheme";

/**
 * v2 tokens must also reach portals (settings panel, modals, tooltips)
 * rendered outside the v2 subtree: mark <html> while v2 is mounted. The
 * re-sync re-renders JS-drawn colors that depend on `data-ui`.
 */
export function V2ThemeGuard() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.ui = "v2";
    syncTheme();
    return () => {
      delete root.dataset.ui;
      syncTheme();
    };
  }, []);
  return null;
}
