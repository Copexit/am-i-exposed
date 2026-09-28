"use client";

import { SVG_COLORS } from "../shared/svgConstants";
import type { ScoringResult } from "@/lib/types";

const BAR_W = 3;
const BAR_GAP = 1;
/** Widest sparkline (5 severity bars); node badges keep this much clear. */
export const SPARKLINE_MAX_W = 5 * (BAR_W + BAR_GAP) - BAR_GAP;

interface PrivacySparklineProps {
  scoringResult: ScoringResult;
  nodeX: number;
  nodeY: number;
  nodeWidth: number;
  nodeHeight: number;
}

export function PrivacySparkline({
  scoringResult,
  nodeX,
  nodeY,
  nodeWidth,
  nodeHeight,
}: PrivacySparklineProps) {
  const sevCounts = { critical: 0, high: 0, medium: 0, low: 0, good: 0 };
  for (const f of scoringResult.findings) {
    if (f.severity in sevCounts) sevCounts[f.severity as keyof typeof sevCounts]++;
  }
  const bars = [
    { count: sevCounts.critical, color: SVG_COLORS.critical },
    { count: sevCounts.high, color: SVG_COLORS.high },
    { count: sevCounts.medium, color: SVG_COLORS.medium },
    { count: sevCounts.low, color: SVG_COLORS.low },
    { count: sevCounts.good, color: SVG_COLORS.good },
  ].filter((b) => b.count > 0);

  if (bars.length === 0) return null;

  const maxCount = Math.max(...bars.map((b) => b.count), 1);
  const barW = BAR_W;
  const barGap = BAR_GAP;
  const totalW = bars.length * (barW + barGap) - barGap;
  const startX = nodeX + nodeWidth - totalW - 6;
  // Bottom row only (below the summary line's baseline at nodeY + 38)
  const maxH = 10;
  const baseY = nodeY + nodeHeight - 4;

  return (
    <g style={{ pointerEvents: "none" }}>
      {bars.map((b, bi) => {
        const h = Math.max(2, (b.count / maxCount) * maxH);
        return (
          <rect
            key={bi}
            x={startX + bi * (barW + barGap)}
            y={baseY - h}
            width={barW}
            height={h}
            rx={0.5}
            fill={b.color}
            fillOpacity={0.6}
          />
        );
      })}
    </g>
  );
}
