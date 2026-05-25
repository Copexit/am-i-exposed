"use client";

import { useTranslation } from "react-i18next";
import { fmtN } from "@/lib/format";
import { Sparkline } from "./Sparkline";
import { whirlpoolSparkline } from "@/lib/observatory/selectors";
import type {
  WhirlpoolChartSeries,
  WhirlpoolPoolStats,
} from "@/lib/observatory/types";

interface WhirlpoolPoolCardProps {
  pool: WhirlpoolPoolStats;
  /** The /api/charts series for `poolsize`, used to render the sparkline. */
  poolsizeSeries: WhirlpoolChartSeries | null;
}

function fmtBtc(value: number): string {
  return `${value.toFixed(3).replace(/\.?0+$/, "")} BTC`;
}

export function WhirlpoolPoolCard({ pool, poolsizeSeries }: WhirlpoolPoolCardProps) {
  const { t } = useTranslation();
  const points = poolsizeSeries ? whirlpoolSparkline(poolsizeSeries, pool.pool) : [];

  return (
    <div className="rounded-xl border border-card-border bg-surface-elevated/50 p-4 sm:p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3
          className="text-base sm:text-lg font-semibold text-foreground"
          style={{ color: pool.color }}
        >
          {pool.label}
        </h3>
        <span className="text-xs sm:text-sm text-muted">
          {pool.cycles.toLocaleString()}{" "}
          {t("observatory.whirlpool.cyclesLifetime", {
            defaultValue: "cycles",
          })}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
        <Stat
          label={t("observatory.whirlpool.unspent", { defaultValue: "Unspent" })}
          value={fmtBtc(pool.unspent_btc)}
          sub={`${fmtN(pool.unspent_utxos)} UTXOs`}
        />
        <Stat
          label={t("observatory.whirlpool.mixedCount", { defaultValue: "Mixed" })}
          value={fmtN(pool.mixed_count)}
          sub={t("observatory.whirlpool.outputs", { defaultValue: "outputs" })}
        />
        <Stat
          label={t("observatory.whirlpool.avgFee", { defaultValue: "Avg fee" })}
          value={`${pool.avg_fee_paid_pct.toFixed(2)}%`}
        />
        <Stat
          label={t("observatory.whirlpool.unmixed", { defaultValue: "Unmixed" })}
          value={fmtBtc(pool.unmixed_btc)}
          sub={`${fmtN(pool.unmixed_utxos)} UTXOs`}
        />
      </div>

      <Sparkline
        points={points}
        width={280}
        height={40}
        stroke={pool.color}
        fill={pool.color}
        className="w-full text-bitcoin"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-base font-medium text-foreground tabular-nums">
        {value}
      </div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
