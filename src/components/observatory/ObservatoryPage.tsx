"use client";

import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/PageShell";
import { useNetwork } from "@/context/NetworkContext";
import { useObservatory } from "@/hooks/useObservatory";
import { useChainTip } from "@/hooks/useChainTip";
import {
  OBSERVATORY_TABS,
  useObservatoryTab,
  type ObservatoryTab,
} from "@/hooks/useObservatoryTab";
import { ObservatoryHero } from "@/components/observatory/ObservatoryHero";
import { WhirlpoolPoolCard } from "@/components/observatory/WhirlpoolPoolCard";
import { WabiSabiCoordinatorCard } from "@/components/observatory/WabiSabiCoordinatorCard";
import { RecentCyclesTable } from "@/components/observatory/RecentCyclesTable";
import { RecentRoundsTable } from "@/components/observatory/RecentRoundsTable";
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
  toRoundRows,
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

export function ObservatoryPage() {
  const { t, i18n } = useTranslation();
  const { network } = useNetwork();
  const tipHeight = useChainTip();
  const { whirlpool, liquisabi, loading, lastUpdatedAt } = useObservatory();
  const [tab, selectTab] = useObservatoryTab();

  const isMainnet = network === "mainnet";

  if (!isMainnet) {
    return (
      <PageShell>
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

  const roundRows = toRoundRows(liquisabi);

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

  const tabLabels: Record<ObservatoryTab, string> = {
    whirlpool: t("observatory.tabs.whirlpool", { defaultValue: "Whirlpool (Ashigaru)" }),
    wabisabi: t("observatory.tabs.wabisabi", { defaultValue: "WabiSabi (Wasabi)" }),
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = OBSERVATORY_TABS.indexOf(tab);
    const n = OBSERVATORY_TABS.length;
    const next =
      e.key === "ArrowRight" ? OBSERVATORY_TABS[(i + 1) % n]
      : e.key === "ArrowLeft" ? OBSERVATORY_TABS[(i - 1 + n) % n]
      : e.key === "Home" ? OBSERVATORY_TABS[0]
      : e.key === "End" ? OBSERVATORY_TABS[n - 1]
      : undefined;
    if (!next) return;
    e.preventDefault();
    selectTab(next);
    document.getElementById(`observatory-tab-${next}`)?.focus();
  };

  return (
    <PageShell>
      <ObservatoryPageHeader showMainnetBadge />

      <div
        role="tablist"
        aria-label={t("observatory.tabs.label", { defaultValue: "CoinJoin protocol" })}
        onKeyDown={onTabKeyDown}
        className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-surface-inset border border-card-border sm:inline-grid"
      >
        {OBSERVATORY_TABS.map((id) => (
          <button
            key={id}
            id={`observatory-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls="observatory-panel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => selectTab(id)}
            className={`rounded-md px-3 sm:px-5 py-2 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bitcoin ${
              tab === id
                ? "bg-surface-elevated text-foreground shadow-sm ring-1 ring-hairline-strong"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tabLabels[id]}
          </button>
        ))}
      </div>

      <div
        id="observatory-panel"
        role="tabpanel"
        aria-labelledby={`observatory-tab-${tab}`}
        className="space-y-8"
      >
        <ObservatoryHero
          whirlpool={summary}
          whirlpoolCharts={charts}
          liquisabi={liquisabi}
          loading={loading}
          protocol={tab}
        />

        {tab === "whirlpool" ? (
          <>
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

            <section className="space-y-4">
              <h2 className="text-xl font-semibold text-foreground">
                {t("observatory.trends.title", { defaultValue: "30-day trends" })}
              </h2>
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
            </section>
          </>
        ) : (
          <>
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

            {roundRows.length > 0 && (
              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold text-foreground">
                    {t("observatory.rounds.sectionTitle", {
                      defaultValue: "Recent WabiSabi rounds",
                    })}
                  </h2>
                  <p className="text-sm text-muted">
                    {t("observatory.rounds.sectionSubtitle", {
                      defaultValue:
                        "Latest coinjoin rounds across all tracked coordinators. Select any round to inspect it in the scanner.",
                    })}
                  </p>
                </div>
                <RecentRoundsTable
                  rows={roundRows}
                  total={liquisabi?.PaginatedRounds?.TotalCount ?? 0}
                />
              </section>
            )}

            <section className="space-y-4">
              <h2 className="text-xl font-semibold text-foreground">
                {t("observatory.trends.title", { defaultValue: "30-day trends" })}
              </h2>
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
            </section>
          </>
        )}
      </div>

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
