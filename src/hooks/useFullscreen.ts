import { useState, useEffect, useCallback } from "react";

/**
 * Shared fullscreen toggle hook.
 *
 * Manages expanded state, locks body scroll when active, and listens for
 * the Escape key to exit. An optional `onExit` callback runs additional
 * cleanup (e.g. clearing selected nodes or view transforms).
 */
export function useFullscreen(onExit?: () => void) {
  const [isExpanded, setIsExpanded] = useState(false);

  const expand = useCallback(() => setIsExpanded(true), []);
  const collapse = useCallback(() => {
    setIsExpanded(false);
    onExit?.();
  }, [onExit]);

  useEffect(() => {
    if (!isExpanded) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsExpanded(false);
        onExit?.();
      }
    };

    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [isExpanded, onExit]);

  return { isExpanded, expand, collapse } as const;
}
