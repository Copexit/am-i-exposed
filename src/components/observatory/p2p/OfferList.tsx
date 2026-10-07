"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Market, P2pOffer, VenueHost } from "@/lib/observatory/p2p/types";
import { makerSide } from "@/lib/observatory/p2p/market";
import { Amount, EscrowLabel, LayerLabel, Methods, OfferCard, OpenLink, PremiumValue, VenueBadge, hostNames } from "./offer-facts";

const PAGE = 25;

function useAge(nowSec: number): (o: P2pOffer) => string {
  const { i18n } = useTranslation();
  const rtf = new Intl.RelativeTimeFormat(i18n.language || "en", { numeric: "auto", style: "narrow" });
  return (o) => {
    // HodlHodl publishes no creation time.
    if (o.venue === "hodlhodl") return "–";
    const s = Math.max(0, nowSec - o.createdAt);
    return s < 3600 ? rtf.format(-Math.max(1, Math.floor(s / 60)), "minute") : s < 86400 ? rtf.format(-Math.floor(s / 3600), "hour") : rtf.format(-Math.floor(s / 86400), "day");
  };
}

/** The current market and side, best premium first: a table from 640 px, cards below. */
export function OfferList({ market, side, hosts, nowSec }: { market: Market | null; side: "buy" | "sell"; hosts: VenueHost[]; nowSec: number }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const names = useMemo(() => hostNames(hosts), [hosts]);
  const age = useAge(nowSec);
  const maker = makerSide(side);
  const rows = market?.offers.filter((o) => o.side === maker) ?? [];
  if (!market || rows.length === 0) return null;
  const median = market.medianPremium[side];
  const shown = all ? rows : rows.slice(0, PAGE);
  const caption = side === "buy"
    ? t("observatory.p2p.list.captionBuy", { defaultValue: "Offers selling BTC for {{cur}}, cheapest first", cur: market.currency })
    : t("observatory.p2p.list.captionSell", { defaultValue: "Offers buying BTC for {{cur}}, best price first", cur: market.currency });

  return (
    <div data-testid="p2p-offers" data-side={maker} className="space-y-3">
      <table className="hidden w-full text-sm sm:table">
        <caption className="pb-2 text-left text-xs text-faint">{caption}</caption>
        <thead className="text-left text-xs text-faint">
          <tr className="border-b border-hairline">
            <th scope="col" className="py-2 pr-3 font-normal">{t("observatory.p2p.list.venue", { defaultValue: "Venue" })}</th>
            <th scope="col" className="py-2 pr-3 font-normal">{t("observatory.p2p.list.amount", { defaultValue: "Amount" })}</th>
            <th scope="col" className="py-2 pr-3 font-normal text-right">{t("observatory.p2p.list.premium", { defaultValue: "Premium" })}</th>
            <th scope="col" className="py-2 pr-3 font-normal">{t("observatory.p2p.list.methods", { defaultValue: "Payment methods" })}</th>
            <th scope="col" className="hidden py-2 pr-3 font-normal lg:table-cell">{t("observatory.p2p.list.layer", { defaultValue: "Layer" })}</th>
            <th scope="col" className="hidden py-2 pr-3 font-normal lg:table-cell">{t("observatory.p2p.list.escrow", { defaultValue: "Bond or escrow" })}</th>
            <th scope="col" className="hidden py-2 pr-3 font-normal xl:table-cell">{t("observatory.p2p.list.age", { defaultValue: "Age" })}</th>
            <th scope="col" className="py-2 font-normal"><span className="sr-only">{t("observatory.p2p.list.open", { defaultValue: "Open" })}</span></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((o) => (
            <tr key={o.id} data-testid="p2p-offer-row" data-venue={o.venue} data-side={o.side} className="border-b border-hairline align-middle transition-colors hover:bg-surface-2/50">
              <td className="py-2.5 pr-3 max-w-[14rem]"><VenueBadge offer={o} names={names} /></td>
              <td className="py-2.5 pr-3"><Amount offer={o} /></td>
              <td className="py-2.5 pr-3 text-right"><PremiumValue offer={o} median={median} intent={side} /></td>
              <td className="py-2.5 pr-3"><Methods methods={o.methods} /></td>
              <td className="hidden py-2.5 pr-3 lg:table-cell"><LayerLabel offer={o} /></td>
              <td className="hidden py-2.5 pr-3 text-muted whitespace-nowrap lg:table-cell"><EscrowLabel offer={o} /></td>
              <td className="num hidden py-2.5 pr-3 text-xs text-faint whitespace-nowrap xl:table-cell">{age(o)}</td>
              <td className="py-1 text-right"><OpenLink offer={o} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sm:hidden">
        <p className="pb-2 text-xs text-faint">{caption}</p>
        <ul className="space-y-2">
          {shown.map((o) => (
            <li key={o.id} data-testid="p2p-offer-card" data-venue={o.venue} data-side={o.side} className="rounded-xl border border-hairline bg-surface-1 p-3.5 space-y-3">
              <OfferCard offer={o} names={names} median={median} intent={side} />
              <div className="flex items-center justify-between border-t border-hairline pt-2">
                <span className="num text-xs text-faint">{age(o)}</span>
                <OpenLink offer={o} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {rows.length > PAGE && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="inline-flex min-h-10 items-center rounded-lg border border-hairline px-4 text-sm text-muted hover:text-foreground hover:border-hairline-strong cursor-pointer"
        >
          {all
            ? t("observatory.p2p.list.showFewer", { defaultValue: "Show fewer" })
            : t("observatory.p2p.list.showAll", { defaultValue: "Show all {{count}}", count: rows.length })}
        </button>
      )}
    </div>
  );
}
