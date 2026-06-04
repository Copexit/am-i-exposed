"use client";

import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/PageShell";
import { useNetwork } from "@/context/NetworkContext";
import { useObservatory } from "@/hooks/useObservatory";
import { useChainTip } from "@/hooks/useChainTip";
import { ObservatoryHero } from "@/components/observatory/ObservatoryHero";
import { WhirlpoolPoolCard } from "@/components/observatory/WhirlpoolPoolCard";
import { WabiSabiCoordinatorCard } from "@/components/observatory/WabiSabiCoordinatorCard";
import { ObservatoryAttribution } from "@/components/observatory/ObservatoryAttribution";
import { ObservatoryErrorState } from "@/components/observatory/ObservatoryErrorState";
import { TrendChart, type TrendSeries } from "@/components/observatory/TrendChart";
import {
  liquiSabiFreshInputSparkline,
  projectCoordinators,
  whirlpoolLifetimeCycles,
  whirlpoolLifetimeEntered,
  whirlpoolSparkline,
} from "@/lib/observatory/selectors";
import { fmtN } from "@/lib/format";
import type { LiquiSabiGraphEntry } from "@/lib/observatory/types";

function fmtBtc(value: number): string {
  return `${value.toFixed(3).replace(/\.?0+$/, "")} BTC`;
}

