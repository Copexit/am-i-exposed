import { computePremium, indexFor } from "./market";
import { currencyCode, num } from "./normalize-common";
import { sanitizeMethods } from "./sanitize";
import type { HodlPage, IndexPrices, P2pOffer, VenueHost } from "./types";

/** Never reads title, description or trader: they carry contact details. */
export function hodlhodlOffers(pages: HodlPage[], index: IndexPrices | null, nowSec: number): P2pOffer[] {
  const out = new Map<string, P2pOffer>();
  for (const page of pages) {
    for (const o of page.offers ?? []) {
      if (o.asset_layer !== "BTC" || o.working_now === false || out.has(o.id)) continue;
      if (o.side !== "buy" && o.side !== "sell") continue;
      const currency = currencyCode(String(o.currency_code ?? ""));
      if (!currency) continue;
      const price = num(o.price);
      const idx = indexFor(currency, index);
      const dev = num(o.exchange_price_deviation);
      const premium = o.price_source === "exchange_rate" && o.exchange_price_unit === "%" && dev !== null
        ? (o.exchange_price_sign === "-" ? -dev : dev)
        : price !== null && idx !== null ? computePremium(price, idx) : null;
      const fiatMax = num(o.max_amount);
      const sats = num(o.max_amount_sats);
      const methods = o.payment_methods?.length
        ? o.payment_methods.map((m) => m.name)
        : (o.payment_method_instructions ?? []).map((m) => m.payment_method_name);
      out.set(o.id, {
        id: `hodlhodl:hodlhodl:${o.id}`,
        venue: "hodlhodl",
        host: "hodlhodl",
        side: o.side,
        currency,
        fiatMin: num(o.min_amount),
        fiatMax,
        satsMax: sats !== null && sats > 0 ? sats : price && fiatMax !== null ? Math.round((fiatMax / price) * 1e8) : null,
        premium,
        price,
        methods: sanitizeMethods(methods),
        layer: "onchain",
        bondPct: null,
        createdAt: nowSec,
        expiresAt: null,
        link: /^[A-Za-z0-9_-]+$/.test(o.id) ? `https://hodlhodl.com/offers/${o.id}` : null,
      });
    }
  }
  return [...out.values()];
}

/** One aggregate host; the median author fee comes from the raw pages when given. */
export function hodlhodlHost(offers: P2pOffer[], ok: boolean, pages: HodlPage[] = []): VenueHost {
  const fees = pages.flatMap((p) => p.offers ?? []).map((o) => num(o.fee?.author_fee_rate)).filter((f): f is number => f !== null).sort((a, b) => a - b);
  const median = fees.length ? fees[Math.floor(fees.length / 2)]! * 100 : null;
  return {
    venue: "hodlhodl",
    key: "hodlhodl",
    name: "HodlHodl",
    status: ok ? "up" : "down",
    inBook: offers.length,
    version: null,
    makerFeePct: median,
    takerFeePct: null,
    bondPct: null,
    minSats: null,
    maxSats: null,
    volume24hBtc: null,
    lifetimeBtc: null,
    robotsToday: null,
    premium24h: null,
    notice: null,
    lastSeen: null,
    currencies: [...new Set(offers.map((o) => o.currency))].sort(),
  };
}
