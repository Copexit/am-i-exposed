"use client";

import { useTranslation } from "react-i18next";
import { fmtN } from "@/lib/format";
import { Sparkline } from "./Sparkline";
import {
  whirlpool30dDelta,
  whirlpoolSparkline,
} from "@/lib/observatory/selectors";
import type {
  WhirlpoolCharts,
  WhirlpoolPoolStats,
} from "@/lib/observatory/types";

interface WhirlpoolPoolCardProps {
  pool: WhirlpoolPoolStats;
  /** Full charts payload, used for the inline sparkline + 30d delta. */
  charts: WhirlpoolCharts | null;
}

function fmtBtc(value: number): string {
  return `${value.toFixed(3).replace(/\.?0+$/, "")} BTC`;
}

export function WhirlpoolPoolCard({ pool, charts }: WhirlpoolPoolCardProps) {
  const { t } = useTranslation();
  const points = charts ? whirlpoolSparkline(charts, pool.pool) : [];
  const delta30d = charts ? whirlpool30dDelta(charts, pool.pool) : null;

  const deltaArrow = delta30d == null ? null : delta30d > 0 ? "↑" : delta30d < 0 ? "↓" : "·";
  const deltaTone =
    delta30d == null
      ? "text-muted"
      : delta30d > 0
        ? "text-emerald-300"
        : delta30d < 0
          ? "text-amber-300"
          : "text-muted";

  return (
    <div className="rounded-xl border border-card-border bg-surface-elevated/50 p-4 sm:p-5 space-y-4 min-w-0">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3
          className="text-base sm:text-lg font-semibold text-foreground"
          style={{ color: pool.color }}
        >
          {pool.label}
        </h3>
        <span className="text-xs sm:text-sm text-muted">
          {fmtN(pool.cycles)}{" "}
          {t("observatory.whirlpool.cyclesLifetime", { defaultValue: "cycles" })}
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-2xl sm:text-3xl font-bold text-bitcoin tabular-nums">
            {fmtBtc(pool.unspent_btc)}
          </div>
          {delta30d != null && (
            <span
              className={`text-xs font-medium tabular-nums whitespace-nowrap ${deltaTone}`}
            >
              {deltaArrow} {fmtBtc(Math.abs(delta30d))}{" "}
              {t("observatory.whirlpool.delta30dShort", { defaultValue: "(30d)" })}
            </span>
          )}
        </div>
        <div className="text-xs text-muted">
          {t("observatory.whirlpool.unspentCapacity", {
            defaultValue: "unspent capacity",
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Stat
          label={t("observatory.whirlpool.lifetimeEnteredLabel", {
            defaultValue: "Lifetime entered",
          })}
          value={fmtBtc(pool.entered_btc)}
        />
        <Stat
          label={t("observatory.whirlpool.unspentUtxos", {
            defaultValue: "Unspent UTXOs",
          })}
          value={fmtN(pool.unspent_utxos)}
        />
        <Stat
          label={t("observatory.whirlpool.tx0Count", {
            defaultValue: "TX0s",
          })}
          value={fmtN(pool.tx0_count)}
        />
        <Stat
          label={t("observatory.whirlpool.avgFeeEfficiency", {
            defaultValue: "Avg fee efficiency",
          })}
          value={`${pool.avg_fee_efficiency_pct.toFixed(2)}%`}
        />
      </div>

      <Sparkline
        points={points}
        height={48}
        stroke={pool.color}
        fill={pool.color}
        className="w-full text-bitcoin"
        ariaLabel={`${pool.label} capacity history`}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted truncate">{label}</div>
      <div className="text-base font-medium text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}