export default function ObservatoryPage() {
  const { t, i18n } = useTranslation();
  const { network } = useNetwork();
  const tipHeight = useChainTip();
  const { whirlpool, liquisabi, loading, lastUpdatedAt } = useObservatory();

  const isMainnet = network === "mainnet";

  if (!isMainnet) {
    return (
      <PageShell
        backLabel={t("observatory.back", { defaultValue: "Back to scanner" })}
        maxWidth="max-w-5xl"
      >
        <Hero showMainnetBadge={false} />
        <div className="rounded-xl border border-card-border bg-surface-elevated/50 p-6 text-muted">
          {t("observatory.mainnetOnly", {
            defaultValue:
              "Live CoinJoin data is mainnet-only. Switch to mainnet in the network selector to view it.",
          })}
        </div>
      </PageShell>
    );
  }

  const coordinators = liquisabi ? projectCoordinators(liquisabi) : [];
  const wabisabiSparkline = liquisabi
    ? liquiSabiFreshInputSparkline(liquisabi.Graph)
    : [];

  const summary = whirlpool?.summary ?? null;
  const charts = whirlpool?.charts ?? null;

  const lifetimeEntered = summary ? whirlpoolLifetimeEntered(summary) : null;
  const lifetimeCycles = summary ? whirlpoolLifetimeCycles(summary) : null;

  const whirlpoolUpstreamBlock = summary?.tip_block_height ?? null;
  const lagBlocks =
    tipHeight != null && whirlpoolUpstreamBlock != null
      ? Math.max(0, tipHeight - whirlpoolUpstreamBlock)
      : null;

  // Build the multi-series payload for the Whirlpool trend chart.
  const whirlpoolSeries: TrendSeries[] = charts
    ? summary?.pools.map((p) => ({
        id: p.pool,
        label: p.label,
        color: p.color,
        points: whirlpoolSparkline(charts, p.pool),
      })) ?? []
    : [];

  return (
    <PageShell
      backLabel={t("observatory.back", { defaultValue: "Back to scanner" })}
      maxWidth="max-w-5xl"
      className="px-3 sm:px-6 lg:px-8"
    >
      <Hero showMainnetBadge />

      <ObservatoryHero
        whirlpool={summary}
        whirlpoolCharts={charts}
        liquisabi={liquisabi}
        loading={loading}
      />

      {/* Whirlpool */}
      <section className="space-y-4">
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-xl font-semibold text-foreground">
              {t("observatory.whirlpool.title", { defaultValue: "Whirlpool pools" })}
            </h2>
            {summary && (
              <SyncPill
                lagBlocks={lagBlocks}
                upstreamBlock={whirlpoolUpstreamBlock}
              />
            )}
          </div>
          {summary && lifetimeEntered != null && lifetimeCycles != null && (
            <p className="text-sm text-muted">
              {t("observatory.whirlpool.lifetimeSubtitle", {
                defaultValue:
                  "Lifetime entered: {{total}} across {{cycles}} cycles",
                total: fmtBtc(lifetimeEntered),
                cycles: fmtN(lifetimeCycles),
              })}
            </p>
          )}
        </div>
        {loading && !whirlpool ? (
          <SkeletonCards count={2} />
        ) : whirlpool ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {whirlpool.summary.pools.map((pool) => (
              <WhirlpoolPoolCard
                key={pool.pool}
                pool={pool}
                charts={whirlpool.charts}
              />
            ))}
          </div>
        ) : (
          <ObservatoryErrorState source="whirlpool" staleAt={lastUpdatedAt} />
        )}
      </section>

      {/* WabiSabi */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">
          {t("observatory.wabisabi.title", { defaultValue: "WabiSabi coordinators" })}
        </h2>
        {loading && !liquisabi ? (
          <SkeletonCards count={3} />
        ) : liquisabi ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {coordinators.map((c) => (
              <WabiSabiCoordinatorCard
                key={c.endpoint}
                coordinator={c}
                avgAnonIn={liquisabi.Summary?.AverageStandardInputsAnonSet ?? null}
                avgAnonOut={liquisabi.Summary?.AverageStandardOutputsAnonSet ?? null}
              />
            ))}
          </div>
        ) : (
          <ObservatoryErrorState source="liquisabi" staleAt={lastUpdatedAt} />
        )}
      </section>

      {/* Trends */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">
          {t("observatory.trends.title", { defaultValue: "30-day trends" })}
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <WhirlpoolTrendCard
            title={t("observatory.trends.whirlpoolCapacity", {
              defaultValue: "Whirlpool capacity per block",
            })}
            series={whirlpoolSeries}
            ready={!!whirlpool}
            loading={loading}
          />
          <WabiSabiTrendCard
            title={t("observatory.trends.wabisabiFreshInputs", {
              defaultValue: "WabiSabi fresh inputs (BTC/day)",
            })}
            points={wabisabiSparkline}
            color="#f97316"
            graph={liquisabi?.Graph}
            ready={!!liquisabi}
            loading={loading}
          />
        </div>
      </section>

      <ObservatoryAttribution
        lastUpdatedAt={lastUpdatedAt}
        locale={i18n.language || "en"}
      />
    </PageShell>
  );
}

function Hero({ showMainnetBadge }: { showMainnetBadge: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
          {t("observatory.pageTitle", { defaultValue: "CoinJoin Observatory" })}
        </h1>
        {showMainnetBadge && (
          <span className="text-[10px] font-semibold text-bitcoin/80 bg-bitcoin/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
            {t("observatory.mainnetBadge", { defaultValue: "Mainnet" })}
          </span>
        )}
      </div>
      <p className="text-muted text-lg leading-relaxed max-w-3xl">
        {t("observatory.pageDescription", {
          defaultValue:
            "Live activity for Bitcoin's two leading open-source CoinJoin protocols, sourced from independent community projects.",
        })}
      </p>
    </div>
  );
}

interface SyncPillProps {
  lagBlocks: number | null;
  upstreamBlock: number | null;
}

