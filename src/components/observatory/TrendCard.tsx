"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface TrendCardProps {
  title: string;
  /** All plotted y values, used for the min/max header. */
  ys: number[];
  ready: boolean;
  loading: boolean;
  /** The chart, rendered once data is ready. */
  children: ReactNode;
  footer?: ReactNode;
}

/** Card shell for a 30-day trend chart: min/max header, chart, loading and empty states. */
export function TrendCard({ title, ys, ready, loading, children, footer }: TrendCardProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-card-border bg-surface-elevated/50 p-4 sm:p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {ready && ys.length > 1 && (
          <div className="text-xs text-muted tabular-nums whitespace-nowrap">
            {t("observatory.trends.minMax", {
              defaultValue: "min {{min}} · max {{max}} BTC",
              min: Math.min(...ys).toFixed(2),
              max: Math.max(...ys).toFixed(2),
            })}
          </div>
        )}
      </div>
      {ready ? (
        <>
          {children}
          {footer}
        </>
      ) : loading ? (
        <div className="h-[220px] rounded bg-surface-elevated/60 animate-pulse" />
      ) : (
        <div className="h-[220px] flex items-center justify-center text-xs text-muted/70">
          {t("observatory.trends.empty", {
            defaultValue: "No trend data available right now.",
          })}
        </div>
      )}
    </div>
  );
}
