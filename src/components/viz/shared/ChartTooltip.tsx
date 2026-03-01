"use client";

import { useCallback, useState } from "react";

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
}

/**
 * Simple absolute-positioned tooltip inside a `position: relative` container.
 * Uses transform to center horizontally and sit above the target point.
 */
export function ChartTooltip({ top, left, children }: ChartTooltipProps) {
  return (
    <div
      style={{
        position: "absolute",
        top,
        left,
        transform: "translate(-50%, -100%)",
        backgroundColor: "rgba(28, 28, 32, 0.95)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 13,
        color: "#f0f0f2",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(16px)",
        pointerEvents: "none",
        zIndex: 50,
        whiteSpace: "nowrap",
        maxWidth: 320,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {children}
    </div>
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

  const handleTouch = useCallback(
    (e: React.TouchEvent) => {
      if (state.tooltipOpen) {
        e.preventDefault();
        setState((prev) => ({ ...prev, tooltipOpen: false }));
      }
    },
    [state.tooltipOpen],
  );

  return { ...state, showTooltip, hideTooltip, handleTouch };
}
