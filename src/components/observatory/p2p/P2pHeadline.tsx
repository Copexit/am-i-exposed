"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Headline } from "@/lib/observatory/p2p/market";
import { fmtPremium, fmtSatsBtc } from "@/lib/observatory/p2p/p2p-format";
import { fmtCount } from "@/lib/observatory/obs-format";
import { BONE, DASH, FADE, mark, rich } from "./p2p-ui";

interface Props {
  headline: Headline | null;
  currency: string | null;
  side: "buy" | "sell";
  loading: boolean;
}

const strong = (children: ReactNode, tone = "text-foreground") => <strong className={`num font-semibold ${tone}`}>{children}</strong>;

/** Premium tone for the visitor: below the index is good to buy, above it is good to sell. */
const premiumTone = (p: number, side: "buy" | "sell") => ((side === "buy" ? p <= 0 : p >= 0) ? "text-severity-good" : "text-foreground");

/** The first screen: how much bitcoin is on offer without KYC right now, and the best premium in the visitor's market. */
export function P2pHeadline({ headline, currency, side, loading }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const has = !!headline && headline.offers.buy + headline.offers.sell > 0;
  const best = side === "buy" ? headline?.cheapestBuy : headline?.cheapestSell;

  let sentence: ReactNode;
  if (has) {
    const nodes = {
      btc: strong(`${fmtSatsBtc(headline.liquiditySats, locale)} BTC`),
      venues: strong(fmtCount(headline.venuesOnline, locale)),
      currency: strong(currency ?? ""),
      premium: best ? strong(fmtPremium(best.premium, locale), premiumTone(best.premium, side)) : null,
    };
    const base = { btc: mark("btc"), venues: mark("venues"), count: headline.venuesOnline };
    const text = best && currency
      ? side === "buy"
        ? t("observatory.p2p.headline.sentenceBuy", { defaultValue: "{{btc}} on offer without KYC across {{venues}} venues, cheapest to buy in {{currency}} at {{premium}} over the index.", ...base, currency: mark("currency"), premium: mark("premium") })
        : t("observatory.p2p.headline.sentenceSell", { defaultValue: "{{btc}} on offer without KYC across {{venues}} venues, best to sell in {{currency}} at {{premium}} over the index.", ...base, currency: mark("currency"), premium: mark("premium") })
      : t("observatory.p2p.headline.sentence", { defaultValue: "{{btc}} on offer without KYC across {{venues}} venues.", ...base });
    sentence = rich(text, nodes);
  } else if (!loading) {
    sentence = t("observatory.p2p.headline.none", { defaultValue: "No KYC-free offers could be loaded right now." });
  }

  const v = (s: string | null) => (has ? s : loading ? null : DASH);
  const median = side === "buy" ? headline?.medianBuy : headline?.medianSell;
  const tiles: { id: string; label: string; value: string | null; unit?: string; sub?: string }[] = [
    {
      id: "offers",
      label: t("observatory.p2p.tiles.offers", { defaultValue: "Offers" }),
      value: v(headline ? fmtCount(headline.offers.buy + headline.offers.sell, locale) : null),
      sub: has ? t("observatory.p2p.tiles.offersSplit", { defaultValue: "{{buy}} to buy, {{sell}} to sell", buy: fmtCount(headline.offers.buy, locale), sell: fmtCount(headline.offers.sell, locale) }) : undefined,
    },
    {
      id: "liquidity",
      label: t("observatory.p2p.tiles.liquidity", { defaultValue: "Liquidity to buy" }),
      value: v(headline ? fmtSatsBtc(headline.liquidity.buy, locale) : null),
      unit: "BTC",
      sub: has ? t("observatory.p2p.tiles.liquiditySell", { defaultValue: "{{btc}} BTC to sell", btc: fmtSatsBtc(headline.liquidity.sell, locale) }) : undefined,
    },
    {
      id: "median",
      label: side === "buy"
        ? t("observatory.p2p.tiles.medianBuy", { defaultValue: "Median premium to buy" })
        : t("observatory.p2p.tiles.medianSell", { defaultValue: "Median premium to sell" }),
      value: has ? (median != null ? fmtPremium(median, locale) : DASH) : v(null),
      sub: has && currency ? currency : undefined,
    },
    {
      id: "online",
      label: t("observatory.p2p.tiles.online", { defaultValue: "Hosts online" }),
      value: v(headline && headline.hostsTotal ? `${fmtCount(headline.hostsOnline, locale)} / ${fmtCount(headline.hostsTotal, locale)}` : null),
      sub: has ? t("observatory.p2p.tiles.onlineSub", { defaultValue: "coordinators and instances" }) : undefined,
    },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <p className="eyebrow inline-flex items-center gap-2 !text-foreground">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" />
        {t("observatory.p2p.headline.eyebrow", { defaultValue: "KYC-free bitcoin, live" })}
      </p>
      {sentence ? (
        <p data-testid="p2p-headline" className={`max-w-4xl text-[26px] leading-[1.18] sm:text-4xl sm:leading-[1.12] lg:text-[44px] font-medium tracking-tight text-muted text-pretty ${FADE}`}>
          {sentence}
        </p>
      ) : (
        <div aria-hidden="true" className="max-w-4xl space-y-3 py-1">
          <span className={`block h-7 sm:h-10 w-[92%] ${BONE}`} />
          <span className={`block h-7 sm:h-10 w-[64%] ${BONE}`} />
        </div>
      )}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {tiles.map((tile) => (
          <div key={tile.id} data-testid={`p2p-tile-${tile.id}`} className="glass min-w-0 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3.5 flex flex-col">
            <dt className="eyebrow !leading-tight text-balance">{tile.label}</dt>
            <dd className="mt-2 flex items-baseline gap-1.5 min-w-0">
              {tile.value != null ? (
                <>
                  <span className={`num text-lg sm:text-2xl leading-none text-foreground truncate ${FADE}`}>{tile.value}</span>
                  {tile.unit && tile.value !== DASH && <span className="num text-[11px] text-muted">{tile.unit}</span>}
                </>
              ) : (
                <span aria-hidden="true" className={`block h-5 sm:h-6 w-20 sm:w-24 ${BONE}`} />
              )}
            </dd>
            {tile.sub && <dd className="mt-1.5 text-xs leading-snug text-faint">{tile.sub}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}
