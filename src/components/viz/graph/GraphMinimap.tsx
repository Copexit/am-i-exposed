"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { SVG_COLORS } from "../shared/svgConstants";
import { MINIMAP_W, MINIMAP_H } from "./constants";
import { getNodeColor } from "./layout";
import type { MinimapProps } from "./types";

export function GraphMinimap({
  layoutNodes,
  edges,
  graphWidth,
  graphHeight,
  viewportWidth,
  viewportHeight,
  scrollLeft,
  scrollTop,
  onMinimapClick,
  heatMap,
  heatMapActive,
}: MinimapProps) {
  const mmSvgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);

  const scale = useMemo(() => {
    const sX = MINIMAP_W / Math.max(graphWidth, 1);
    const sY = MINIMAP_H / Math.max(graphHeight, 1);
    return Math.min(sX, sY, 1);
  }, [graphWidth, graphHeight]);

  const getGraphPos = useCallback((clientX: number, clientY: number) => {
    const r = mmSvgRef.current?.getBoundingClientRect();
    if (!r) return null;
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  }, [scale]);

  // Document-level drag handlers for smooth minimap dragging
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const pos = getGraphPos(e.clientX, e.clientY);
      if (pos) onMinimapClick(pos.x, pos.y);
    };
    const onUp = () => setDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [dragging, getGraphPos, onMinimapClick]);

  if (layoutNodes.length <= 1) return null;
  // Hide minimap when all elements fit within the viewport
  if (graphWidth <= viewportWidth && graphHeight <= viewportHeight) return null;

  // Clamp viewport rect to minimap bounds so it stays visible
  const rawVpX = scrollLeft * scale;
  const rawVpY = scrollTop * scale;
  const rawVpW = Math.min(viewportWidth * scale, MINIMAP_W);
  const rawVpH = Math.min(viewportHeight * scale, MINIMAP_H);
  const vpX = Math.max(0, rawVpX);
  const vpY = Math.max(0, rawVpY);
  const vpW = Math.max(4, Math.min(rawVpW + Math.min(rawVpX, 0), MINIMAP_W - vpX));
  const vpH = Math.max(4, Math.min(rawVpH + Math.min(rawVpY, 0), MINIMAP_H - vpY));

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    setDragging(true);
    const pos = getGraphPos(e.clientX, e.clientY);
    if (pos) onMinimapClick(pos.x, pos.y);
  };

  return (
    <div
      className="fixed bottom-4 left-4 z-[60] rounded border border-white/10 bg-black/60 backdrop-blur-sm overflow-hidden"
      style={{ width: MINIMAP_W, height: MINIMAP_H }}
    >
      <svg
        ref={mmSvgRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        style={{ cursor: dragging ? "grabbing" : "crosshair" }}
        onMouseDown={handleMouseDown}
      >
        {/* Edges */}
        {edges.map((e) => (
          <line
            key={`me-${e.fromTxid}-${e.toTxid}`}
            x1={e.x1 * scale}
            y1={e.y1 * scale}
            x2={e.x2 * scale}
            y2={e.y2 * scale}
            stroke={e.consolidationCount >= 2 ? SVG_COLORS.critical : SVG_COLORS.muted}
            strokeWidth={e.consolidationCount >= 2 ? 1 : 0.5}
            strokeOpacity={e.consolidationCount >= 2 ? 0.6 : 0.3}
          />
        ))}
        {/* Nodes */}
        {layoutNodes.map((n) => {
          const heatScore = heatMapActive ? heatMap.get(n.txid)?.score : undefined;
          return (
            <rect
              key={`mn-${n.txid}`}
              x={n.x * scale}
              y={n.y * scale}
              width={n.width * scale}
              height={n.height * scale}
              rx={2}
              fill={getNodeColor(n, heatScore)}
              fillOpacity={0.6}
            />
          );
        })}
        {/* Viewport rectangle */}
        <rect
          x={vpX}
          y={vpY}
          width={vpW}
          height={vpH}
          fill="none"
          stroke={SVG_COLORS.bitcoin}
          strokeWidth={1.5}
          strokeOpacity={0.8}
          rx={2}
        />
      </svg>
    </div>
  );
}
