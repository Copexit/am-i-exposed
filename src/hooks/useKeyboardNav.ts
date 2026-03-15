"use client";

import { useEffect, useRef } from "react";

interface KeyboardNavOptions {
  onBack?: () => void;
  onFocusSearch?: () => void;
}

/**
 * Global keyboard navigation:
 * - Backspace: go back to search
 * - / or Ctrl+K: focus search input
 *
 * Uses refs to avoid re-attaching the event listener on every render.
 */
export function useKeyboardNav({
  onBack,
  onFocusSearch,
}: KeyboardNavOptions) {
  const onBackRef = useRef(onBack);
  const onFocusSearchRef = useRef(onFocusSearch);

  useEffect(() => {
    onBackRef.current = onBack;
    onFocusSearchRef.current = onFocusSearch;
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Escape is NOT handled here - reserved for component-level actions
      // (e.g. closing fullscreen overlays) to avoid conflicts.
      if (e.key === "Escape") return;

      // Don't interfere with typing in inputs
      if (isInput) return;

      // / or Ctrl+K: focus search
      if (e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        onFocusSearchRef.current?.();
        return;
      }

      // Backspace: go back (only when no interactive element is focused)
      if (e.key === "Backspace" && document.activeElement === document.body) {
        e.preventDefault();
        onBackRef.current?.();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
