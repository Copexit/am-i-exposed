"use client";

import { useMemo, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { Text } from "@visx/text";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, SEVERITY_HEX, GRADE_HEX_SVG, ANIMATION_DEFAULTS, WATERFALL_GRADIENT_IDS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import type { Finding, Grade } from "@/lib/types";

interface ScoreWaterfallProps {
  findings: Finding[];
  finalScore: number;
  grade: Grade;
  baseScore?: number;
  onFindingClick?: (findingId: string) => void;
}

const DEFAULT_BASE_SCORE = 70;
const MARGIN = { top: 24, right: 16, bottom: 80, left: 40 };
const MIN_HEIGHT = 260;

interface WaterfallSegment {
  key: string;
  label: string;
  value: number;
  runningStart: number;
  runningEnd: number;
  color: string;
  findingId?: string;
  severity?: string;
}

interface TooltipData {
  label: string;
  impact: number;
  severity?: string;
  description?: string;
}

/** Map grade to severity key for gradient lookup. */
const GRADE_TO_SEV: Record<Grade, string> = {
  "A+": "good",
  B: "low",
  C: "medium",
  D: "high",
  F: "critical",
};

/** Resolve bar fill for a waterfall segment. Subtle gradients, no glow. */
function getBarStyle(seg: WaterfallSegment, grade: Grade): { fill: string; fillOpacity?: number } {
  if (seg.key === "base") {
    return { fill: `url(#${WATERFALL_GRADIENT_IDS.base})`, fillOpacity: 0.6 };
  }
  if (seg.key === "final") {
    const sevKey = GRADE_TO_SEV[grade];
    return { fill: `url(#${WATERFALL_GRADIENT_IDS[sevKey] ?? WATERFALL_GRADIENT_IDS.good})` };
  }
  if (seg.value > 0) {
    return { fill: `url(#${WATERFALL_GRADIENT_IDS.positive})` };
  }
  // Negative impact - use severity gradient
  const sevId = WATERFALL_GRADIENT_IDS[seg.severity ?? "high"] ?? WATERFALL_GRADIENT_IDS.high;
  return { fill: `url(#${sevId})` };
}

function WaterfallChart({
  width,
  height,
  findings,
  finalScore,
  grade,
  baseScore = DEFAULT_BASE_SCORE,
  onFindingClick,
}: ScoreWaterfallProps & { width: number; height: number }) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const { tooltipOpen, tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip, handleTouch } =
    useChartTooltip<TooltipData>();

  const segments = useMemo(() => {
    const impactFindings = findings.filter((f) => f.scoreImpact !== 0);
    // Sort: positive first, then negative by magnitude
    const sorted = [...impactFindings].sort((a, b) => {
      if (a.scoreImpact > 0 && b.scoreImpact <= 0) return -1;
      if (a.scoreImpact <= 0 && b.scoreImpact > 0) return 1;
      return Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact);
    });

    const segs: WaterfallSegment[] = [];
    let running = baseScore;

    // Base column
    segs.push({
      key: "base",
      label: t("viz.waterfall.base", { defaultValue: "Base" }),
      value: baseScore,
      runningStart: 0,
      runningEnd: baseScore,
      color: SVG_COLORS.muted,
    });

    // Impact columns
    for (const f of sorted) {
      const start = running;
      running = Math.max(0, Math.min(100, running + f.scoreImpact));
      segs.push({
        key: f.id,
        label: t(`finding.${f.id}.title`, { ...f.params, defaultValue: f.title }),
        value: f.scoreImpact,
        runningStart: Math.min(start, running),
        runningEnd: Math.max(start, running),
        color: f.scoreImpact > 0 ? SVG_COLORS.good : SEVERITY_HEX[f.severity] ?? SVG_COLORS.high,
        findingId: f.id,
        severity: f.severity,
      });
    }

    // Final column
    segs.push({
      key: "final",
      label: t("viz.waterfall.final", { defaultValue: "Final" }),
      value: finalScore,
      runningStart: 0,
      runningEnd: finalScore,
      color: GRADE_HEX_SVG[grade],
    });

    return segs;
  }, [findings, finalScore, grade, baseScore, t]);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const xScale = scaleBand<string>({
    domain: segments.map((s) => s.key),
    range: [0, innerWidth],
    padding: 0.25,
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
        aria-label={t("viz.waterfall.aria", {
          score: finalScore,
          grade,
          defaultValue: `Score waterfall chart. Base score 70 adjusted to final score ${finalScore}, grade ${grade}.`,
        })}
      >
        <ChartDefs />
        <Group top={MARGIN.top} left={MARGIN.left}>
          {/* Y-axis gridlines */}
          {[0, 25, 50, 75, 100].map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={innerWidth}
              y1={yScale(tick)}
              y2={yScale(tick)}
              stroke={SVG_COLORS.cardBorder}
              strokeOpacity={0.3}
              strokeDasharray="4,4"
            />
          ))}

          {/* Y-axis labels */}
          {[0, 25, 50, 75, 100].map((tick) => (
            <Text
              key={tick}
              x={-8}
              y={yScale(tick)}
              textAnchor="end"
              verticalAnchor="middle"
              fontSize={12}
              fill={SVG_COLORS.muted}
              fontFamily="var(--font-geist-mono), monospace"
            >
              {tick}
            </Text>
          ))}

          {/* Connector lines between bars */}
          {segments.slice(0, -1).map((seg, i) => {
            const next = segments[i + 1];
            const x1 = (xScale(seg.key) ?? 0) + xScale.bandwidth();
            const x2 = xScale(next.key) ?? 0;
            const y = yScale(seg.runningEnd);
            return (
              <line
                key={`connector-${seg.key}`}
                x1={x1}
                x2={x2}
                y1={y}
                y2={y}
                stroke={SVG_COLORS.muted}
                strokeOpacity={0.5}
                strokeDasharray="3,3"
              />
            );
          })}

          {/* Bars */}
          {segments.map((seg, i) => {
            const barX = xScale(seg.key) ?? 0;
            const barWidth = xScale.bandwidth();
            const barY = yScale(seg.runningEnd);
            const barHeight = Math.max(1, yScale(seg.runningStart) - yScale(seg.runningEnd));
            const isClickable = !!seg.findingId;
            const barStyle = getBarStyle(seg, grade);

            return (
              <Group key={seg.key}>
                <motion.rect
                  x={barX}
                  y={barY}
                  width={barWidth}
                  height={barHeight}
                  fill={barStyle.fill}
                  fillOpacity={barStyle.fillOpacity}
                  rx={3}
                  initial={reducedMotion ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{
                    delay: i * ANIMATION_DEFAULTS.stagger,
                    duration: ANIMATION_DEFAULTS.duration,
                    ease: [0.4, 0, 0.2, 1],
                  }}
                  style={{ originX: `${barX + barWidth / 2}px`, originY: `${barY + barHeight}px`, transformBox: "fill-box", transformOrigin: "bottom" }}
                  cursor={isClickable ? "pointer" : "default"}
                  tabIndex={isClickable ? 0 : undefined}
                  role={isClickable ? "button" : undefined}
                  aria-label={isClickable ? `${seg.label}: ${seg.value > 0 ? "+" : ""}${seg.value}` : undefined}
                  onClick={() => {
                    if (seg.findingId && onFindingClick) {
                      onFindingClick(seg.findingId);
                    }
                  }}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if ((e.key === "Enter" || e.key === " ") && seg.findingId && onFindingClick) {
                      e.preventDefault();
                      onFindingClick(seg.findingId);
                    }
                  }}
                  onMouseEnter={(e: React.MouseEvent) => {
                    const container = containerRef.current;
                    if (!container) return;
                    const containerRect = container.getBoundingClientRect();
                    const elemRect = (e.currentTarget as Element).getBoundingClientRect();
                    showTooltip({
                      tooltipData: {
                        label: seg.label,
                        impact: seg.value,
                        severity: seg.severity,
                      },
                      tooltipLeft: elemRect.left - containerRect.left + elemRect.width / 2,
                      tooltipTop: elemRect.top - containerRect.top,
                    });
                  }}
                  onMouseLeave={() => hideTooltip()}
                  className={isClickable ? "outline-none focus-visible:outline-2 focus-visible:outline-bitcoin" : ""}
                />

                {/* Impact label: inside bar, below bar, or above bar */}
                {seg.key !== "base" && seg.key !== "final" && barWidth >= 20 && (() => {
                  const spaceBelow = innerHeight - (barY + barHeight);
                  let labelY: number;
                  let labelColor: string;
                  if (seg.value > 0) {
                    // Positive: always above
                    labelY = barY - 6;
                    labelColor = seg.color;
                  } else if (barHeight >= 24) {
                    // Negative, tall bar: inside bar, white text
                    labelY = barY + barHeight / 2 + 4;
                    labelColor = "#f0f0f2";
                  } else if (spaceBelow >= 32) {
                    // Negative, short bar, room below: below bar
                    labelY = barY + barHeight + 14;
                    labelColor = seg.color;
                  } else {
                    // Negative, short bar, no room below: above bar
                    labelY = barY - 6;
                    labelColor = seg.color;
                  }
                  return (
                    <Text
                      x={barX + barWidth / 2}
                      y={labelY}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight="600"
                      fontFamily="var(--font-geist-mono), monospace"
                      fill={labelColor}
                    >
                      {seg.value > 0 ? `+${seg.value}` : seg.value}
                    </Text>
                  );
                })()}

                {/* Base and Final value labels */}
                {(seg.key === "base" || seg.key === "final") && (
                  <Text
                    x={barX + barWidth / 2}
                    y={barY - 6}
                    textAnchor="middle"
                    fontSize={14}
                    fontWeight="bold"
                    fontFamily="var(--font-geist-mono), monospace"
                    fill={seg.key === "final" ? seg.color : SVG_COLORS.foreground}
                  >
                    {seg.key === "base" ? baseScore : finalScore}
                  </Text>
                )}
              </Group>
            );
          })}

          {/* X-axis labels */}
          {segments.map((seg) => {
            const barX = xScale(seg.key) ?? 0;
            const barWidth = xScale.bandwidth();
            const isSpecial = seg.key === "base" || seg.key === "final";

            if (!isSpecial && barWidth < 12) return null;

            // Special labels (Base/Final): always horizontal, centered
            if (isSpecial) {
              return (
                <Text
                  key={`label-${seg.key}`}
                  x={barX + barWidth / 2}
                  y={innerHeight + 18}
                  textAnchor="middle"
                  fontSize={11}
                  fill={SVG_COLORS.foreground}
                  fontWeight="600"
                >
                  {seg.label}
                </Text>
              );
            }

            // Finding labels: always rotated -45deg for readability
            const truncLen = Math.max(12, Math.min(24, Math.floor(barWidth * 0.6)));
            const labelText = seg.label.length > truncLen
              ? `${seg.label.slice(0, truncLen - 1)}...`
              : seg.label;

            return (
              <Text
                key={`label-${seg.key}`}
                x={barX + barWidth / 2}
                y={innerHeight + 10}
                textAnchor="end"
                fontSize={10}
                fill={SVG_COLORS.muted}
                angle={-45}
                width={120}
              >
                {labelText}
              </Text>
            );
          })}
        </Group>
      </svg>

      {tooltipOpen && tooltipData && (
        <ChartTooltip top={tooltipTop ?? 0} left={tooltipLeft ?? 0}>
          <div className="space-y-1">
            <p className="font-medium text-xs" style={{ color: SVG_COLORS.foreground }}>
              {tooltipData.label}
            </p>
            <p
              className="font-mono text-xs tabular-nums"
              style={{
                color: tooltipData.impact > 0 ? SVG_COLORS.good : tooltipData.impact < 0 ? SVG_COLORS.high : SVG_COLORS.muted,
              }}
            >
              {tooltipData.impact > 0 ? "+" : ""}
              {tooltipData.impact} pts
            </p>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}

export function ScoreWaterfall({ findings, finalScore, grade, baseScore, onFindingClick }: ScoreWaterfallProps) {
  const { t } = useTranslation();
  const impactFindings = findings.filter((f) => f.scoreImpact !== 0);
  if (impactFindings.length === 0) return null;

  return (
    <div className="w-full glass rounded-xl p-4 sm:p-6">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
        {t("viz.waterfall.title", { defaultValue: "Score breakdown" })}
      </h3>
      <div style={{ minHeight: MIN_HEIGHT }}>
        <ParentSize>
          {({ width }) => (
            <WaterfallChart
              width={width}
              height={Math.max(MIN_HEIGHT, Math.min(280, width * 0.5))}
              findings={findings}
              finalScore={finalScore}
              grade={grade}
              baseScore={baseScore}
              onFindingClick={onFindingClick}
            />
          )}
        </ParentSize>
      </div>
    </div>
  );
}
