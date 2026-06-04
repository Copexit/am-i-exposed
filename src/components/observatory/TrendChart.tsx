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

export interface TrendSeries {
  /** Stable id used for the gradient + tooltip row. */
  id: string;
  points: SparklinePoint[];
  color: string;
  /** Display label shown in the tooltip and (when more than one series) the legend. */
  label?: string;
}

interface TrendChartProps {
  /** Single-series convenience (legacy). Use `series` for multi-line charts. */
  points?: SparklinePoint[];
  color?: string;
  /** Multi-series form. Mutually exclusive with `points`. */
  series?: TrendSeries[];
  /** Optional unit appended to numeric values (e.g. "BTC"). */
  unit?: string;
  /** Optional formatter override for x tick labels. */
  formatX?: (x: number, index: number, total: number) => string;
  /** Optional formatter override for y tick labels and tooltip. */
  formatY?: (y: number) => string;
  /** When true, suppress the gradient area fill (better for monotonic data). */
  noFill?: boolean;
  height?: number;
  ariaLabel?: string;
}

function marginFor(width: number) {
  if (width < 360) return { top: 12, right: 8, bottom: 24, left: 36 };
  if (width < 480) return { top: 14, right: 12, bottom: 26, left: 44 };
  return { top: 16, right: 16, bottom: 28, left: 56 };
}

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

interface HoverPayload {
  x: number;
  perSeries: { id: string; label?: string; y: number; color: string }[];
}

function Inner({
  points,
  color,
  series,
  unit,
  formatX,
  formatY = defaultFormatY,
  noFill,
  width,
  height,
  ariaLabel,
}: TrendChartProps & { width: number; height: number }) {
  const allSeries: TrendSeries[] = useMemo(() => {
    if (series && series.length > 0) return series;
    if (points && points.length > 0)
      return [{ id: "default", points, color: color ?? "#f97316" }];
    return [];
  }, [series, points, color]);

  const MARGIN = marginFor(width);
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const isNarrow = width < 360;

  const { xScale, yScale } = useMemo(() => {
    const allX = allSeries.flatMap((s) => s.points.map((p) => p.x));
    const allY = allSeries.flatMap((s) => s.points.map((p) => p.y));
    const xMin = allX.length ? Math.min(...allX) : 0;
    const xMax = allX.length ? Math.max(...allX) : 1;
    const rawMin = allY.length ? Math.min(...allY) : 0;
    const rawMax = allY.length ? Math.max(...allY) : 1;
    const span = rawMax - rawMin || 1;
    const yMin = Math.max(0, rawMin - span * 0.05);
    const yMax = rawMax + span * 0.08;
    return {
      xScale: scaleLinear({ domain: [xMin, xMax], range: [0, innerWidth] }),
      yScale: scaleLinear({ domain: [yMin, yMax], range: [innerHeight, 0] }),
    };
  }, [allSeries, innerWidth, innerHeight]);

  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    showTooltip,
    hideTooltip,
  } = useTooltip<HoverPayload>();

  const onMove = useCallback(
    (event: React.MouseEvent<SVGRectElement> | React.TouchEvent<SVGRectElement>) => {
      const point = localPoint(event);
      if (!point || allSeries.length === 0) return;
      const x = point.x - MARGIN.left;
      const x0 = xScale.invert(x);
      const perSeries: HoverPayload["perSeries"] = [];
      let avgY = 0;
      for (const s of allSeries) {
        if (s.points.length === 0) continue;
        const idx = bisectX(s.points, x0, 1);
        const d0 = s.points[idx - 1];
        const d1 = s.points[idx] ?? d0;
        const d = !d1 || (d0 && x0 - d0.x < d1.x - x0) ? d0 : d1;
        if (!d) continue;
        perSeries.push({ id: s.id, label: s.label, y: d.y, color: s.color });
        avgY += d.y;
      }
      if (perSeries.length === 0) return;
      avgY /= perSeries.length;
      showTooltip({
        tooltipData: { x: x0, perSeries },
        tooltipLeft: MARGIN.left + xScale(x0),
        tooltipTop: MARGIN.top + yScale(avgY),
      });
    },
    [allSeries, xScale, yScale, showTooltip, MARGIN.left, MARGIN.top],
  );

  if (allSeries.length === 0 || innerWidth <= 0 || innerHeight <= 0) {
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
          {allSeries.map((s) => (
            <linearGradient
              key={s.id}
              id={`grad-${s.id}-${s.color.replace("#", "")}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
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
          {/* Filled areas (one per series) */}
          {!noFill &&
            allSeries.map((s) => (
              <AreaClosed
                key={`area-${s.id}`}
                data={s.points}
                x={(d) => xScale(d.x)}
                y={(d) => yScale(d.y)}
                yScale={yScale}
                stroke="none"
                fill={`url(#grad-${s.id}-${s.color.replace("#", "")})`}
              />
            ))}
          {/* Lines (one per series) */}
          {allSeries.map((s) => (
            <LinePath
              key={`line-${s.id}`}
              data={s.points}
              x={(d) => xScale(d.x)}
              y={(d) => yScale(d.y)}
              stroke={s.color}
              strokeWidth={1.75}
            />
          ))}
          {/* Axes */}
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            numTicks={numXTicks}
            tickFormat={(v, i) => defaultXFormat(Number(v), i, numXTicks)}
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
            tickFormat={(v) =>
              isNarrow ? formatY(Number(v)) : `${formatY(Number(v))}${unit ? ` ${unit}` : ""}`
            }
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
          {/* Hover crosshair (vertical guide + per-series dots) */}
          {tooltipData && (
            <>
              <Line
                from={{ x: xScale(tooltipData.x), y: 0 }}
                to={{ x: xScale(tooltipData.x), y: innerHeight }}
                stroke="currentColor"
                strokeOpacity={0.35}
                strokeDasharray="2,3"
                pointerEvents="none"
              />
              {tooltipData.perSeries.map((p) => (
                <circle
                  key={p.id}
                  cx={xScale(tooltipData.x)}
                  cy={yScale(p.y)}
                  r={4}
                  fill={p.color}
                  stroke="var(--background, #000)"
                  strokeWidth={2}
                  pointerEvents="none"
                />
              ))}
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
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>
            {defaultXFormat(tooltipData.x, 0, 1)}
          </div>
          {tooltipData.perSeries.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: p.color,
                }}
              />
              <span style={{ flex: 1 }}>{p.label ?? p.id}</span>
              <span style={{ fontWeight: 600 }}>
                {formatY(p.y)}
                {unit ? ` ${unit}` : ""}
              </span>
            </div>
          ))}
        </TooltipWithBounds>
      )}
    </div>
  );
}
