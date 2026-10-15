"use client";

import { useTranslation } from "react-i18next";
import { SVG_COLORS } from "../shared/svgConstants";
import { MARGIN } from "./constants";
import type { TimeColumn } from "./layout";

/** Baseline of the header row, just above the first node of each column. */
const HEADER_Y = MARGIN.top - 10;

/**
 * Chronological layout headers: block height and date above each column, and
 * a "... N blocks" marker between columns more than one block apart.
 */
export function TimeAxis({ columns }: { columns: TimeColumn[] }) {
  const { t, i18n } = useTranslation();
  return (
    <g data-testid="time-axis" style={{ pointerEvents: "none" }} fontSize={10}>
      {columns.map((col, i) => {
        const prev = columns[i - 1];
        const label = col.height === null
          ? t("graph.unconfirmed", { defaultValue: "Unconfirmed" })
          : `#${col.height.toLocaleString(i18n.language)}${col.time ? ` · ${new Date(col.time * 1000).toLocaleDateString(i18n.language)}` : ""}`;
        return (
          <g key={col.x}>
            <text x={col.x} y={HEADER_Y} fill={SVG_COLORS.muted} fontWeight={600} data-testid="time-column-header">
              {label}
            </text>
            <line x1={col.x} x2={col.x + col.width} y1={HEADER_Y + 4} y2={HEADER_Y + 4} stroke={SVG_COLORS.muted} strokeOpacity={0.25} />
            {prev && col.gap > 1 && (
              <text x={(prev.x + prev.width + col.x) / 2} y={HEADER_Y} textAnchor="middle" fill={SVG_COLORS.muted} fillOpacity={0.7} fontStyle="italic">
                {t("graph.timeGap", { count: col.gap, defaultValue: "... {{count}} blocks" })}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
