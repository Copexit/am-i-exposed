"use client";

import { useEffect, useRef } from "react";

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
 *
 * Uses refs to avoid re-attaching the event listener on every render.
 */
export function useKeyboardNav({
  onBack,
  onSubmit,
  onFocusSearch,
}: KeyboardNavOptions) {
  const onBackRef = useRef(onBack);
  const onSubmitRef = useRef(onSubmit);
  const onFocusSearchRef = useRef(onFocusSearch);

  useEffect(() => {
    onBackRef.current = onBack;
    onSubmitRef.current = onSubmit;
    onFocusSearchRef.current = onFocusSearch;
  });

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
        onBackRef.current?.();
        return;
      }

      // Don't interfere with typing in inputs
      if (isInput) {
        // Enter in input: submit
        if (e.key === "Enter") {
          onSubmitRef.current?.();
        }
        return;
      }

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
