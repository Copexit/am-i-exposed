"use client";

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw, WifiOff } from "lucide-react";
import { useNetwork } from "@/context/NetworkContext";
import { useObsState } from "@/hooks/useObsState";
import { useP2p } from "@/hooks/useP2p";
import { buildMarkets, defaultCurrency, filterVenues, headline as buildHeadline } from "@/lib/observatory/p2p/market";
import { Section, SubNav } from "@/components/observatory/ObsSections";
import { P2pHeadline } from "./P2pHeadline";
import { SourceStrip } from "./SourceStrip";
import { MarketSelector, type MarketPatch } from "./MarketSelector";
import { P2pFooter } from "./P2pFooter";
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
  const shown = useMemo(() => buildMarkets(filterVenues(offers, obs.venue), index), [offers, obs.venue, index]);

  const onChange = useCallback((patch: MarketPatch) => setObs(patch), [setObs]);
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
            <MarketSelector markets={shown} cur={cur} side={obs.side} venues={obs.venue} onChange={onChange} />
            <BlockSkeleton h={320} />
          </Section>

          <Section
            id="p2p-premiums"
            title={t("observatory.p2p.premiums.title", { defaultValue: "Premiums by currency" })}
            lead={t("observatory.p2p.premiums.lead", { defaultValue: "Median premium over the index in each market and venue. Pick a cell to open that market." })}
          >
            <BlockSkeleton />
          </Section>

          <Section
            id="p2p-venues"
            title={t("observatory.p2p.venues.title", { defaultValue: "Venues and coordinators" })}
            lead={t("observatory.p2p.venues.lead", { defaultValue: "Who runs the order books, whether they answer, and what they charge." })}
          >
            <BlockSkeleton />
          </Section>

          <Section
            id="p2p-volume"
            title={t("observatory.p2p.volume.title", { defaultValue: "Volume" })}
            lead={t("observatory.p2p.volume.lead", { defaultValue: "Completed trades over time, where venues publish them." })}
          >
            <BlockSkeleton />
          </Section>
        </>
      )}

      <P2pFooter isUmbrel={isUmbrel} />
    </div>
  );
}
