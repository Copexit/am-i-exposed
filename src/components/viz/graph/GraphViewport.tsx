"use client";

import { ParentSize } from "@visx/responsive";
import { GraphCanvas } from "./GraphCanvas";
import { SIDEBAR_WIDTH } from "./GraphSidebar";
import type { GraphCanvasProps, ViewTransform } from "./types";
import type { ReactNode } from "react";

interface GraphViewportProps {
  /** All props to pass through to GraphCanvas. */
  canvasProps: Omit<GraphCanvasProps, "containerWidth" | "containerHeight" | "isFullscreen">;
  /** View transform for pan/zoom (fullscreen modes). Omit for inline mode. */
  viewTransform?: ViewTransform;
  /** Callback when the view transform changes (fullscreen modes). */
  onViewTransformChange?: (vt: ViewTransform | undefined) => void;
  /** Whether to render in fullscreen mode (uses containerHeight). */
  isFullscreen?: boolean;
  /** Whether the sidebar is visible (adjusts canvas width). */
  showSidebar: boolean;
  /** Ref for the scroll container. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Legend element to overlay on the graph. */
  legend: ReactNode;
  /** Tooltip element to overlay on the graph. */
  tooltipContent: ReactNode;
  /** Sidebar element. */
  sidebar: ReactNode;
  /** Extra className for the scroll container. */
  scrollClassName?: string;
  /** Extra style for the outer container. */
  outerStyle?: React.CSSProperties;
}

/**
 * Shared viewport wrapper for GraphCanvas, used by all three render paths
 * (alwaysFullscreen, inline, and fullscreen modal) to avoid duplication.
 */
export function GraphViewport({
  canvasProps,
  viewTransform,
  onViewTransformChange,
  isFullscreen,
  showSidebar,
  scrollRef,
  legend,
  tooltipContent,
  sidebar,
  scrollClassName = "overflow-hidden h-full",
  outerStyle,
}: GraphViewportProps) {
  const fullCanvasProps = {
    ...canvasProps,
    ...(viewTransform !== undefined ? { viewTransform, onViewTransformChange } : {}),
  };

  return (
    <div className="flex-1 min-h-0 relative px-4 pb-4 flex" style={outerStyle}>
      <div className="flex-1 min-w-0 relative">
        {legend}
        <div ref={scrollRef} className={scrollClassName} style={(isFullscreen || viewTransform !== undefined) ? { touchAction: "none" } : undefined}>
          <ParentSize debounceTime={100}>
            {({ width, height: parentH }) => {
              const adjustedWidth = showSidebar ? Math.max(width - SIDEBAR_WIDTH, 200) : width;
              if (adjustedWidth <= 0) return null;
              const passHeight = isFullscreen || viewTransform !== undefined;
              return (
                <GraphCanvas
                  {...fullCanvasProps}
                  containerWidth={adjustedWidth}
                  {...(passHeight ? { containerHeight: parentH } : {})}
                  isFullscreen={isFullscreen}
                />
              );
            }}
          </ParentSize>
        </div>
        {tooltipContent}
      </div>
      {sidebar}
    </div>
  );
}