function SyncPill({ lagBlocks, upstreamBlock }: SyncPillProps) {
  const { t } = useTranslation();
  if (upstreamBlock == null) return null;
  if (lagBlocks == null) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-muted/10 text-muted border border-card-border">
        {t("observatory.whirlpool.atBlock", {
          defaultValue: "Block {{block}}",
          block: upstreamBlock.toLocaleString("en-US"),
        })}
      </span>
    );
  }
  const fresh = lagBlocks <= 6;
  const cls = fresh
    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
    : "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>
      {fresh
        ? t("observatory.whirlpool.nearTip", {
            defaultValue: "Block {{block}} · in sync",
            block: upstreamBlock.toLocaleString("en-US"),
          })
        : t("observatory.whirlpool.behindTip", {
            defaultValue: "Block {{block}} · {{lag}} blocks behind tip",
            block: upstreamBlock.toLocaleString("en-US"),
            lag: lagBlocks.toLocaleString("en-US"),
          })}
    </span>
  );
}

function SkeletonCards({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="h-44 rounded-xl border border-card-border bg-surface-elevated/30 animate-pulse"
        />
      ))}
    </div>
  );
}

interface WhirlpoolTrendCardProps {
  title: string;
  series: TrendSeries[];
  ready: boolean;
  loading: boolean;
}

function WhirlpoolTrendCard({
  title,
  series,
  ready,
  loading,
}: WhirlpoolTrendCardProps) {
  const { t } = useTranslation();
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const minY = allY.length ? Math.min(...allY) : 0;
  const maxY = allY.length ? Math.max(...allY) : 0;
  const start = series[0]?.points[0]?.y;
  const end = series[0]?.points[series[0].points.length - 1]?.y;
  const delta = start != null && end != null ? end - start : null;

  return (
    <div className="rounded-xl border border-card-border bg-surface-elevated/50 p-4 sm:p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {ready && allY.length > 1 && (
          <div className="text-xs text-muted tabular-nums whitespace-nowrap">
            {t("observatory.trends.minMax", {
              defaultValue: "min {{min}} · max {{max}} BTC",
              min: minY.toFixed(2),
              max: maxY.toFixed(2),
            })}
          </div>
        )}
      </div>
      {ready ? (
        <>
          <TrendChart
            series={series}
            unit="BTC"
            formatX={(v) => `#${Math.round(v).toLocaleString("en-US")}`}
            height={220}
            ariaLabel={title}
          />
          {delta != null && (
            <div className="text-xs text-muted">
              {t("observatory.trends.startEndDelta", {
                defaultValue:
                  "0.025 pool: start {{start}} BTC · end {{end}} BTC · Δ {{delta}} BTC",
                start: start!.toFixed(2),
                end: end!.toFixed(2),
                delta: (delta >= 0 ? "+" : "") + delta.toFixed(2),
              })}
            </div>
          )}
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

interface WabiSabiTrendCardProps {
  title: string;
  points: ReturnType<typeof whirlpoolSparkline>;
  color: string;
  graph: LiquiSabiGraphEntry[] | undefined;
  ready: boolean;
  loading: boolean;
}

function WabiSabiTrendCard({
  title,
  points,
  color,
  graph,
  ready,
  loading,
}: WabiSabiTrendCardProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-card-border bg-surface-elevated/50 p-4 sm:p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {ready && points.length > 1 && (
          <div className="text-xs text-muted tabular-nums whitespace-nowrap">
            {t("observatory.trends.minMax", {
              defaultValue: "min {{min}} · max {{max}} BTC",
              min: Math.min(...points.map((p) => p.y)).toFixed(2),
              max: Math.max(...points.map((p) => p.y)).toFixed(2),
            })}
          </div>
        )}
      </div>
      {ready ? (
        <TrendChart
          points={points}
          color={color}
          unit="BTC"
          formatX={(v) => labelFromGraph(graph, v)}
          height={220}
          ariaLabel={title}
        />
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

/** Map an index into the LiquiSabi graph back to its Date label (e.g. "23/05"). */
function labelFromGraph(
  graph: LiquiSabiGraphEntry[] | undefined,
  index: number,
): string {
  if (!graph || graph.length === 0) return "";
  const i = Math.max(0, Math.min(graph.length - 1, Math.round(index)));
  return graph[i]?.Date ?? "";
}
