"use client";

import { useMemo, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Pie } from "@visx/shape";
import { Group } from "@visx/group";
import { useTranslation } from "react-i18next";
import { SEVERITY_HEX, ANIMATION_DEFAULTS } from "./shared/svgConstants";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import type { Finding, Severity } from "@/lib/types";

interface SeverityRingProps {
  findings: Finding[];
  size?: number;
}

interface SeveritySlice {
  severity: Severity;
  count: number;
  color: string;
}

interface TooltipData {
  severity: string;
  count: number;
  color: string;
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "good"];

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  good: "Good",
};

export function SeverityRing({ findings, size = 120 }: SeverityRingProps) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const { tooltipOpen, tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip, handleTouch } =
    useChartTooltip<TooltipData>();

  const slices = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of findings) {
      counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    }
    return SEVERITY_ORDER
      .filter((s) => (counts[s] ?? 0) > 0)
      .map((s): SeveritySlice => ({
        severity: s,
        count: counts[s],
        color: SEVERITY_HEX[s],
      }));
  }, [findings]);

  if (slices.length === 0) return null;

  const radius = size / 2;
  const innerRadius = radius * 0.6;

  return (
    <div className="flex flex-col items-center gap-0 flex-shrink-0">
      <div
        className="relative"
        ref={containerRef}
        onTouchStart={handleTouch}
        role="img"
        aria-label={t("viz.ring.aria", {
          total: findings.length,
          defaultValue: `Severity distribution: ${findings.length} findings`,
        })}
      >
        <svg width={size} height={size}>
          <Group top={radius} left={radius}>
            <Pie<SeveritySlice>
              data={slices}
              pieValue={(d) => d.count}
              outerRadius={radius - 4}
              innerRadius={innerRadius}
              padAngle={0.04}
              cornerRadius={3}
            >
              {(pie) =>
                pie.arcs.map((arc, i) => {
                  const path = pie.path(arc) ?? "";
                  const [centroidX, centroidY] = pie.path.centroid(arc);
                  return (
                    <motion.path
                      key={arc.data.severity}
                      d={path}
                      fill={arc.data.color}
                      fillOpacity={0.85}
                      initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{
                        delay: i * ANIMATION_DEFAULTS.stagger,
                        duration: ANIMATION_DEFAULTS.duration,
                        ease: [0.4, 0, 0.2, 1],
                      }}
                      onMouseEnter={() => {
                        showTooltip({
                          tooltipData: {
                            severity: t(`severity.${arc.data.severity}`, { defaultValue: SEVERITY_LABELS[arc.data.severity] }),
                            count: arc.data.count,
                            color: arc.data.color,
                          },
                          tooltipLeft: radius + centroidX,
                          tooltipTop: radius + centroidY - 12,
                        });
                      }}
                      onMouseLeave={() => hideTooltip()}
                      style={{ cursor: "default" }}
                    />
                  );
                })
              }
            </Pie>

            {/* Center count */}
            <text
              textAnchor="middle"
              dy="-0.15em"
              fill="#f0f0f2"
              fontSize={size >= 120 ? 26 : size >= 100 ? 22 : 18}
              fontWeight="bold"
              fontFamily="var(--font-geist-mono), monospace"
            >
              {findings.length}
            </text>
            <text
              textAnchor="middle"
              dy="1.5em"
              fill="#c8c8d0"
              fontSize={size >= 120 ? 12 : 10}
            >
              {t("viz.ring.findings", { defaultValue: "findings" })}
            </text>
          </Group>
        </svg>

        {tooltipOpen && tooltipData && (
          <ChartTooltip top={tooltipTop ?? 0} left={tooltipLeft ?? 0}>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: tooltipData.color }}
              />
              <span className="text-xs font-medium" style={{ color: "#f0f0f2" }}>
                {tooltipData.severity}
              </span>
              <span className="text-xs font-mono tabular-nums" style={{ color: "#c8c8d0" }}>
                {tooltipData.count}
              </span>
            </div>
          </ChartTooltip>
        )}
      </div>

    </div>
  );
}
