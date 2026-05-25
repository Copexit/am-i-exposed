"use client";

import { useTranslation } from "react-i18next";
import { fmtN } from "@/lib/format";
import {
  sumRecentFreshInputs,
  unpaidCoordinators,
  projectCoordinators,
} from "@/lib/observatory/selectors";
import type {
  LiquiSabiDashboard,
  WhirlpoolSummary,
} from "@/lib/observatory/types";

interface ObservatoryHeroProps {
  whirlpool: WhirlpoolSummary | null;
  liquisabi: LiquiSabiDashboard | null;
  loading: boolean;
}

interface Tile {
  value: string | null;
  labelKey: string;
  defaultLabel: string;
  group: "whirlpool" | "wabisabi";
}

const EMPTY = "·";

function fmtBtc(value: number): string {
  // Strip trailing zeros after a decimal point so "12.700" renders as "12.7".
  return `${value.toFixed(3).replace(/\.?0+$/, "")} BTC`;
}

export function ObservatoryHero({ whirlpool, liquisabi, loading }: ObservatoryHeroProps) {
  const { t } = useTranslation();

  const totalPoolSize = whirlpool
    ? whirlpool.pools.reduce((acc, p) => acc + p.poolsize_btc, 0)
    : null;
  const totalWhirlpoolCycles = whirlpool
    ? whirlpool.pools.reduce((acc, p) => acc + p.cycles, 0)
    : null;
  const freshInputs30d = liquisabi
    ? sumRecentFreshInputs(liquisabi.Graph, liquisabi.Graph.length)
    : null;
  const activeCoordinators = liquisabi
    ? unpaidCoordinators(projectCoordinators(liquisabi)).filter(
        (c) => c.roundCount > 0,
      ).length
    : null;

  const tiles: Tile[] = [
    {
      value: totalPoolSize != null ? fmtBtc(totalPoolSize) : null,
      labelKey: "observatory.hero.totalPoolSize",
      defaultLabel: "Whirlpool pool size",
      group: "whirlpool",
    },
    {
      value: totalWhirlpoolCycles != null ? fmtN(totalWhirlpoolCycles) : null,
      labelKey: "observatory.hero.whirlpoolCycles",
      defaultLabel: "Whirlpool cycles (lifetime)",
      group: "whirlpool",
    },
    {
      value: freshInputs30d != null ? fmtBtc(freshInputs30d) : null,
      labelKey: "observatory.hero.freshInputs30d",
      defaultLabel: "WabiSabi fresh inputs (30d)",
      group: "wabisabi",
    },
    {
      value: activeCoordinators != null ? fmtN(activeCoordinators) : null,
      labelKey: "observatory.hero.activeCoordinators",
      defaultLabel: "Active free coordinators",
      group: "wabisabi",
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

