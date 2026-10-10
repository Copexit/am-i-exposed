"use client";

import { useEffect, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/PageShell";
import { useNetwork } from "@/context/NetworkContext";
import { useObservatory } from "@/hooks/useObservatory";
import { useChainTip } from "@/hooks/useChainTip";
import { OBSERVATORY_TABS, legacyObsRedirect, obsRouteTab, useObsState, type ObservatoryTab } from "@/hooks/useObsState";
import { useLocationHash } from "@/components/chrome/useLocationHash";
import { serializeObsHash } from "@/lib/observatory/obs-hash";
import { ObservatoryHero } from "@/components/observatory/ObservatoryHero";
import { WhirlpoolPoolCard } from "@/components/observatory/WhirlpoolPoolCard";
import { RecentCyclesTable } from "@/components/observatory/RecentCyclesTable";
import { ObservatoryAttribution } from "@/components/observatory/ObservatoryAttribution";
import { ObservatoryErrorState } from "@/components/observatory/ObservatoryErrorState";
import { TrendChart, type TrendSeries } from "@/components/observatory/TrendChart";
import { TrendCard } from "@/components/observatory/TrendCard";
import { ObservatoryPageHeader } from "@/components/observatory/ObservatoryPageHeader";
import { SyncPill } from "@/components/observatory/SyncPill";
import { SkeletonCards } from "@/components/observatory/SkeletonCards";
import { WabiSabiTab } from "@/components/observatory/wabisabi/WabiSabiTab";
import { P2pTab } from "@/components/observatory/p2p/P2pTab";
import {
  lastCycleBlocks,
  whirlpoolLifetimeCycles,
  whirlpoolLifetimeEntered,
  whirlpoolSparkline,
} from "@/lib/observatory/selectors";
import { fmtN } from "@/lib/format";

function fmtBtc(value: number): string {
  return `${value.toFixed(3).replace(/\.?0+$/, "")} BTC`;
}

/**
 * The Observatory. /observatory/ is the hub (WabiSabi shown); /observatory/<tab>/ preselects a tab
 * and carries its own heading. Old hub deep links (#p2p&cur=EUR) move to the tab's route.
 */
export function ObservatoryPage() {
  const { t } = useTranslation();
  const { network } = useNetwork();
  const route = obsRouteTab(usePathname());
  const [obs] = useObsState();
  const tab = obs.tab as ObservatoryTab;
  const hash = useLocationHash();
  const redirect = route ? null : legacyObsRedirect(hash);
  useEffect(() => {
    if (redirect) window.location.replace(redirect);
  }, [redirect]);

  const p2pTitle = t("observatory.p2p.pageTitle", { defaultValue: "P2P markets" });
  const heading = {
    wabisabi: {
      title: t("observatory.route.wabisabi.title", { defaultValue: "Live CoinJoin map: WabiSabi coordinators" }),
      description: t("observatory.route.wabisabi.intro", { defaultValue: "Live WabiSabi CoinJoin rounds, volume, fees and coordinator history across the public coordinators that Wasabi Wallet and compatible clients use, sourced from Wabisator." }),
    },
    whirlpool: {
      title: t("observatory.route.whirlpool.title", { defaultValue: "Whirlpool CoinJoin pools (Ashigaru)" }),
      description: t("observatory.route.whirlpool.intro", { defaultValue: "Live Whirlpool pool sizes, unspent capacity and recent mixing cycles for Ashigaru and compatible clients, sourced from whirlpoolstats.xyz." }),
    },
    p2p: {
      title: t("observatory.route.p2p.title", { defaultValue: "KYC-free bitcoin P2P offers: RoboSats, Mostro, HodlHodl" }),
      description: t("observatory.p2p.pageDescription", { defaultValue: "Live KYC-free bitcoin offers from RoboSats, Mostro and HodlHodl, fetched through a relay or Tor, never from your browser." }),
    },
  } as const;
  const header = route ? heading[route] : { title: undefined, description: undefined };

  if (network !== "mainnet") {
    return (
      <PageShell>
        <ObservatoryPageHeader showMainnetBadge={false} {...header} />
        <div className="rounded-xl border border-card-border bg-surface-elevated/50 p-6 text-muted">
          {t("observatory.mainnetOnly", {
            defaultValue:
              "Live CoinJoin data is mainnet-only. Switch to mainnet in the network selector to view it.",
          })}
        </div>
      </PageShell>
    );
  }

  // Display order is OBSERVATORY_TABS (WabiSabi first, the default); a new protocol is one entry.
  const tabs: { id: ObservatoryTab; label: string }[] = OBSERVATORY_TABS.map((id) => ({
    id,
    label: {
      wabisabi: t("observatory.tabs.wabisabi", { defaultValue: "WabiSabi (Wasabi)" }),
      whirlpool: t("observatory.tabs.whirlpool", { defaultValue: "Whirlpool (Ashigaru)" }),
      p2p: t("observatory.tabs.p2p", { defaultValue: "P2P markets" }),
    }[id],
  }));
  const p2p = tab === "p2p";
  // Period and Map/Table view mean the same on every tab, so a tab link carries them; the rest is per tab.
  const shared = serializeObsHash({ tab: "", period: obs.period, view: obs.view, coordinator: null, tx: null }).replace(/^#&?/, "");
  const tabHref = (id: ObservatoryTab) => `/observatory/${id}/${shared ? `#${shared}` : ""}`;

  // Tabs are links to the tab routes (crawlable, one history entry each); arrows move focus, Enter follows.
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const focused = tabs.findIndex((x) => document.activeElement?.id === `observatory-tab-${x.id}`);
    const i = focused >= 0 ? focused : tabs.findIndex((x) => x.id === tab);
    const n = tabs.length;
    const next =
      e.key === "ArrowRight" ? tabs[(i + 1) % n]
      : e.key === "ArrowLeft" ? tabs[(i - 1 + n) % n]
      : e.key === "Home" ? tabs[0]
      : e.key === "End" ? tabs[n - 1]
      : undefined;
    if (!next) return;
    e.preventDefault();
    document.getElementById(`observatory-tab-${next.id}`)?.focus();
  };

  return (
    <PageShell spacing="space-y-4 sm:space-y-5" compact eyebrow={p2p ? p2pTitle : undefined}>
      <ObservatoryPageHeader
        showMainnetBadge
        {...header}
        aside={
          <div
            role="tablist"
            aria-label={t("observatory.tabs.label", { defaultValue: "Observatory section" })}
            onKeyDown={onTabKeyDown}
            className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-surface-inset border border-card-border sm:inline-grid"
          >
            {tabs.map(({ id, label }) => (
              <Link
                key={id}
                href={tabHref(id)}
                id={`observatory-tab-${id}`}
                role="tab"
                aria-selected={tab === id}
                aria-controls="observatory-panel"
                tabIndex={tab === id ? 0 : -1}
                className={`inline-flex items-center justify-center text-center rounded-md px-3 sm:px-5 py-2 min-h-10 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bitcoin ${
                  tab === id
                    ? "bg-surface-elevated text-foreground shadow-sm ring-1 ring-hairline-strong"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        }
      />

      <div
        id="observatory-panel"
        role="tabpanel"
        aria-labelledby={`observatory-tab-${tab}`}
        className="space-y-8"
      >
        {redirect ? null : tab === "whirlpool" ? <WhirlpoolTab /> : tab === "p2p" ? <P2pTab /> : <WabiSabiTab />}
      </div>
    </PageShell>
  );
}

/** The Whirlpool tab (whirlpoolstats.xyz). Fetches only while it is shown. */
function WhirlpoolTab() {
  const { t, i18n } = useTranslation();
  const tipHeight = useChainTip();
  const { whirlpool, loading, lastUpdatedAt } = useObservatory();

  const summary = whirlpool?.summary ?? null;
  const charts = whirlpool?.charts ?? null;

  const lifetimeEntered = summary ? whirlpoolLifetimeEntered(summary) : null;
  const lifetimeCycles = summary ? whirlpoolLifetimeCycles(summary) : null;

  const lastCjBlocks = lastCycleBlocks(whirlpool?.txs ?? null);
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

  return (
    <>
      <ObservatoryHero
        whirlpool={summary}
        whirlpoolCharts={charts}
        loading={loading}
      />

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
          {tipHeight != null && (
            <p className="text-sm text-muted tabular-nums">
              {t("observatory.whirlpool.currentBlock", {
                defaultValue: "Current block: {{block}}",
                block: tipHeight.toLocaleString("en-US"),
              })}
            </p>
          )}
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
                lastCjBlock={lastCjBlocks[pool.pool] ?? null}
                tipHeight={tipHeight}
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

      <ObservatoryAttribution
        lastUpdatedAt={lastUpdatedAt}
        locale={i18n.language || "en"}
      />
    </>
  );
}
