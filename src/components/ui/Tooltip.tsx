"use client";

import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: string;
  children: ReactNode;
  /** Tooltip appears above or below the trigger. Default: "top" */
  side?: "top" | "bottom";
}

/**
 * Instant tooltip - shows on hover with zero delay and on tap for mobile.
 * Uses a portal to render at body level so it is never clipped by overflow containers.
 */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      top: side === "top" ? rect.top + window.scrollY : rect.bottom + window.scrollY,
      left: rect.left + rect.width / 2 + window.scrollX,
    });
  }, [side]);

  const open = () => {
    clearTimeout(timeout.current);
    measure();
    setShow(true);
  };
  const close = () => {
    timeout.current = setTimeout(() => setShow(false), 100);
  };

  // Recalculate position on scroll/resize while visible
  useEffect(() => {
    if (!show) return;
    const update = () => measure();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [show, measure]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onTouchStart={open}
    >
      {children}
      {show && pos && createPortal(
        <span
          role="tooltip"
          className="fixed z-[9999] px-2 py-1 text-[11px] leading-tight text-foreground bg-surface-elevated border border-card-border rounded-md shadow-lg whitespace-nowrap pointer-events-none"
          style={{
            top: side === "top" ? pos.top - window.scrollY : pos.top - window.scrollY,
            left: pos.left - window.scrollX,
            transform: side === "top"
              ? "translate(-50%, calc(-100% - 6px))"
              : "translate(-50%, 6px)",
          }}
        >
          {content}
        </span>,
        document.body,
      )}
    </span>
  );
}
