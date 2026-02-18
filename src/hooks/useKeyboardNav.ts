"use client";

import { useEffect } from "react";

interface KeyboardNavOptions {
  onBack?: () => void;
  onSubmit?: () => void;
  onFocusSearch?: () => void;
}

/**
 * Global keyboard navigation:
 * - Escape / Backspace: go back to search
 * - / or Ctrl+K: focus search input
 * - j/k or Arrow Down/Up: scroll findings
 */
export function useKeyboardNav({
  onBack,
  onSubmit,
  onFocusSearch,
}: KeyboardNavOptions) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Escape: always go back
      if (e.key === "Escape") {
        e.preventDefault();
        onBack?.();
        return;
      }

      // Don't interfere with typing in inputs
      if (isInput) {
        // Enter in input: submit
        if (e.key === "Enter") {
          onSubmit?.();
        }
        return;
      }

      // / or Ctrl+K: focus search
      if (e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        onFocusSearch?.();
        return;
      }

      // Backspace: go back
      if (e.key === "Backspace") {
        e.preventDefault();
        onBack?.();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack, onSubmit, onFocusSearch]);
}
