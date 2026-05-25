"use client";

import { useTranslation } from "react-i18next";
import { SVG_COLORS, GRADE_HEX_SVG } from "../shared/svgConstants";
import { ChartTooltip, type useChartTooltip } from "../shared/ChartTooltip";
import { probColor } from "../shared/linkabilityColors";
import { entropyColor } from "./privacyGradient";
import { truncateId } from "@/lib/constants";
import { ENTITY_CATEGORY_COLORS } from "./constants";
import type { TooltipData } from "./types";
import type { ScoringResult } from "@/lib/types";

interface GraphTooltipContentProps {
  tooltip: ReturnType<typeof useChartTooltip<TooltipData>>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  heatMapActive: boolean;
  heatMap: Map<string, ScoringResult>;
}

export function GraphTooltipContent({ tooltip, scrollRef, heatMapActive, heatMap }: GraphTooltipContentProps) {
  const { t } = useTranslation();

  if (!tooltip.tooltipOpen || !tooltip.tooltipData) return null;

  const data = tooltip.tooltipData;

  return (
    <ChartTooltip top={tooltip.tooltipTop} left={tooltip.tooltipLeft} containerRef={scrollRef}>
      {data.linkProb !== undefined || data.entropyNormalized !== undefined ? (
        /* Edge hover: linkability or entropy chip */
        <div className="flex items-center gap-2">
          {data.linkProb !== undefined && (
            <div className="flex items-center gap-1.5">
              <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: probColor(data.linkProb), display: "inline-block", flexShrink: 0 }} />
              <span className="text-xs font-medium" style={{ color: SVG_COLORS.foreground }}>{Math.round(data.linkProb * 100)}{t("graph.linkabilityPercent", { defaultValue: "% linkability" })}</span>
            </div>
          )}
          {data.entropyNormalized !== undefined && (
            <div className="flex items-center gap-1.5">
              <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: entropyColor(data.entropyNormalized), display: "inline-block", flexShrink: 0 }} />
              <span className="text-xs font-medium" style={{ color: SVG_COLORS.foreground }}>
                {(data.entropyBits ?? 0).toFixed(2)} {t("graph.effectiveEntropy", { defaultValue: "bits effective entropy" })}
              </span>
            </div>
          )}
        </div>
      ) : (
        /* Node hover: minimal chip - only data NOT already on the canvas label */
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-xs" style={{ color: SVG_COLORS.muted }}>{truncateId(data.txid, 6)}</span>
          {data.entityLabel ? (
            <span className="text-xs font-medium" style={{ color: ENTITY_CATEGORY_COLORS[data.entityCategory ?? "unknown"] }}>
              {data.entityLabel}
              {data.entityOfac && <span style={{ color: SVG_COLORS.critical }}> OFAC</span>}
            </span>
          ) : data.isCoinJoin ? (
            <span className="text-xs font-medium" style={{ color: SVG_COLORS.good }}>
              {data.coinJoinType ?? "CoinJoin"}
            </span>
          ) : null}
          <span className="text-xs" style={{ color: SVG_COLORS.muted }}>{data.feeRate} sat/vB</span>
          {!data.confirmed && (
            <span className="text-xs font-medium" style={{ color: SVG_COLORS.medium }}>{t("graph.unconfirmed", { defaultValue: "Unconfirmed" })}</span>
          )}
          {(() => {
            const heatEntry = heatMapActive ? heatMap.get(data.txid) : undefined;
            return heatEntry ? (
              <span className="text-xs font-semibold" style={{ color: GRADE_HEX_SVG[heatEntry.grade] }}>
                {heatEntry.grade}
              </span>
            ) : null;
          })()}
        </div>
      )}
    </ChartTooltip>
  );
}
