import { describe, it, expect } from "vitest";
import { buildMarkets, defaultCurrency, depthClip, headline, indexFor, marketOrder, premiumBoard, filterVenues, computePremium } from "../market";
import { robosatsOffers, robosatsIndex, robosatsHost } from "../normalize-robosats";
import { mostroOffers, mostroHosts } from "../normalize-mostro";
import { hodlhodlOffers, hodlhodlHost } from "../normalize-hodlhodl";
import type { P2pOffer } from "../types";
import { NOW, robosatsOrders, mostroOrders, mostroInfo, templeLimits, templeInfo, hodl0, hodl500 } from "./fixtures";

const index = robosatsIndex(templeLimits, "Temple of Sats", NOW);
const hodl = hodlhodlOffers([hodl0, hodl500], index, NOW);
const offers = [
  ...robosatsOffers(robosatsOrders.events, index, NOW),
  ...mostroOffers(mostroOrders.events, mostroInfo.events, index, NOW),
  ...hodl,
];
const markets = buildMarkets(offers, index);
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

describe("markets", () => {
  it("USD market: best buy is the cheapest sell offer, median over sell premiums", () => {
    const usd = markets.get("USD")!;
    const sells = offers.filter((o) => o.currency === "USD" && o.side === "sell" && o.premium !== null);
    expect(usd.bestBuy!.premium).toBe(Math.min(...sells.map((o) => o.premium!)));
    expect(usd.bestBuy!.side).toBe("sell");
    expect(usd.medianPremium.buy).toBeCloseTo(med(sells.map((o) => o.premium!)), 10);
    expect(usd.index).toBe(82905.69);
  });

  it("depth is monotonic and sums to the priced liquidity", () => {
    for (const m of markets.values()) {
      const d = m.depth.sell;
      for (let i = 1; i < d.length; i++) {
        expect(d[i]!.premium).toBeGreaterThanOrEqual(d[i - 1]!.premium);
        expect(d[i]!.cumSats).toBeGreaterThanOrEqual(d[i - 1]!.cumSats);
      }
      const priced = m.offers.filter((o) => o.side === "sell" && o.premium !== null && o.satsMax !== null);
      expect(d.at(-1)?.cumSats ?? 0).toBe(priced.reduce((s, o) => s + o.satsMax!, 0));
      const b = m.depth.buy;
      for (let i = 1; i < b.length; i++) expect(b[i]!.premium).toBeLessThanOrEqual(b[i - 1]!.premium);
    }
  });

  it("USDT is priced with the USD index; unpriced markets stay out of the board and sort last", () => {
    expect(indexFor("USDT", index)).toBe(index.prices.USD);
    if (markets.has("USDT")) expect(markets.get("USDT")!.index).toBe(index.prices.USD);
    const btc: P2pOffer = { ...offers[0]!, id: "x", currency: "BTC", premium: 1, satsMax: 1000 };
    const m2 = buildMarkets([...offers, btc], index);
    expect(m2.get("BTC")!.index).toBeNull();
    expect(premiumBoard(m2, "buy", 100).some((r) => r.currency === "BTC")).toBe(false);
    expect(marketOrder(m2).at(-1)).toBe("BTC");
    expect(computePremium(110, 100)).toBeCloseTo(10, 10);
  });

  it("without an index, declared premiums remain and computed ones are null", () => {
    const m = buildMarkets(robosatsOffers(robosatsOrders.events, null, NOW), null);
    expect([...m.values()].every((x) => x.index === null)).toBe(true);
    expect([...m.values()].some((x) => x.bestBuy?.premium != null)).toBe(true);
  });

  it("default currency by locale with a fallback", () => {
    expect(defaultCurrency("pt", markets)).toBe("BRL");
    expect(defaultCurrency("es-ES", markets)).toBe("EUR");
    const pln = markets.get("PLN")?.offers.length ?? 0;
    expect(defaultCurrency("pl", markets)).toBe(pln >= 3 ? "PLN" : marketOrder(markets)[0]);
    const sparse = buildMarkets(offers.filter((o) => o.currency !== "PLN").concat(offers.filter((o) => o.currency === "PLN").slice(0, 2)), index);
    expect(defaultCurrency("pl", sparse)).toBe(marketOrder(sparse)[0]);
    expect(defaultCurrency("en", new Map())).toBeNull();
  });

  it("premium board: top rows by offers, cells per venue", () => {
    const rows = premiumBoard(markets, "buy");
    expect(rows.length).toBeLessThanOrEqual(12);
    expect(rows.length).toBeGreaterThan(3);
    const eur = rows.find((r) => r.currency === "EUR")!;
    expect(eur.cells.robosats.offers + eur.cells.mostro.offers + eur.cells.hodlhodl.offers)
      .toBe(markets.get("EUR")!.offers.filter((o) => o.side === "sell").length);
  });

  it("headline counts hosts up over total and liquidity across markets", () => {
    const hosts = [robosatsHost("temple", templeInfo, 1, true), robosatsHost("bazaar", null, 1, false), ...mostroHosts(mostroOrders.events, mostroInfo.events, NOW), hodlhodlHost(hodl, true)];
    const h = headline(markets, hosts, "EUR");
    const eligible = hosts.filter((x) => x.status !== "unknown" && !x.unlisted);
    expect(h.hostsOnline).toBe(eligible.filter((x) => x.status === "up").length);
    expect(h.hostsTotal).toBe(eligible.length);
    expect(h.hostsTotal).toBeLessThan(hosts.length);
    expect(h.liquiditySats).toBe([...markets.values()].reduce((s, m) => s + m.liquiditySats.buy, 0));
    expect(h.venuesOnline).toBe(3);
    expect(h.liquiditySats).toBeGreaterThan(1e7);
    expect(h.cheapestBuy).toEqual({ currency: "EUR", premium: markets.get("EUR")!.bestBuy!.premium });
    expect(headline(new Map(), [], null).cheapestBuy).toBeNull();
  });

  it("filterVenues and depthClip", () => {
    expect(filterVenues(offers, ["hodlhodl"]).every((o) => o.venue === "hodlhodl")).toBe(true);
    expect(filterVenues(offers, ["robosats", "mostro", "hodlhodl"])).toBe(offers);
    const pts = Array.from({ length: 20 }, (_, i) => ({ premium: i / 10, cumSats: (i + 1) * 1000 }));
    pts.push({ premium: 500, cumSats: 99999 });
    const c = depthClip(pts);
    expect(c.above).toBe(1);
    expect(c.points.some((p) => p.premium === 500)).toBe(false);
  });
});

describe("unlisted Mostro instances", () => {
  it("stay in the list but never shape the best offer, medians, depth, board or headline", () => {
    const usd = markets.get("USD")!;
    const fake: P2pOffer = { ...usd.offers.find((o) => o.side === "sell")!, id: "mostro:x:1", venue: "mostro", host: "ab".repeat(32), premium: -50, satsMax: 1e9, unlisted: true };
    const m2 = buildMarkets([...offers, fake], index);
    const u = m2.get("USD")!;
    expect(u.offers).toContain(fake);
    expect(u.bestBuy!.premium).toBe(usd.bestBuy!.premium);
    expect(u.medianPremium).toEqual(usd.medianPremium);
    expect(u.depth.sell.some((p) => p.offer === fake)).toBe(false);
    expect(u.liquiditySats).toEqual(usd.liquiditySats);
    const row = premiumBoard(m2, "buy").find((r) => r.currency === "USD")!;
    expect(row.cells.mostro.offers).toBe(premiumBoard(markets, "buy").find((r) => r.currency === "USD")!.cells.mostro.offers);
    expect(headline(m2, [], "USD").cheapestBuy).toEqual(headline(markets, [], "USD").cheapestBuy);
  });
});
