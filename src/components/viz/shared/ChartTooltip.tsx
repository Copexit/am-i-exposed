"use client";

import { useCallback, useState, useRef, useLayoutEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { SVG_COLORS } from "./svgConstants";

interface TooltipState<T> {
  tooltipOpen: boolean;
  tooltipData: T | undefined;
  tooltipLeft: number;
  tooltipTop: number;
}

interface ChartTooltipProps {
  top: number;
  left: number;
  children: React.ReactNode;
  /** The container element whose getBoundingClientRect maps the local coordinates to the viewport. */
  containerRef?: React.RefObject<HTMLElement | null>;
}

const subscribeNoop = () => () => {};

/**
 * Portal-based tooltip that renders at body level to avoid overflow clipping.
 * Coordinates are local to the container; if containerRef is provided they are
 * converted to viewport-fixed positioning via getBoundingClientRect.
 */
export function ChartTooltip({ top, left, children, containerRef }: ChartTooltipProps) {
  // Client-only: document.body does not exist during the static prerender.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Convert container-local coords to viewport-fixed coords before paint, so
  // the tooltip moves in the same frame as the mouse event that re-rendered it.
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const rect = containerRef?.current?.getBoundingClientRect();
    el.style.top = `${rect ? rect.top + top : top}px`;
    el.style.left = `${rect ? rect.left + left : left}px`;
  });

  if (!mounted) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      style={{
        position: "fixed",
        transform: "translate(-50%, -100%)",
        backgroundColor: "var(--overlay-bg)",
        border: "1px solid var(--overlay-border)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 13,
        color: SVG_COLORS.foreground,
        boxShadow: "var(--overlay-shadow)",
        backdropFilter: "blur(16px)",
        pointerEvents: "none",
        zIndex: 9999,
        whiteSpace: "nowrap",
        maxWidth: 320,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Tooltip position (container-local) centered above `elem`. */
export function anchorTooltip(elem: Element, container: Element): { tooltipLeft: number; tooltipTop: number } {
  const elemRect = elem.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return {
    tooltipLeft: elemRect.left - containerRect.left + elemRect.width / 2,
    tooltipTop: elemRect.top - containerRect.top,
  };
}

/** Lightweight tooltip state hook (replaces @visx/tooltip useTooltip). */
export function useChartTooltip<T>() {
  const [state, setState] = useState<TooltipState<T>>({
    tooltipOpen: false,
    tooltipData: undefined,
    tooltipLeft: 0,
    tooltipTop: 0,
  });

  const showTooltip = useCallback(
    ({ tooltipData, tooltipLeft, tooltipTop }: { tooltipData: T; tooltipLeft: number; tooltipTop: number }) => {
      setState({ tooltipOpen: true, tooltipData, tooltipLeft, tooltipTop });
    },
    [],
  );

  const hideTooltip = useCallback(() => {
    setState((prev) => ({ ...prev, tooltipOpen: false }));
  }, []);

  const handleTouch = useCallback((e: React.TouchEvent) => {
    if (state.tooltipOpen) {
      e.preventDefault();
      setState((prev) => ({ ...prev, tooltipOpen: false }));
    }
  }, [state.tooltipOpen]);

  return { ...state, showTooltip, hideTooltip, handleTouch };
}
