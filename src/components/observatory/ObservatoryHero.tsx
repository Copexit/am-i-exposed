"use client";

import { useTranslation } from "react-i18next";
import { fmtN } from "@/lib/format";
import {
  sumRecentFreshInputs,
  unpaidCoordinators,
  projectCoordinators,
  whirlpool30dDelta,
  whirlpoolLifetimeEntered,
  whirlpoolTotalUnspent,
} from "@/lib/observatory/selectors";
import type {
  LiquiSabiDashboard,
  WhirlpoolCharts,
  WhirlpoolSummary,
} from "@/lib/observatory/types";
import type { ObservatoryTab } from "@/hooks/useObservatoryTab";

interface ObservatoryHeroProps {
  whirlpool: WhirlpoolSummary | null;
  whirlpoolCharts: WhirlpoolCharts | null;
  liquisabi: LiquiSabiDashboard | null;
  loading: boolean;
  /** Only the tiles of this protocol are shown. */
  protocol: ObservatoryTab;
}

interface Tile {
  protocol: ObservatoryTab;
  value: string | null;
  labelKey: string;
  defaultLabel: string;
  sub?: string | null;
}

const EMPTY = "·";

function fmtBtc(value: number): string {
  return `${value.toFixed(3).replace(/\.?0+$/, "")} BTC`;
}

function fmtBtcSigned(value: number): string {
  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "·";
  return `${arrow} ${fmtBtc(Math.abs(value))}`;
}

export function ObservatoryHero({
  whirlpool,
  whirlpoolCharts,
  liquisabi,
  loading,
  protocol,
}: ObservatoryHeroProps) {
  const { t } = useTranslation();

  const lifetimeEntered = whirlpool ? whirlpoolLifetimeEntered(whirlpool) : null;
  const unspent = whirlpool ? whirlpoolTotalUnspent(whirlpool) : null;
  const delta30d =
    whirlpoolCharts ? whirlpool30dDelta(whirlpoolCharts) : null;
  const fresh24h = liquisabi ? sumRecentFreshInputs(liquisabi.Graph, 1) : 0;
  const activeCoordinators = liquisabi
    ? unpaidCoordinators(projectCoordinators(liquisabi)).filter(
        (c) => c.roundCount > 0,
      ).length
    : null;

  const delta30dSub =
    delta30d != null
      ? t("observatory.hero.deltaSub", {
          defaultValue: "{{delta}} (30d)",
          delta: fmtBtcSigned(delta30d),
        })
      : null;

  const allTiles: Tile[] = [
    {
      protocol: "whirlpool",
      value: lifetimeEntered != null ? fmtBtc(lifetimeEntered) : null,
      labelKey: "observatory.hero.totalPoolSize",
      defaultLabel: "Whirlpool lifetime entered",
    },
    {
      protocol: "whirlpool",
      value: unspent != null ? fmtBtc(unspent) : null,
      labelKey: "observatory.hero.liveUnspent",
      defaultLabel: "Whirlpool unspent (live)",
      sub: delta30dSub,
    },
    {
      protocol: "wabisabi",
      value: liquisabi ? fmtBtc(fresh24h) : null,
      labelKey: "observatory.hero.freshInputs24h",
      defaultLabel: "WabiSabi fresh inputs (24h)",
    },
    {
      protocol: "wabisabi",
      value: activeCoordinators != null ? fmtN(activeCoordinators) : null,
      labelKey: "observatory.hero.activeCoordinators",
      defaultLabel: "Active free coordinators",
    },
  ];
  const tiles = allTiles.filter((tile) => tile.protocol === protocol);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {tiles.map((tile) => (
        <div
          key={tile.labelKey}
          className="rounded-xl border border-card-border bg-surface-elevated/50 p-4 sm:p-5"
        >
          {tile.value != null ? (
            <div className="text-xl sm:text-2xl font-bold text-bitcoin tabular-nums">
              {tile.value}
            </div>
          ) : loading ? (
            <div className="h-7 sm:h-8 w-20 sm:w-24 rounded bg-surface-elevated/80 animate-pulse" />
          ) : (
            <div className="text-xl sm:text-2xl font-bold text-muted/40 tabular-nums">
              {EMPTY}
            </div>
          )}
          <div className="mt-1 text-xs sm:text-sm text-muted">
            {t(tile.labelKey, { defaultValue: tile.defaultLabel })}
          </div>
          {tile.sub && (
            <div className="mt-0.5 text-[11px] text-muted/70 tabular-nums">
              {tile.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
