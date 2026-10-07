"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { P2pHistory } from "@/hooks/useP2p";
import type { HistoryRange } from "@/lib/observatory/coordinator-page";
import { ROBOSATS_COORDINATORS } from "@/lib/observatory/p2p/normalize-robosats";
import { athOf, rangeSlice, shares } from "@/lib/observatory/p2p/volume";
import { hostColorVar, venueColorVar, venueFgVar } from "@/lib/observatory/p2p/venue-palette";
import { fmtBtc, fmtCount } from "@/lib/observatory/obs-format";
import { VolumeHistoryChart } from "@/components/observatory/wabisabi/VolumeHistoryChart";
import { BONE, CHIP, CHIP_OFF, CHIP_ON, FADE } from "./p2p-ui";

const RANGES: HistoryRange[] = ["30d", "90d", "1y", "all"];
const TOTAL_COORDINATORS = ROBOSATS_COORDINATORS.length;

/** RoboSats daily federation volume with per-coordinator shares, Mostro's last 7 days, and the HodlHodl note. */
export function P2pVolume({ history, isUmbrel, today }: { history: P2pHistory; isUmbrel: boolean; today: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const [range, setRange] = useState<HistoryRange>("1y");
  const series = useMemo(() => rangeSlice(history.robosats, range, today), [history.robosats, range, today]);
  const share = useMemo(() => shares(history.perCoordinator, range, today), [history.perCoordinator, range, today]);
  const name = (key: string) => ROBOSATS_COORDINATORS.find((c) => c.key === key)?.name ?? key;
  const rangeLabel: Record<HistoryRange, string> = {
    "30d": t("observatory.wabisabi.coord.range.30d", { defaultValue: "30 d" }),
    "90d": t("observatory.wabisabi.coord.range.90d", { defaultValue: "90 d" }),
    "1y": t("observatory.wabisabi.coord.range.1y", { defaultValue: "1 y" }),
    all: t("observatory.wabisabi.coord.range.all", { defaultValue: "All" }),
  };
  const trades = (n: number) => t("observatory.p2p.volume.trades", { defaultValue: "{{formatted}} trades", count: n, formatted: fmtCount(n, locale) });
  const maxMostro = Math.max(1, ...history.mostro.map((d) => d.trades));
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const robosatsReady = !history.loading || history.robosats.length > 0;

  return (
    <div className="space-y-12">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <span aria-hidden="true" className="size-2 rounded-full" style={{ background: venueFgVar("robosats") }} />
              {t("observatory.p2p.volume.robosats", { defaultValue: "RoboSats daily volume" })}
            </h3>
            <p data-testid="p2p-volume-coverage" className="text-sm text-muted text-pretty">
              {t("observatory.p2p.volume.coverage", { defaultValue: "{{n}} of {{total}} coordinators", n: history.coordinators, total: TOTAL_COORDINATORS })}
              {!isUmbrel && (
                <span className="text-faint">{` ${t("observatory.p2p.volume.torNote", { defaultValue: "(the rest are reachable through Tor on a self-hosted node)" })}`}</span>
              )}
            </p>
          </div>
          <div role="group" aria-label={t("observatory.wabisabi.coord.range.label", { defaultValue: "Range" })} className="inline-flex gap-1 rounded-lg border border-card-border bg-surface-inset p-1">
            {RANGES.map((r) => (
              <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} className={`${CHIP} num ${range === r ? CHIP_ON : CHIP_OFF}`}>
                {rangeLabel[r]}
              </button>
            ))}
          </div>
        </div>
        {robosatsReady ? (
          <div className={FADE}>
            <VolumeHistoryChart
              points={series.map((d) => ({ date: d.date, volume: d.btc, coinjoins: d.trades }))}
              ath={athOf(series)}
              color={venueFgVar("robosats")}
              partialLast={series.at(-1)?.date === today}
              height={260}
              countLabel={trades}
              emptyLabel={t("observatory.p2p.volume.empty", { defaultValue: "No volume history for this range." })}
              label={t("observatory.p2p.volume.chartLabel", { defaultValue: "RoboSats daily volume, {{range}}", range: rangeLabel[range] })}
            />
          </div>
        ) : (
          <div aria-hidden="true" className={`h-[260px] ${BONE} rounded-xl`} />
        )}
        {share.length > 0 && (
          <ul aria-label={t("observatory.p2p.volume.shares", { defaultValue: "Share of volume by coordinator" })} className="grid gap-2 sm:grid-cols-2">
            {share.map((s) => (
              <li key={s.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-foreground">{name(s.key)}</span>
                  <span className="num text-xs text-muted">{`${fmtBtc(s.btc, locale)} BTC · ${s.pct.toLocaleString(locale, { maximumFractionDigits: 0 })}%`}</span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-2">
                  <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${Math.max(1, s.pct)}%`, background: hostColorVar("robosats", s.key) }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: venueFgVar("mostro") }} />
            {t("observatory.p2p.volume.mostro", { defaultValue: "Mostro completed trades" })}
          </h3>
          <p className="text-sm text-muted">{t("observatory.p2p.volume.mostroLead", { defaultValue: "Seen on public relays, last 7 days. Relays cap how far back they answer, so older days are not shown." })}</p>
        </div>
        {history.mostro.length ? (
          <ol data-testid="p2p-mostro-days" className={`grid grid-cols-7 items-end gap-1.5 sm:gap-3 ${FADE}`}>
            {history.mostro.map((d) => (
              <li key={d.date} className="flex flex-col items-center gap-1.5" aria-label={`${d.date}: ${trades(d.trades)}, ${fmtBtc(d.btc, locale)} BTC`}>
                <span className="num text-xs text-foreground">{fmtCount(d.trades, locale)}</span>
                <div className="flex h-28 w-full items-end rounded-md bg-surface-2/60">
                  <div className="w-full rounded-md transition-[height] duration-500 ease-out" style={{ height: `${Math.max(d.trades ? 4 : 0, (d.trades / maxMostro) * 100)}%`, background: venueColorVar("mostro") }} />
                </div>
                <span className="text-[11px] text-faint">{day.format(Date.parse(`${d.date}T00:00:00Z`))}</span>
                <span className="num hidden text-[11px] text-faint sm:block">{`${fmtBtc(d.btc, locale)} BTC`}</span>
              </li>
            ))}
          </ol>
        ) : history.loading ? (
          <div aria-hidden="true" className={`h-40 ${BONE} rounded-xl`} />
        ) : (
          <p className="text-sm text-faint">{t("observatory.p2p.volume.mostroNone", { defaultValue: "No completed trades could be read from the relays." })}</p>
        )}
      </div>

      <p className="flex items-center gap-2 text-sm text-muted">
        <span aria-hidden="true" className="size-2 rounded-full" style={{ background: venueFgVar("hodlhodl") }} />
        {t("observatory.p2p.volume.hodlhodl", { defaultValue: "HodlHodl publishes no volume data." })}
      </p>
    </div>
  );
}
