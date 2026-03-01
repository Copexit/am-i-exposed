"use client";

import { useMemo, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AreaClosed } from "@visx/shape";
import { Group } from "@visx/group";
import { scaleLinear, scalePoint } from "@visx/scale";
import { Text } from "@visx/text";
import { ParentSize } from "@visx/responsive";
import { curveMonotoneX } from "d3-shape";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, GRADE_BANDS, GRADE_HEX_SVG, ANIMATION_DEFAULTS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { truncateId } from "@/lib/constants";
import type { TxAnalysisResult, Grade } from "@/lib/types";

interface PrivacyTimelineProps {
  breakdown: TxAnalysisResult[];
  onScan?: (txid: string) => void;
}

interface TooltipData {
  txid: string;
  score: number;
  grade: Grade;
  role: string;
}

const MARGIN = { top: 24, right: 36, bottom: 36, left: 36 };
const POINT_RADIUS = 5;
const MIN_WIDTH_PER_POINT = 50;

function TimelineChart({
  width,
  height,
  breakdown,
  onScan,
}: PrivacyTimelineProps & { width: number; height: number }) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const { tooltipOpen, tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip, handleTouch } =
    useChartTooltip<TooltipData>();

  // Reverse to chronological order (earliest first)
  const points = useMemo(() => [...breakdown].reverse(), [breakdown]);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const xScale = scalePoint<number>({
    domain: points.map((_, i) => i),
    range: [0, innerWidth],
    padding: 0.5,
  });

  const yScale = scaleLinear<number>({
    domain: [0, 100],
    range: [innerHeight, 0],
  });

  if (innerWidth < 50 || innerHeight < 50) return null;

  return (
    <div className="relative" ref={containerRef} onTouchStart={handleTouch}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={t("viz.timeline.aria", {
          count: points.length,
          defaultValue: `Privacy score timeline across ${points.length} transactions`,
        })}
      >
        <ChartDefs />
        <Group top={MARGIN.top} left={MARGIN.left}>
          {/* Grade band backgrounds */}
          {GRADE_BANDS.map((band) => (
            <rect
              key={band.grade}
              x={0}
              y={yScale(band.max + 1)}
              width={innerWidth}
              height={yScale(band.min) - yScale(band.max + 1)}
              fill={band.color}
              fillOpacity={0.06}
            />
          ))}

          {/* Y-axis gridlines */}
          {[0, 25, 50, 75, 100].map((tick) => (
            <Group key={tick}>
              <line
                x1={0}
                x2={innerWidth}
                y1={yScale(tick)}
                y2={yScale(tick)}
                stroke={SVG_COLORS.cardBorder}
                strokeOpacity={0.3}
                strokeDasharray="4,4"
              />
              <Text
                x={-8}
                y={yScale(tick)}
                textAnchor="end"
                verticalAnchor="middle"
                fontSize={11}
                fill={SVG_COLORS.muted}
                fontFamily="var(--font-geist-mono), monospace"
              >
                {tick}
              </Text>
            </Group>
          ))}

          {/* Grade labels on right */}
          {GRADE_BANDS.map((band) => (
            <Text
              key={`label-${band.grade}`}
              x={innerWidth + 6}
              y={yScale((band.min + band.max) / 2)}
              textAnchor="start"
              verticalAnchor="middle"
              fontSize={10}
              fill={band.color}
              fillOpacity={0.5}
            >
              {band.grade}
            </Text>
          ))}

          {/* Area fill under line */}
          <AreaClosed
            data={points}
            x={(_, i) => xScale(i) ?? 0}
            y={(d) => yScale(d.score)}
            yScale={yScale}
            curve={curveMonotoneX}
            fill="url(#grad-timeline-area)"
          />

          {/* Per-segment gradient lines */}
          <defs>
            {points.slice(0, -1).map((p, i) => {
              const nextP = points[i + 1];
              return (
                <linearGradient key={`tl-seg-${i}`} id={`tl-seg-${i}`}>
                  <stop offset="0%" stopColor={GRADE_HEX_SVG[p.grade]} />
                  <stop offset="100%" stopColor={GRADE_HEX_SVG[nextP.grade]} />
                </linearGradient>
              );
            })}
          </defs>
          {points.slice(0, -1).map((p, i) => {
            const nextP = points[i + 1];
            return (
              <line
                key={`seg-${i}`}
                x1={xScale(i) ?? 0}
                y1={yScale(p.score)}
                x2={xScale(i + 1) ?? 0}
                y2={yScale(nextP.score)}
                stroke={`url(#tl-seg-${i})`}
                strokeWidth={2}
                strokeOpacity={0.7}
              />
            );
          })}

          {/* Data points */}
          {points.map((point, i) => {
            const cx = xScale(i) ?? 0;
            const cy = yScale(point.score);
            const color = GRADE_HEX_SVG[point.grade];

            // Role indicator
            const roleArrow = point.role === "sender" ? "\u2191" : point.role === "receiver" ? "\u2193" : "\u2195";

            return (
              <Group key={point.txid}>
                <motion.circle
                  cx={cx}
                  cy={cy}
                  r={i === points.length - 1 ? POINT_RADIUS + 2 : POINT_RADIUS + 1}
                  fill={color}
                  stroke={SVG_COLORS.background}
                  strokeWidth={2}
                  filter={i === points.length - 1 ? "url(#glow-medium)" : "url(#glow-subtle)"}
                  initial={reducedMotion ? false : { r: 0 }}
                  animate={{ r: i === points.length - 1 ? POINT_RADIUS + 2 : POINT_RADIUS + 1 }}
                  transition={{
                    delay: i * ANIMATION_DEFAULTS.stagger,
                    duration: ANIMATION_DEFAULTS.duration,
                  }}
                  cursor={onScan ? "pointer" : "default"}
                  tabIndex={onScan ? 0 : undefined}
                  role={onScan ? "button" : undefined}
                  aria-label={`${point.grade} (${point.score}) - ${truncateId(point.txid, 4)}`}
                  className={onScan ? "outline-none focus-visible:outline-2 focus-visible:outline-bitcoin" : ""}
                  onClick={() => onScan?.(point.txid)}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if ((e.key === "Enter" || e.key === " ") && onScan) {
                      e.preventDefault();
                      onScan(point.txid);
                    }
                  }}
                  onMouseEnter={(e: React.MouseEvent) => {
                    const container = containerRef.current;
                    if (!container) return;
                    const containerRect = container.getBoundingClientRect();
                    const elemRect = (e.currentTarget as Element).getBoundingClientRect();
                    showTooltip({
                      tooltipData: {
                        txid: point.txid,
                        score: point.score,
                        grade: point.grade,
                        role: point.role,
                      },
                      tooltipLeft: elemRect.left - containerRect.left + elemRect.width / 2,
                      tooltipTop: elemRect.top - containerRect.top,
                    });
                  }}
                  onMouseLeave={() => hideTooltip()}
                />

                {/* Role indicator */}
                <Text
                  x={cx}
                  y={cy + POINT_RADIUS + 12}
                  textAnchor="middle"
                  fontSize={10}
                  fill={SVG_COLORS.muted}
                >
                  {roleArrow}
                </Text>

                {/* X-axis tx index */}
                <Text
                  x={cx}
                  y={innerHeight + 16}
                  textAnchor="middle"
                  fontSize={10}
                  fill={SVG_COLORS.muted}
                  fontFamily="var(--font-geist-mono), monospace"
                >
                  {i + 1}
                </Text>
              </Group>
            );
          })}
        </Group>
      </svg>

      {tooltipOpen && tooltipData && (
        <ChartTooltip top={tooltipTop ?? 0} left={tooltipLeft ?? 0}>
          <div className="space-y-0.5">
            <p className="font-mono text-xs" style={{ color: SVG_COLORS.foreground }}>
              {truncateId(tooltipData.txid, 4)}
            </p>
            <p className="text-xs font-bold" style={{ color: GRADE_HEX_SVG[tooltipData.grade] }}>
              {tooltipData.grade} ({tooltipData.score}/100)
            </p>
            <p className="text-xs" style={{ color: SVG_COLORS.muted }}>
              {tooltipData.role === "sender"
                ? t("viz.timeline.sender", { defaultValue: "Sender" })
                : tooltipData.role === "receiver"
                  ? t("viz.timeline.receiver", { defaultValue: "Receiver" })
                  : t("viz.timeline.both", { defaultValue: "Both" })}
            </p>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}

export function PrivacyTimeline({ breakdown, onScan }: PrivacyTimelineProps) {
  const { t } = useTranslation();

  if (breakdown.length < 2) return null;

  const scrollWidth = breakdown.length > 15 ? breakdown.length * MIN_WIDTH_PER_POINT : undefined;

  return (
    <div className="w-full glass rounded-xl p-4 sm:p-6 space-y-3">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wider">
        {t("viz.timeline.title", { defaultValue: "Privacy score history" })}
      </h3>
      <div
        className={scrollWidth ? "overflow-x-auto" : ""}
        style={scrollWidth ? { scrollSnapType: "x mandatory" } : undefined}
      >
        <div style={{ minHeight: 200, width: scrollWidth }}>
          <ParentSize>
            {({ width }) => (
              <TimelineChart
                width={scrollWidth ?? width}
                height={Math.max(200, Math.min(300, (scrollWidth ?? width) * 0.4))}
                breakdown={breakdown}
                onScan={onScan}
              />
            )}
          </ParentSize>
        </div>
      </div>
    </div>
  );
}
