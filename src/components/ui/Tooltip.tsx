"use client";

import { useState, useRef, type ReactNode } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
  /** Tooltip appears above or below the trigger. Default: "top" */
  side?: "top" | "bottom";
}

/**
 * Instant tooltip - shows on hover with zero delay and on tap for mobile.
 * Pure CSS positioning, no portal needed.
 */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [show, setShow] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const open = () => {
    clearTimeout(timeout.current);
    setShow(true);
  };
  const close = () => {
    timeout.current = setTimeout(() => setShow(false), 100);
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onTouchStart={open}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          className={`absolute left-1/2 -translate-x-1/2 z-50 px-2 py-1 text-[11px] leading-tight text-foreground bg-surface-elevated border border-card-border rounded-md shadow-lg whitespace-nowrap pointer-events-none ${
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
          }`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
