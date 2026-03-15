"use client";

import { useCallback, useState, useRef, useEffect } from "react";
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

/**
 * Portal-based tooltip that renders at body level to avoid overflow clipping.
 * Coordinates are local to the container; if containerRef is provided they are
 * converted to viewport-fixed positioning via getBoundingClientRect.
 */
export function ChartTooltip({ top, left, children, containerRef }: ChartTooltipProps) {
  const [mounted, setMounted] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  // Convert container-local coords to viewport-fixed coords.
  // Reading containerRef during render is intentional: tooltip position must
  // be synchronous with the mouse event that triggered the render.
  // eslint-disable-next-line react-hooks/refs -- DOM measurement for portal positioning
  const rect = containerRef?.current?.getBoundingClientRect();
  const fixedTop = rect ? rect.top + top : top;
  const fixedLeft = rect ? rect.left + left : left;

  return createPortal(
    <div
      ref={tooltipRef}
      style={{
        position: "fixed",
        top: fixedTop,
        left: fixedLeft,
        transform: "translate(-50%, -100%)",
        backgroundColor: "rgba(28, 28, 32, 0.95)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 13,
        color: SVG_COLORS.foreground,
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
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
