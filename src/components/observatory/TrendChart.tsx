"use client";

import { useCallback, useMemo } from "react";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { LinePath, AreaClosed, Bar, Line } from "@visx/shape";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { bisector } from "d3-array";
import type { SparklinePoint } from "@/lib/observatory/types";

interface TrendChartProps {
  points: SparklinePoint[];
  color: string;
  /** Domain label for the x value (e.g. "Block", "Day"). */
  xLabel?: string;
  /** Label for the y value (used in tooltip). */
  yLabel?: string;
  /** Optional unit appended to numeric values (e.g. "BTC"). */
  unit?: string;
  /** Optional formatter override for x tick labels. */
  formatX?: (x: number, index: number, total: number) => string;
  /** Optional formatter override for y tick labels and tooltip. */
  formatY?: (y: number) => string;
  height?: number;
  ariaLabel?: string;
}

const MARGIN = { top: 16, right: 16, bottom: 28, left: 56 };

const tooltipStyles: React.CSSProperties = {
  ...defaultStyles,
  background: "var(--surface-elevated, #1a1a1a)",
  border: "1px solid var(--card-border, #2a2a2a)",
  color: "var(--foreground, #fafafa)",
  fontSize: 12,
  padding: "6px 10px",
  borderRadius: 8,
  pointerEvents: "none",
};

const bisectX = bisector<SparklinePoint, number>((d) => d.x).left;

export function TrendChart(props: TrendChartProps) {
  return (
    <div style={{ width: "100%", height: props.height ?? 200 }}>
      <ParentSize>
        {({ width, height }) =>
          width > 0 && height > 0 ? (
            <Inner {...props} width={width} height={height} />
          ) : null
        }
      </ParentSize>
    </div>
  );
}

function defaultFormatY(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function Inner({
  points,
  color,
  unit,
  formatX,
  formatY = defaultFormatY,
  width,
  height,
  ariaLabel,
}: TrendChartProps & { width: number; height: number }) {
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const { xScale, yScale, yMin, yMax } = useMemo(() => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xMin = xs.length ? Math.min(...xs) : 0;
    const xMax = xs.length ? Math.max(...xs) : 1;
    const rawMin = ys.length ? Math.min(...ys) : 0;
    const rawMax = ys.length ? Math.max(...ys) : 1;
    // Add 8% headroom so the line doesn't touch the top edge.
    const span = rawMax - rawMin || 1;
    const yMin = Math.max(0, rawMin - span * 0.05);
    const yMax = rawMax + span * 0.08;
    return {
      xScale: scaleLinear({ domain: [xMin, xMax], range: [0, innerWidth] }),
      yScale: scaleLinear({ domain: [yMin, yMax], range: [innerHeight, 0] }),
      yMin,
      yMax,
    };
  }, [points, innerWidth, innerHeight]);

  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    showTooltip,
    hideTooltip,
  } = useTooltip<SparklinePoint>();

  const onMove = useCallback(
    (event: React.MouseEvent<SVGRectElement> | React.TouchEvent<SVGRectElement>) => {
      const point = localPoint(event);
      if (!point || points.length === 0) return;
      const x = point.x - MARGIN.left;
      const x0 = xScale.invert(x);
      const idx = bisectX(points, x0, 1);
      const d0 = points[idx - 1];
      const d1 = points[idx] ?? d0;
      const d = !d1 || (d0 && x0 - d0.x < d1.x - x0) ? d0 : d1;
      if (!d) return;
      showTooltip({
        tooltipData: d,
        tooltipLeft: MARGIN.left + xScale(d.x),
        tooltipTop: MARGIN.top + yScale(d.y),
      });
    },
    [points, xScale, yScale, showTooltip],
  );

  if (points.length < 2 || innerWidth <= 0 || innerHeight <= 0) {
    return null;
  }

  const numXTicks = innerWidth > 320 ? 5 : 3;
  const numYTicks = innerHeight > 120 ? 4 : 3;

  const defaultXFormat = (value: number, index: number, total: number): string => {
    if (formatX) return formatX(value, index, total);
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };

  return (
    <div style={{ position: "relative", width, height }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel ?? "Trend chart"}>
        <defs>
          <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Group left={MARGIN.left} top={MARGIN.top}>
          {/* Y gridlines */}
          {yScale.ticks(numYTicks).map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={innerWidth}
              y1={yScale(tick)}
              y2={yScale(tick)}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeDasharray="2,3"
            />
          ))}
          {/* Filled area */}
          <AreaClosed
            data={points}
            x={(d) => xScale(d.x)}
            y={(d) => yScale(d.y)}
            yScale={yScale}
            stroke="none"
            fill={`url(#grad-${color.replace("#", "")})`}
          />
          {/* Line */}
          <LinePath
            data={points}
            x={(d) => xScale(d.x)}
            y={(d) => yScale(d.y)}
            stroke={color}
            strokeWidth={1.75}
          />
          {/* Axes */}
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            numTicks={numXTicks}
            tickFormat={(v, i) =>
              defaultXFormat(Number(v), i, numXTicks)
            }
            stroke="rgba(255,255,255,0.18)"
            tickStroke="rgba(255,255,255,0.18)"
            tickLabelProps={() => ({
              fill: "currentColor",
              fillOpacity: 0.55,
              fontSize: 10,
              textAnchor: "middle",
              dy: 12,
            })}
          />
          <AxisLeft
            scale={yScale}
            numTicks={numYTicks}
            tickFormat={(v) => `${formatY(Number(v))}${unit ? ` ${unit}` : ""}`}
            stroke="rgba(255,255,255,0.18)"
            tickStroke="rgba(255,255,255,0.18)"
            tickLabelProps={() => ({
              fill: "currentColor",
              fillOpacity: 0.55,
              fontSize: 10,
              textAnchor: "end",
              dx: -6,
              dy: 3,
            })}
          />
          {/* Hover crosshair */}
          {tooltipData && (
            <>
              <Line
                from={{ x: xScale(tooltipData.x), y: 0 }}
                to={{ x: xScale(tooltipData.x), y: innerHeight }}
                stroke={color}
                strokeOpacity={0.35}
                strokeDasharray="2,3"
                pointerEvents="none"
              />
              <circle
                cx={xScale(tooltipData.x)}
                cy={yScale(tooltipData.y)}
                r={4}
                fill={color}
                stroke="var(--background, #000)"
                strokeWidth={2}
                pointerEvents="none"
              />
            </>
          )}
          {/* Hover capture rect */}
          <Bar
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={hideTooltip}
            onTouchStart={onMove}
            onTouchMove={onMove}
            onTouchEnd={hideTooltip}
          />
        </Group>
      </svg>
      {tooltipData && (
        <TooltipWithBounds top={tooltipTop} left={tooltipLeft} style={tooltipStyles}>
          <div style={{ fontWeight: 600 }}>
            {formatY(tooltipData.y)}
            {unit ? ` ${unit}` : ""}
          </div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            {defaultXFormat(tooltipData.x, 0, 1)}
          </div>
        </TooltipWithBounds>
      )}
      <span className="sr-only">
        min {formatY(yMin)} {unit ?? ""}, max {formatY(yMax)} {unit ?? ""}
      </span>
    </div>
  );
}
