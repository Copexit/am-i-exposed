"use client";

import { useTranslation } from "react-i18next";
import { fmtBtc, fmtCount } from "@/lib/observatory/obs-format";
import type { Period } from "@/lib/observatory/wabisator-client";
import type { FlowMap } from "@/lib/observatory/wabisator-types";

export function usePeriodLabel(period: Period): string {
  const { t } = useTranslation();
  return period === 1
    ? t("observatory.wabisabi.period.1", { defaultValue: "24 h" })
    : period === 7
      ? t("observatory.wabisabi.period.7", { defaultValue: "7 d" })
      : t("observatory.wabisabi.period.30", { defaultValue: "30 d" });
}

/** The period's four headline numbers, as glass tiles. `totals` null renders value skeletons. */
export function StatsStrip({ totals, period }: { totals: FlowMap["Totals"] | null; period: Period }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const periodLabel = usePeriodLabel(period);
  const tiles = [
    { id: "volume", label: t("observatory.wabisabi.stats.volume", { defaultValue: "Volume" }), value: totals && fmtBtc(totals.Volume, locale), unit: "BTC" },
    { id: "coinjoins", label: t("observatory.wabisabi.stats.coinjoins", { defaultValue: "CoinJoins" }), value: totals && fmtCount(totals.Coinjoins, locale), unit: null },
    { id: "fresh", label: t("observatory.wabisabi.stats.fresh", { defaultValue: "Fresh bitcoin" }), value: totals && fmtBtc(totals.FreshBtc, locale), unit: "BTC" },
    { id: "remix", label: t("observatory.wabisabi.stats.crossRemix", { defaultValue: "Cross-coordinator remix" }), value: totals && fmtBtc(totals.CrossRemixBtc, locale), unit: "BTC" },
  ];

  return (
    <dl
      aria-label={t("observatory.wabisabi.stats.label", { defaultValue: "Totals for the last {{period}}", period: periodLabel })}
      className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3"
    >
      {tiles.map((tile) => (
        <div key={tile.id} data-testid={`obs-stat-${tile.id}`} className="glass min-w-0 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3.5">
          <dt className="eyebrow truncate">{tile.label}</dt>
          <dd className="mt-2 flex items-baseline gap-1.5 min-w-0">
            {tile.value != null ? (
              <>
                <span className="num text-lg sm:text-2xl leading-none text-foreground truncate motion-safe:animate-[obs-fade_250ms_ease-out]">{tile.value}</span>
                {tile.unit && <span className="num text-[11px] text-muted">{tile.unit}</span>}
              </>
            ) : (
              <span aria-hidden="true" className="block h-5 sm:h-6 w-20 sm:w-24 rounded bg-surface-2 motion-safe:animate-pulse" />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
