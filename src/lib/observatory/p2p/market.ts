import type { DepthPoint, IndexPrices, Market, P2pOffer, Side, Venue, VenueHost } from "./types";

export const STABLE_TO_FIAT: Record<string, string> = { USDT: "USD", USDC: "USD" };

/** Fiat per BTC for a currency; USDT/USDC use the USD index; "BTC" (RoboSats swaps) is never priced. */
export function indexFor(code: string, index: IndexPrices | null): number | null {
  if (code === "BTC") return null;
  const v = index?.prices[STABLE_TO_FIAT[code] ?? code];
  return typeof v === "number" && v > 0 ? v : null;
}

/** (price / idx - 1) * 100 */
export function computePremium(price: number, idx: number): number {
  return (price / idx - 1) * 100;
}

const VENUE_LIST: readonly Venue[] = ["robosats", "mostro", "hodlhodl"];

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const listed = (o: P2pOffer) => !o.unlisted;
const premiums = (offers: P2pOffer[]) => offers.flatMap((o) => (o.premium === null ? [] : [o.premium]));
const sumSats = (offers: P2pOffer[]) => offers.reduce((s, o) => s + (o.satsMax ?? 0), 0);
/** Nulls last. */
const byPremium = (dir: 1 | -1) => (a: P2pOffer, b: P2pOffer) =>
  a.premium === null ? (b.premium === null ? 0 : 1) : b.premium === null ? -1 : (a.premium - b.premium) * dir;

function depth(offers: P2pOffer[]): DepthPoint[] {
  let cum = 0;
  return offers
    .filter((o) => o.premium !== null && o.satsMax !== null)
    .map((o) => ({ premium: o.premium!, cumSats: (cum += o.satsMax!), offer: o }));
}

/** Maker side listed for a visitor intent: buying BTC lists sell offers. */
export const makerSide = (intent: "buy" | "sell"): Side => (intent === "buy" ? "sell" : "buy");

export function buildMarkets(offers: P2pOffer[], index: IndexPrices | null): Map<string, Market> {
  const groups = new Map<string, P2pOffer[]>();
  for (const o of offers) groups.set(o.currency, [...(groups.get(o.currency) ?? []), o]);
  const out = new Map<string, Market>();
  for (const [currency, list] of groups) {
    const sells = list.filter((o) => o.side === "sell").sort(byPremium(1));
    const buys = list.filter((o) => o.side === "buy").sort(byPremium(-1));
    // Unlisted Mostro instances stay in the list but never shape a statistic.
    const lSells = sells.filter(listed);
    const lBuys = buys.filter(listed);
    const byVenue = Object.fromEntries(VENUE_LIST.map((v) => {
      const vs = list.filter((o) => o.venue === v && listed(o));
      return [v, { offers: vs.length, liquiditySats: sumSats(vs), medianPremium: median(premiums(vs)) }];
    })) as Market["byVenue"];
    out.set(currency, {
      currency,
      index: indexFor(currency, index),
      offers: [...sells, ...buys],
      bestBuy: lSells.find((o) => o.premium !== null) ?? null,
      bestSell: lBuys.find((o) => o.premium !== null) ?? null,
      medianPremium: { buy: median(premiums(lSells)), sell: median(premiums(lBuys)) },
      liquiditySats: { buy: sumSats(lSells), sell: sumSats(lBuys) },
      depth: { sell: depth(lSells), buy: depth(lBuys) },
      byVenue,
    });
  }
  return out;
}

/** Currencies by offer count desc, then code; unpriced markets last. */
export function marketOrder(markets: Map<string, Market>): string[] {
  return [...markets.values()]
    .sort((a, b) => Number(a.index === null) - Number(b.index === null) || b.offers.length - a.offers.length || a.currency.localeCompare(b.currency))
    .map((m) => m.currency);
}

const LOCALE_CURRENCY: Record<string, string> = { en: "USD", es: "EUR", pt: "BRL", de: "EUR", fr: "EUR", pl: "PLN" };

/** Locale default market, else the market with the most offers when the default has fewer than 3. */
export function defaultCurrency(locale: string, markets: Map<string, Market>): string | null {
  const code = LOCALE_CURRENCY[locale.slice(0, 2).toLowerCase()] ?? "USD";
  if ((markets.get(code)?.offers.length ?? 0) >= 3) return code;
  return marketOrder(markets)[0] ?? null;
}

export function filterVenues(offers: P2pOffer[], venues: readonly Venue[]): P2pOffer[] {
  return venues.length === VENUE_LIST.length ? offers : offers.filter((o) => venues.includes(o.venue));
}

export interface BoardRow { currency: string; cells: Record<Venue, { median: number | null; offers: number }> }

/** side = visitor intent; rows are the top priced markets by offers on that side. */
export function premiumBoard(markets: Map<string, Market>, side: "buy" | "sell", top = 12): BoardRow[] {
  const maker = makerSide(side);
  return [...markets.values()]
    .filter((m) => m.index !== null)
    .map((m) => ({ m, list: m.offers.filter((o) => o.side === maker && listed(o)) }))
    .filter((r) => r.list.length > 0)
    .sort((a, b) => b.list.length - a.list.length || a.m.currency.localeCompare(b.m.currency))
    .slice(0, top)
    .map(({ m, list }) => ({
      currency: m.currency,
      cells: Object.fromEntries(VENUE_LIST.map((v) => {
        const vs = list.filter((o) => o.venue === v);
        return [v, { median: median(premiums(vs)), offers: vs.length }];
      })) as BoardRow["cells"],
    }));
}

