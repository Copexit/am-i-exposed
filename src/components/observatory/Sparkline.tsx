"use client";

import type { SparklinePoint } from "@/lib/observatory/types";

interface SparklineProps {
  points: SparklinePoint[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
  ariaLabel?: string;
}

export function Sparkline({
  points,
  width = 140,
  height = 36,
  stroke = "currentColor",
  fill = "none",
  className,
  ariaLabel,
}: SparklineProps) {
  if (points.length < 2) {
    return (
      <div
        className={className}
        style={{ width, height }}
        aria-label={ariaLabel ?? "No trend data available"}
      />
    );
  }

  const ys = points.map((p) => p.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : width;

  const d = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p.y - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const areaD = `${d} L${width.toFixed(2)},${height} L0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? "Trend sparkline"}
      className={className}
    >
      {fill !== "none" && <path d={areaD} fill={fill} opacity={0.18} />}
      <path d={d} stroke={stroke} strokeWidth={1.5} fill="none" />
    </svg>
  );
}
