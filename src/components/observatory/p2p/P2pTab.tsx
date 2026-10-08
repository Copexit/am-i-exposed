"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw, WifiOff } from "lucide-react";
import { useNetwork } from "@/context/NetworkContext";
import type { Venue } from "@/lib/observatory/p2p/types";
import { useObsState } from "@/hooks/useObsState";
import { useP2p, useP2pHistory } from "@/hooks/useP2p";
import { amountInFiat, buildMarkets, defaultCurrency, filterAmount, filterMethod, filterVenues, indexFor, headline as buildHeadline, makerSide, methodCounts, premiumBoard } from "@/lib/observatory/p2p/market";
import { Section, SubNav } from "@/components/observatory/ObsSections";
import { P2pHeadline } from "./P2pHeadline";
import { SourceStrip } from "./SourceStrip";
import { MarketSelector, type MarketPatch } from "./MarketSelector";
import { P2pFooter } from "./P2pFooter";
import { PaymentMethodPicker, PmFilterNote } from "./PaymentMethodPicker";
import { DepthWall } from "./DepthWall";
import { AmountFilter, fmtBtcAmount, type AmountPatch } from "./AmountFilter";
import { fmtFiat } from "@/lib/observatory/p2p/p2p-format";
import type { ObsState } from "@/lib/observatory/obs-hash";
import { OfferList } from "./OfferList";
import { PremiumBoard } from "./PremiumBoard";
import { VenueSection } from "./VenueSection";
import { P2pVolume } from "./P2pVolume";
import { BONE } from "./p2p-ui";

function AllDown({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div data-testid="p2p-all-down" className="rounded-xl border border-card-border bg-surface-elevated/40 p-6 space-y-3">
      <div className="flex items-center gap-2 text-muted">
        <WifiOff size={16} aria-hidden="true" />
        <span className="text-sm font-medium">
          {t("observatory.p2p.errors.allDown", { defaultValue: "No P2P source answered. The order books are behind Tor and Nostr relays, which sometimes stall." })}
        </span>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 min-h-10 text-sm px-3 py-2 rounded-lg bg-surface-inset border border-card-border text-foreground hover:border-bitcoin/30 transition-all cursor-pointer"
      >
        <RotateCw size={12} className="text-muted" aria-hidden="true" />
        {t("observatory.errors.retry", { defaultValue: "Try again" })}
      </button>
    </div>
  );
}

/** Skeleton slot for sections that load after the order books. */
export function BlockSkeleton({ h = 240 }: { h?: number }) {
  return <div aria-hidden="true" className={`w-full ${BONE} rounded-xl`} style={{ height: h }} />;
}

/**
 * The P2P markets tab: headline, sticky sub-nav, then markets (selector, wall, offers),
 * premiums, venues and volume. Every selection lives in the hash.
 */