export interface Headline {
  /** BTC actually for sale: the sum of maker sell offers' maximums (an upper bound). */
  liquiditySats: number;
  /** Keyed by visitor intent: buy = sats in maker sell offers. */
  liquidity: { buy: number; sell: number };
  offers: { buy: number; sell: number };
  venuesOnline: number;
  /** Hosts up, over hosts that can be up from this deployment (no Tor-only, unlisted or dead ones). */
  hostsOnline: number;
  hostsTotal: number;
  cheapestBuy: { currency: string; premium: number } | null;
  cheapestSell: { currency: string; premium: number } | null;
  medianBuy: number | null;
  medianSell: number | null;
}

export function headline(markets: Map<string, Market>, hosts: VenueHost[], currency: string | null): Headline {
  const all = [...markets.values()];
  const venues = new Set(all.flatMap((m) => m.offers.filter(listed).map((o) => o.venue)));
  const m = currency ? markets.get(currency) : undefined;
  const eligible = hosts.filter((h) => h.status !== "unknown" && !h.unlisted);
  return {
    liquiditySats: all.reduce((s, x) => s + x.liquiditySats.buy, 0),
    liquidity: {
      buy: all.reduce((s, x) => s + x.liquiditySats.buy, 0),
      sell: all.reduce((s, x) => s + x.liquiditySats.sell, 0),
    },
    offers: {
      buy: all.reduce((s, x) => s + x.offers.filter((o) => o.side === "sell" && listed(o)).length, 0),
      sell: all.reduce((s, x) => s + x.offers.filter((o) => o.side === "buy" && listed(o)).length, 0),
    },
    venuesOnline: venues.size,
    hostsOnline: eligible.filter((h) => h.status === "up").length,
    hostsTotal: eligible.length,
    cheapestBuy: m?.bestBuy?.premium != null ? { currency: m.currency, premium: m.bestBuy.premium } : null,
    cheapestSell: m?.bestSell?.premium != null ? { currency: m.currency, premium: m.bestSell.premium } : null,
    medianBuy: m?.medianPremium.buy ?? null,
    medianSell: m?.medianPremium.sell ?? null,
  };
}

function percentile(sorted: number[], p: number): number {
  const i = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** Keeps points inside the lo..hi premium percentiles; counts the rest as "beyond" each edge. */
export function depthClip(points: DepthPoint[], lo = 2, hi = 98): { points: DepthPoint[]; below: number; above: number } {
  if (points.length < 3) return { points, below: 0, above: 0 };
  const sorted = points.map((p) => p.premium).sort((a, b) => a - b);
  const min = percentile(sorted, lo);
  const max = percentile(sorted, hi);
  return {
    points: points.filter((p) => p.premium >= min && p.premium <= max),
    below: points.filter((p) => p.premium < min).length,
    above: points.filter((p) => p.premium > max).length,
  };
}

/** Offers accepting a payment method (any of an offer's methods); null keeps all. */
export function filterMethod(offers: P2pOffer[], pm: string | null): P2pOffer[] {
  return pm ? offers.filter((o) => o.pm.includes(pm)) : offers;
}

/** Payment methods in these offers with offer counts, most common first, "other" last. */
export function methodCounts(offers: P2pOffer[]): { id: string; count: number }[] {
  const c = new Map<string, number>();
  for (const o of offers) for (const id of o.pm) c.set(id, (c.get(id) ?? 0) + 1);
  return [...c]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => Number(a.id === "other") - Number(b.id === "other") || b.count - a.count || a.id.localeCompare(b.id));
}

/** A fixed-amount offer matches an amount within this fraction of its amount. */
export const FIXED_TOLERANCE = 0.05;

/**
 * How an offer takes a fiat amount: inside its min..max ("range"), within ±5% of its one amount
 * ("fixed"), or "open" when it states no limits (kept, and marked). null: it does not take it.
 * A one-sided limit counts as open on the other side.
 */
export function amountMatch(o: P2pOffer, amount: number): "range" | "fixed" | "open" | null {
  const { fiatMin: lo, fiatMax: hi } = o;
  if (lo === null && hi === null) return "open";
  if (lo !== null && lo === hi) return Math.abs(amount - lo) <= lo * FIXED_TOLERANCE + 1e-9 ? "fixed" : null;
  return amount >= (lo ?? 0) && amount <= (hi ?? Infinity) ? "range" : null;
}

export interface AmountFilterSpec { value: number; unit: "fiat" | "btc" }

/**
 * Offers in `currency` that take the amount; other currencies and a null amount pass through.
 * A BTC amount is priced at the offer's own price when it has one, else at the index; an offer
 * with neither is kept, since nothing says it cannot take the amount.
 */
export function filterAmount(offers: P2pOffer[], currency: string | null, amount: AmountFilterSpec | null, idx: number | null = null): P2pOffer[] {
  if (amount === null) return offers;
  return offers.filter((o) => {
    if (o.currency !== currency) return true;
    const rate = amount.unit === "btc" ? o.price ?? idx : 1;
    return rate === null || amountMatch(o, amount.value * rate) !== null;
  });
}
