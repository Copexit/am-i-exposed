"use client";

import { useTranslation } from "react-i18next";
import { fmtN } from "@/lib/format";
import {
  sumRecentFreshInputs,
  unpaidCoordinators,
  projectCoordinators,
  whirlpool30dDelta,
  whirlpoolLifetimeEntered,
} from "@/lib/observatory/selectors";
import type {
  LiquiSabiDashboard,
  WhirlpoolCharts,
  WhirlpoolSummary,
} from "@/lib/observatory/types";

interface ObservatoryHeroProps {
  whirlpool: WhirlpoolSummary | null;
  whirlpoolCharts: WhirlpoolCharts | null;
  liquisabi: LiquiSabiDashboard | null;
  loading: boolean;
}

interface Tile {
  value: string | null;
  labelKey: string;
  defaultLabel: string;
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
}: ObservatoryHeroProps) {
  const { t } = useTranslation();

  const lifetimeEntered = whirlpool ? whirlpoolLifetimeEntered(whirlpool) : null;
  const delta30d =
    whirlpoolCharts ? whirlpool30dDelta(whirlpoolCharts) : null;
  const fresh24h = liquisabi ? sumRecentFreshInputs(liquisabi.Graph, 1) : 0;
  const activeCoordinators = liquisabi
    ? unpaidCoordinators(projectCoordinators(liquisabi)).filter(
        (c) => c.roundCount > 0,
      ).length
    : null;

  const tiles: Tile[] = [
    {
      value: lifetimeEntered != null ? fmtBtc(lifetimeEntered) : null,
      labelKey: "observatory.hero.totalPoolSize",
      defaultLabel: "Whirlpool lifetime entered",
    },
    {
      value: delta30d != null ? fmtBtcSigned(delta30d) : null,
      labelKey: "observatory.hero.entered30d",
      defaultLabel: "Whirlpool capacity Δ (30d)",
    },
    {
      value: liquisabi ? fmtBtc(fresh24h) : null,
      labelKey: "observatory.hero.freshInputs24h",
      defaultLabel: "WabiSabi fresh inputs (24h)",
    },
    {
      value: activeCoordinators != null ? fmtN(activeCoordinators) : null,
      labelKey: "observatory.hero.activeCoordinators",
      defaultLabel: "Active free coordinators",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        </div>
      ))}
    </div>
  );
}
