"use client";

import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/PageShell";
import { useNetwork } from "@/context/NetworkContext";
import { useObservatory } from "@/hooks/useObservatory";
import { ObservatoryHero } from "@/components/observatory/ObservatoryHero";
import { WhirlpoolPoolCard } from "@/components/observatory/WhirlpoolPoolCard";
import { WabiSabiCoordinatorCard } from "@/components/observatory/WabiSabiCoordinatorCard";
import { ObservatoryAttribution } from "@/components/observatory/ObservatoryAttribution";
import { ObservatoryErrorState } from "@/components/observatory/ObservatoryErrorState";
import { TrendChart } from "@/components/observatory/TrendChart";
import {
  liquiSabiFreshInputSparkline,
  projectCoordinators,
  whirlpoolSparkline,
} from "@/lib/observatory/selectors";
import type { LiquiSabiGraphEntry } from "@/lib/observatory/types";

export default function ObservatoryPage() {
  const { t, i18n } = useTranslation();
  const { network } = useNetwork();
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

  return (
    <PageShell
      backLabel={t("observatory.back", { defaultValue: "Back to scanner" })}
      maxWidth="max-w-5xl"
      className="px-3 sm:px-6 lg:px-8"
    >
      <Hero showMainnetBadge />

      <ObservatoryHero
        whirlpool={whirlpool?.summary ?? null}
        liquisabi={liquisabi}
        loading={loading}
      />

      {/* Whirlpool */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold text-foreground">
            {t("observatory.whirlpool.title", { defaultValue: "Whirlpool pools" })}
          </h2>
          {whirlpool?.summary && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                whirlpool.summary.is_synced
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
              }`}
            >
              {whirlpool.summary.is_synced
                ? t("observatory.whirlpool.syncStatusSynced", {
                    defaultValue: "Synced",
                  })
                : t("observatory.whirlpool.syncStatusBehind", {
                    defaultValue: "Catching up",
                  })}{" "}
              · {whirlpool.summary.tip_height.toLocaleString()}
            </span>
          )}
        </div>
        {loading && !whirlpool ? (
          <SkeletonCards count={2} />
        ) : whirlpool ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {whirlpool.summary.pools.map((pool) => (
              <WhirlpoolPoolCard
                key={pool.pool}
                pool={pool}
                poolsizeSeries={whirlpool.charts.poolsize}
              />
            ))}
          </div>
        ) : (
          <ObservatoryErrorState
            source="whirlpool"
            staleAt={lastUpdatedAt}
          />
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          <ObservatoryErrorState
            source="liquisabi"
            staleAt={lastUpdatedAt}
          />
        )}
      </section>

      {/* Trends */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">
          {t("observatory.trends.title", { defaultValue: "30-day trends" })}
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <TrendCard
            title={t("observatory.trends.whirlpoolPoolsize", {
              defaultValue: "Whirlpool 0.025 BTC poolsize (per block)",
            })}
            points={
              whirlpool
                ? whirlpoolSparkline(whirlpool.charts.poolsize, "0.025_BTC_Pool")
                : []
            }
            color="#8e8e93"
            unit="BTC"
            xFormat={(v) => `#${Math.round(v).toLocaleString("en-US")}`}
            ready={!!whirlpool}
            loading={loading}
          />
          <TrendCard
            title={t("observatory.trends.wabisabiFreshInputs", {
              defaultValue: "WabiSabi fresh inputs (BTC/day)",
            })}
            points={wabisabiSparkline}
            color="#f97316"
            unit="BTC"
            xFormat={(v) => labelFromGraph(liquisabi?.Graph, v)}
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

function SkeletonCards({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="h-44 rounded-xl border border-card-border bg-surface-elevated/30 animate-pulse"
        />
      ))}
    </div>
  );
}

interface TrendCardProps {
  title: string;
  points: ReturnType<typeof whirlpoolSparkline>;
  color: string;
  unit?: string;
  xFormat?: (value: number) => string;
  ready: boolean;
  loading: boolean;
}

function TrendCard({
  title,
  points,
  color,
  unit,
  xFormat,
  ready,
  loading,
}: TrendCardProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-card-border bg-surface-elevated/50 p-4 sm:p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {ready && points.length > 1 && (
          <div className="text-xs text-muted tabular-nums whitespace-nowrap">
            min {Math.min(...points.map((p) => p.y)).toFixed(2)} ·{" "}
            max {Math.max(...points.map((p) => p.y)).toFixed(2)}
            {unit ? ` ${unit}` : ""}
          </div>
        )}
      </div>
      {ready ? (
        <TrendChart
          points={points}
          color={color}
          unit={unit}
          formatX={xFormat ? (v) => xFormat(v) : undefined}
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
