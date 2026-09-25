"use client";

import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/PageShell";
import { useNetwork } from "@/context/NetworkContext";
import { useObservatory } from "@/hooks/useObservatory";
import { useChainTip } from "@/hooks/useChainTip";
import { ObservatoryHero } from "@/components/observatory/ObservatoryHero";
import { WhirlpoolPoolCard } from "@/components/observatory/WhirlpoolPoolCard";
import { WabiSabiCoordinatorCard } from "@/components/observatory/WabiSabiCoordinatorCard";
import { RecentCyclesTable } from "@/components/observatory/RecentCyclesTable";
import { ObservatoryAttribution } from "@/components/observatory/ObservatoryAttribution";
import { ObservatoryErrorState } from "@/components/observatory/ObservatoryErrorState";
import { TrendChart, type TrendSeries } from "@/components/observatory/TrendChart";
import { TrendCard } from "@/components/observatory/TrendCard";
import { ObservatoryPageHeader } from "@/components/observatory/ObservatoryPageHeader";
import { SyncPill } from "@/components/observatory/SyncPill";
import { InactiveCoordinators } from "@/components/observatory/InactiveCoordinators";
import { SkeletonCards } from "@/components/observatory/SkeletonCards";
import {
  activeCoordinators,
  inactiveCoordinators,
  liquiSabiFreshInputSparkline,
  projectCoordinators,
  whirlpoolLifetimeCycles,
  whirlpoolLifetimeEntered,
  whirlpoolSparkline,
} from "@/lib/observatory/selectors";
import { fmtN } from "@/lib/format";
import { COLORS } from "@/lib/palette";
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
        <ObservatoryPageHeader showMainnetBadge={false} />
        <div className="rounded-xl border border-card-border bg-surface-elevated/50 p-6 text-muted">
          {t("observatory.mainnetOnly", {
            defaultValue:
              "Live CoinJoin data is mainnet-only. Switch to mainnet in the network selector to view it.",
          })}
        </div>
      </PageShell>
    );
  }

  const allCoordinators = liquisabi ? projectCoordinators(liquisabi) : [];
  const activeCoords = activeCoordinators(allCoordinators);
  const inactiveCoords = inactiveCoordinators(allCoordinators);
  const wabisabiSparkline = liquisabi
    ? liquiSabiFreshInputSparkline(liquisabi.Graph)
    : [];

  const summary = whirlpool?.summary ?? null;
  const charts = whirlpool?.charts ?? null;

  const lifetimeEntered = summary ? whirlpoolLifetimeEntered(summary) : null;
  const lifetimeCycles = summary ? whirlpoolLifetimeCycles(summary) : null;

  const whirlpoolUpstreamBlock = summary?.tip_height ?? null;
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
  const whirlpoolYs = whirlpoolSeries.flatMap((s) => s.points.map((p) => p.y));
  // The footer text says "0.025 pool", so select that pool's series by id,
  // not by upstream order.
  const refPoints = whirlpoolSeries.find((s) => s.id === "0.025_BTC_Pool")?.points ?? [];
  const refStart = refPoints[0]?.y;
  const refEnd = refPoints[refPoints.length - 1]?.y;

  const whirlpoolTrendTitle = t("observatory.trends.whirlpoolCapacity", {
    defaultValue: "Whirlpool capacity per block",
  });
  const wabisabiTrendTitle = t("observatory.trends.wabisabiFreshInputs", {
    defaultValue: "WabiSabi fresh inputs (BTC/day)",
  });

  return (
    <PageShell
      backLabel={t("observatory.back", { defaultValue: "Back to scanner" })}
      maxWidth="max-w-5xl"
      className="px-3 sm:px-6 lg:px-8"
    >
      <ObservatoryPageHeader showMainnetBadge />

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

      {/* Recent Whirlpool cycles */}
      {whirlpool?.txs && whirlpool.txs.items.length > 0 && (
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-foreground">
              {t("observatory.cycles.sectionTitle", {
                defaultValue: "Recent Whirlpool cycles",
              })}
            </h2>
            <p className="text-sm text-muted">
              {t("observatory.cycles.sectionSubtitle", {
                defaultValue:
                  "Latest coinjoin cycles and TX0 activity. Select any cycle to inspect it in the scanner.",
              })}
            </p>
          </div>
          <RecentCyclesTable firstPage={whirlpool.txs} />
        </section>
      )}

      {/* WabiSabi */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">
          {t("observatory.wabisabi.title", { defaultValue: "WabiSabi coordinators" })}
        </h2>
        {loading && !liquisabi ? (
          <SkeletonCards count={3} />
        ) : liquisabi ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeCoords.map((c) => (
                <WabiSabiCoordinatorCard
                  key={c.endpoint}
                  coordinator={c}
                  avgAnonIn={liquisabi.Summary?.AverageStandardInputsAnonSet ?? null}
                  avgAnonOut={liquisabi.Summary?.AverageStandardOutputsAnonSet ?? null}
                />
              ))}
            </div>
            <InactiveCoordinators
              coordinators={inactiveCoords}
              avgAnonIn={liquisabi.Summary?.AverageStandardInputsAnonSet ?? null}
              avgAnonOut={liquisabi.Summary?.AverageStandardOutputsAnonSet ?? null}
            />
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
          <TrendCard
            title={whirlpoolTrendTitle}
            ys={whirlpoolYs}
            ready={!!whirlpool}
            loading={loading}
            footer={refStart != null && refEnd != null && (
              <div className="text-xs text-muted">
                {t("observatory.trends.startEndDelta", {
                  defaultValue:
                    "0.025 pool: start {{start}} BTC · end {{end}} BTC · Δ {{delta}} BTC",
                  start: refStart.toFixed(2),
                  end: refEnd.toFixed(2),
                  delta: (refEnd >= refStart ? "+" : "") + (refEnd - refStart).toFixed(2),
                })}
              </div>
            )}
          >
            <TrendChart
              series={whirlpoolSeries}
              unit="BTC"
              formatX={(v) => `#${Math.round(v).toLocaleString("en-US")}`}
              height={220}
              ariaLabel={whirlpoolTrendTitle}
            />
          </TrendCard>
          <TrendCard
            title={wabisabiTrendTitle}
            ys={wabisabiSparkline.map((p) => p.y)}
            ready={!!liquisabi}
            loading={loading}
          >
            <TrendChart
              points={wabisabiSparkline}
              color={COLORS.severityHigh}
              unit="BTC"
              formatX={(v) => labelFromGraph(liquisabi?.Graph, v)}
              height={220}
              ariaLabel={wabisabiTrendTitle}
            />
          </TrendCard>
        </div>
      </section>

      <ObservatoryAttribution
        lastUpdatedAt={lastUpdatedAt}
        locale={i18n.language || "en"}
      />
    </PageShell>
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
