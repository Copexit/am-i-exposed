"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'button, [href], input, select, [tabindex]:not([tabindex="-1"])';

/**
 * While `active`, keep Tab / Shift+Tab cycling inside `ref`, and restore focus
 * to whatever had it before once the trap is released.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const savedFocus = document.activeElement;

    function handleTrap(e: KeyboardEvent) {
      if (e.key !== "Tab" || !ref.current) return;
      const focusable = ref.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleTrap);
    return () => {
      document.removeEventListener("keydown", handleTrap);
      if (savedFocus instanceof HTMLElement) savedFocus.focus();
    };
  }, [ref, active]);
}