export function P2pTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const { isUmbrel } = useNetwork();
  const [obs, setObs] = useObsState();
  const data = useP2p();
  const { markets, index, hosts, offers, sources } = data;

  const loading = sources.some((s) => s.state === "loading") && offers.length === 0;
  const allDown = sources.every((s) => s.state === "down") && offers.length === 0;
  // A code from the URL wins while data loads, and while it is a real market or an indexed currency;
  // an unknown code falls back to the locale default once data is in.
  const cur = obs.cur && (markets.has(obs.cur) || (index && obs.cur in index.prices) || loading)
    ? obs.cur
    : defaultCurrency(locale, markets);

  const head = useMemo(() => (offers.length ? buildHeadline(markets, hosts, cur) : null), [markets, hosts, cur, offers.length]);
  const byVenue = useMemo(() => filterVenues(offers, obs.venue), [offers, obs.venue]);
  // Currency chips count every method and amount; the wall, list, stats, method counts and nearest markets follow the filters.
  const venueMarkets = useMemo(() => buildMarkets(byVenue, index), [byVenue, index]);
  const idx = cur ? indexFor(cur, index) : null;
  const amtFiat = amountInFiat(obs.amt, obs.amtu, idx);
  const byAmount = useMemo(() => filterAmount(byVenue, cur, amtFiat), [byVenue, cur, amtFiat]);
  const shown = useMemo(
    () => (obs.pm || amtFiat !== null ? buildMarkets(filterMethod(byAmount, obs.pm), index) : venueMarkets),
    [byAmount, obs.pm, amtFiat, index, venueMarkets],
  );

  const market = cur ? shown.get(cur) ?? null : null;
  const maker = makerSide(obs.side);
  const sideOffers = useMemo(() => byAmount.filter((o) => o.currency === cur && o.side === maker), [byAmount, cur, maker]);
  const methods = useMemo(() => methodCounts(sideOffers), [sideOffers]);
  const nearest = useMemo(() => [...shown.values()]
    .filter((m) => m.currency !== cur && m.index !== null)
    .map((m) => ({ c: m.currency, n: m.offers.filter((o) => o.side === maker).length }))
    .filter((m) => m.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((m) => m.c), [shown, cur, maker]);
  const amountLabel = amtFiat === null || !cur ? null : obs.amtu === "btc" ? `${fmtBtcAmount(obs.amt!, locale)} BTC` : fmtFiat(obs.amt!, cur, locale);

  // A fiat amount means nothing in another currency: switching market clears it.
  const setMarket = useCallback((patch: Partial<ObsState>) =>
    setObs(patch.cur && patch.cur !== cur && obs.amt !== null && obs.amtu === "fiat" ? { ...patch, amt: null } : patch), [setObs, cur, obs.amt, obs.amtu]);
  const onAmount = useCallback((patch: AmountPatch) => setObs(patch), [setObs]);

  // History loads lazily, when the Volume section approaches the viewport.
  const [volumeNear, setVolumeNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (volumeNear) return;
    const el = document.getElementById("p2p-volume");
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) setVolumeNear(true); }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [volumeNear, allDown]);
  const history = useP2pHistory(volumeNear);
  const today = new Date(data.nowSec * 1000).toISOString().slice(0, 10);

  const board = useMemo(() => premiumBoard(markets, obs.side), [markets, obs.side]);
  const onBoard = useCallback((c: string, v: Venue) => {
    setMarket({ cur: c, venue: [v], pm: null });
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => document.getElementById("p2p-markets")?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" }));
  }, [setMarket]);

  const onChange = useCallback((patch: MarketPatch) => setMarket(patch), [setMarket]);
  const retry = useCallback(() => { for (const s of sources) s.refresh(); }, [sources]);

  const nav = [
    { id: "p2p-markets", label: t("observatory.p2p.nav.markets", { defaultValue: "Markets" }) },
    { id: "p2p-premiums", label: t("observatory.p2p.nav.premiums", { defaultValue: "Premiums" }) },
    { id: "p2p-venues", label: t("observatory.p2p.nav.venues", { defaultValue: "Venues" }) },
    { id: "p2p-volume", label: t("observatory.p2p.nav.volume", { defaultValue: "Volume" }) },
  ];

  return (
    <div className="space-y-10 sm:space-y-14">
      <section id="p2p-headline" aria-label={t("observatory.p2p.headline.label", { defaultValue: "KYC-free liquidity right now" })} className="space-y-5">
        <P2pHeadline headline={head} currency={cur} side={obs.side} loading={loading} />
        <SourceStrip sources={sources} />
      </section>

      <SubNav label={t("observatory.p2p.nav.label", { defaultValue: "P2P sections" })} items={nav} />

      {allDown ? (
        <AllDown onRetry={retry} />
      ) : (
        <>
          <Section
            id="p2p-markets"
            title={t("observatory.p2p.markets.title", { defaultValue: "Markets" })}
            lead={t("observatory.p2p.markets.lead", { defaultValue: "Every live offer in one currency, by premium over the index. Pick what you want to do and where." })}
          >
            <MarketSelector markets={venueMarkets} cur={cur} side={obs.side} venues={obs.venue} onChange={onChange}>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-start">
                {cur && <AmountFilter cur={cur} idx={idx} amt={obs.amt} unit={obs.amtu} onChange={onAmount} />}
                <PaymentMethodPicker methods={methods} total={sideOffers.length} pm={obs.pm} onChange={(pm) => setObs({ pm })} />
              </div>
            </MarketSelector>
            {!loading && (
              <PmFilterNote market={market} side={obs.side} pm={obs.pm} amount={amountLabel} hosts={hosts} onClear={() => setObs({ pm: null })} onClearAmount={() => setObs({ amt: null })} />
            )}
            {loading ? (
              <BlockSkeleton h={320} />
            ) : (
              <>
                <DepthWall
                  market={market}
                  side={obs.side}
                  view={obs.view}
                  hosts={hosts}
                  nearest={nearest}
                  onView={(view) => setObs({ view })}
                  onPickCurrency={(c) => setMarket({ cur: c })}
                />
                <OfferList market={market} side={obs.side} hosts={hosts} nowSec={data.nowSec} />
              </>
            )}
          </Section>

          <Section
            id="p2p-premiums"
            title={t("observatory.p2p.premiums.title", { defaultValue: "Premiums by currency" })}
            lead={t("observatory.p2p.premiums.lead", { defaultValue: "Median premium over the index in each market and venue. Pick a cell to open that market." })}
          >
            {loading ? <BlockSkeleton /> : <PremiumBoard rows={board} side={obs.side} onSelect={onBoard} />}
          </Section>

          <Section
            id="p2p-venues"
            title={t("observatory.p2p.venues.title", { defaultValue: "Venues and coordinators" })}
            lead={t("observatory.p2p.venues.lead", { defaultValue: "Who runs the order books, whether they answer, and what they charge." })}
          >
            {loading ? <BlockSkeleton /> : <VenueSection hosts={hosts} isUmbrel={isUmbrel} highlight={obs.coordinator} />}
          </Section>

          <Section
            id="p2p-volume"
            title={t("observatory.p2p.volume.title", { defaultValue: "Volume" })}
            lead={t("observatory.p2p.volume.lead", { defaultValue: "Completed trades over time, where venues publish them." })}
          >
            <P2pVolume history={history} isUmbrel={isUmbrel} today={today} />
          </Section>
        </>
      )}

      <P2pFooter isUmbrel={isUmbrel} />
    </div>
  );
}
