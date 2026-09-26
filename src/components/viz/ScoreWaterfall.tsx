"use client";

import { useMemo, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { Text } from "@visx/text";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { SVG_COLORS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { buildWaterfallSegments } from "./waterfall/buildWaterfallSegments";
import type { WaterfallSegment } from "./waterfall/buildWaterfallSegments";
import { WaterfallBar } from "./waterfall/WaterfallBar";
import type { Finding, Grade } from "@/lib/types";
import { TX_BASE_SCORE } from "@/lib/scoring/score";

interface ScoreWaterfallProps {
  findings: Finding[];
  finalScore: number;
  grade: Grade;
  baseScore?: number;
  onFindingClick?: (findingId: string) => void;
}
const MARGIN = { top: 24, right: 16, bottom: 80, left: 40 };
const MIN_HEIGHT = 260;

interface TooltipData {
  label: string;
  impact: number;
  severity?: string;
  description?: string;
}

function WaterfallChart({
  width,
  height,
  findings,
  finalScore,
  grade,
  baseScore = TX_BASE_SCORE,
  onFindingClick,
}: ScoreWaterfallProps & { width: number; height: number }) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const { tooltipOpen, tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip, handleTouch } =
    useChartTooltip<TooltipData>();

  const segments = useMemo(
    () => buildWaterfallSegments(findings, finalScore, grade, baseScore, t),
    [findings, finalScore, grade, baseScore, t],
  );

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

  const handleBarMouseEnter = (e: React.MouseEvent, seg: WaterfallSegment) => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const elemRect = (e.currentTarget as Element).getBoundingClientRect();
    showTooltip({
      tooltipData: { label: seg.label, impact: seg.value, severity: seg.severity },
      tooltipLeft: elemRect.left - containerRect.left + elemRect.width / 2,
      tooltipTop: elemRect.top - containerRect.top,
    });
  };

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
            if (!next) return null;
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

            return (
              <WaterfallBar
                key={seg.key}
                seg={seg}
                index={i}
                grade={grade}
                barX={barX}
                barWidth={barWidth}
                barY={barY}
                barHeight={barHeight}
                innerHeight={innerHeight}
                baseScore={baseScore}
                finalScore={finalScore}
                reducedMotion={reducedMotion}
                onFindingClick={onFindingClick}
                onMouseEnter={handleBarMouseEnter}
                onMouseLeave={hideTooltip}
              />
            );
          })}

          {/* X-axis labels */}
          {segments.map((seg) => {
            const barX = xScale(seg.key) ?? 0;
            const barWidth = xScale.bandwidth();
            const isSpecial = seg.key === "base" || seg.key === "final";

            if (!isSpecial && barWidth < 12) return null;

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
              {tooltipData.impact} {t("viz.waterfall.pts", { defaultValue: "pts" })}
            </p>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}

export function ScoreWaterfall({ findings, finalScore, grade, baseScore, onFindingClick }: ScoreWaterfallProps) {
  const { t } = useTranslation();
  useTheme();
  const impactFindings = findings.filter((f) => f.scoreImpact !== 0);
  if (impactFindings.length === 0) return null;

  return (
    <div className="w-full glass rounded-xl p-4 sm:p-6">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
        {t("viz.waterfall.title", { defaultValue: "Score impact" })}
      </h3>
      <div style={{ minHeight: MIN_HEIGHT }}>
        <ParentSize>
          {({ width }) => width < 1 ? null : (
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
