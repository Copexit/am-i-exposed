import { describe, it, expect } from "vitest";
import { amountMatch, buildMarkets, filterAmount, FIXED_TOLERANCE } from "../market";
import { robosatsIndex, robosatsOffers } from "../normalize-robosats";
import { mostroOffers } from "../normalize-mostro";
import { hodlhodlOffers } from "../normalize-hodlhodl";
import { parseAmount } from "../p2p-format";
import type { HodlOffer, NostrEvent, P2pOffer } from "../types";
import { NOW, robosatsOrders, mostroOrders, mostroInfo, templeLimits, hodl0, hodl500 } from "./fixtures";

const index = robosatsIndex(templeLimits, "Temple of Sats", NOW);
const robo = robosatsOffers(robosatsOrders.events, index, NOW);
const mostro = mostroOffers(mostroOrders.events, mostroInfo.events, index, NOW);
const hodl = hodlhodlOffers([hodl0, hodl500], index, NOW);

const fixed = (o: P2pOffer) => o.fiatMin !== null && o.fiatMin === o.fiatMax;
const ranged = (o: P2pOffer) => o.fiatMin !== null && o.fiatMax !== null && o.fiatMin < o.fiatMax;
const first = (xs: P2pOffer[], f: (o: P2pOffer) => boolean) => { const o = xs.find(f); if (!o) throw new Error("no fixture offer"); return o; };
/** A real order event with its fiat amount tag removed: what an order with no stated limits normalizes to. */
const stripFa = (e: NostrEvent): NostrEvent => ({ ...e, tags: e.tags.filter((t) => t[0] !== "fa") });

function edges(o: P2pOffer) {
  if (fixed(o)) {
    const f = o.fiatMin!;
    expect(amountMatch(o, f)).toBe("fixed");
    expect(amountMatch(o, f * (1 + FIXED_TOLERANCE))).toBe("fixed");
    expect(amountMatch(o, f * (1 - FIXED_TOLERANCE))).toBe("fixed");
    expect(amountMatch(o, f * 1.051)).toBeNull();
    expect(amountMatch(o, f * 0.949)).toBeNull();
  } else {
    expect(amountMatch(o, o.fiatMin!)).toBe("range");
    expect(amountMatch(o, o.fiatMax!)).toBe("range");
    expect(amountMatch(o, (o.fiatMin! + o.fiatMax!) / 2)).toBe("range");
    expect(amountMatch(o, o.fiatMin! - 0.01)).toBeNull();
    expect(amountMatch(o, o.fiatMax! + 0.01)).toBeNull();
  }
}

describe("amountMatch on recorded offers", () => {
  it("RoboSats: fa with two values is a range, one value a fixed amount (±5%)", () => {
    expect(robo.some(fixed) && robo.some(ranged)).toBe(true);
    const r = first(robo, ranged);
    expect(r.fiatMin).toBeLessThan(r.fiatMax!);
    edges(r);
    edges(first(robo, fixed));
  });

  it("Mostro: fa range, fa single, and fa single with a fixed sats amount", () => {
    edges(first(mostro, ranged));
    edges(first(mostro, (o) => fixed(o) && o.satsMax !== null && o.price !== null && o.premium !== null));
    const satsFixed = mostroOrders.events.find((e) => e.tags.some((t) => t[0] === "amt" && Number(t[1]) > 0) && e.tags.find((t) => t[0] === "fa")?.length === 2)!;
    const o = first(mostro, (x) => x.id.endsWith(satsFixed.tags.find((t) => t[0] === "d")![1]!));
    expect(fixed(o)).toBe(true);
    edges(o);
  });

  it("HodlHodl: min_amount..max_amount in the offer currency; equal limits are a fixed amount", () => {
    edges(first(hodl, ranged));
    const raw = hodl500.offers[0]!;
    const [o] = hodlhodlOffers([{ status: "success", offers: [{ ...raw, max_amount: raw.min_amount } as HodlOffer] }], index, NOW);
    expect(fixed(o!)).toBe(true);
    edges(o!);
  });

  it("an order with no stated limits stays in, marked open", () => {
    const e = stripFa(robosatsOrders.events[0]!);
    const [o] = robosatsOffers([e], index, NOW);
    expect(o!.fiatMin).toBeNull();
    expect(amountMatch(o!, 1)).toBe("open");
    const [m] = mostroOffers([stripFa(mostroOrders.events.find((x) => mostro.some((o) => o.id.endsWith(x.tags.find((t) => t[0] === "d")![1]!)))!)], mostroInfo.events, index, NOW);
    expect(amountMatch(m!, 1e9)).toBe("open");
    const [h] = hodlhodlOffers([{ status: "success", offers: [{ ...hodl500.offers[0]!, min_amount: "", max_amount: "" } as HodlOffer] }], index, NOW);
    expect(amountMatch(h!, 250)).toBe("open");
  });

  it("a one-sided limit is open on the other side", () => {
    const o = first(hodl, ranged);
    expect(amountMatch({ ...o, fiatMax: null }, 1e9)).toBe("range");
    expect(amountMatch({ ...o, fiatMin: null }, 0.01)).toBe("range");
  });
});

describe("filterAmount", () => {
  const all = [...robo, ...mostro, ...hodl];
  it("narrows only the chosen currency and composes with the market build", () => {
    const eur = all.filter((o) => o.currency === "EUR");
    const out = filterAmount(all, "EUR", { value: 250, unit: "fiat" });
    expect(out.filter((o) => o.currency !== "EUR")).toHaveLength(all.length - eur.length);
    const kept = out.filter((o) => o.currency === "EUR");
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(eur.length);
    for (const o of kept) expect(amountMatch(o, 250)).not.toBeNull();
    const m = buildMarkets(out, index).get("EUR")!;
    expect(m.offers).toHaveLength(kept.length);
    expect(filterAmount(all, "EUR", null)).toBe(all);
  });
});

describe("amount conversion and parsing", () => {
  it("a BTC amount is priced at the offer's own price, else the index; neither keeps the offer", () => {
    const o = first(hodl, (x) => ranged(x) && x.price !== null);
    const btcAt = (fiat: number, rate: number) => fiat / rate;
    const keep = (x: P2pOffer, btc: number, idx: number | null) => filterAmount([x], x.currency, { value: btc, unit: "btc" }, idx).length === 1;
    // Priced at the offer's own price, its max is in even when the index is far off; without a price the index decides.
    expect(keep(o, btcAt(o.fiatMax!, o.price!), o.price! * 0.5)).toBe(true);
    expect(keep(o, btcAt(o.fiatMax!, o.price!) * 1.01, null)).toBe(false);
    expect(keep({ ...o, price: null }, btcAt(o.fiatMax!, 2 * o.price!), 2 * o.price!)).toBe(true);
    expect(keep({ ...o, price: null }, btcAt(o.fiatMax!, o.price!) * 1.01, o.price!)).toBe(false);
    expect(keep({ ...o, price: null }, 1e6, null)).toBe(true);
    expect(filterAmount([o], o.currency, null)).toEqual([o]);
  });

  it("parses both grouping conventions", () => {
    expect(parseAmount("1.234,56", "de")).toBe(1234.56);
    expect(parseAmount("1,234.56", "en")).toBe(1234.56);
    expect(parseAmount("1 234,56", "fr")).toBe(1234.56);
    expect(parseAmount("1,234", "en")).toBe(1234);
    expect(parseAmount("1,234", "de")).toBe(1.234);
    expect(parseAmount("1.234", "de")).toBe(1234);
    expect(parseAmount("1.234.567", "en")).toBe(1234567);
    expect(parseAmount("250", "es")).toBe(250);
    expect(parseAmount("250,5", "en")).toBe(250.5);
    expect(parseAmount("0.0034", "de")).toBe(0.0034);
    expect(parseAmount("0,001", "en")).toBe(0.001);
    expect(parseAmount(",5", "es")).toBe(0.5);
    for (const pasted of ["€250", "250 €", "EUR 250", "250EUR", "€ 250", "R$ 250", "250 zł"]) expect(parseAmount(pasted, "en")).toBe(250);
    expect(parseAmount("₿0.01", "en")).toBe(0.01);
    expect(parseAmount("BTC 0,01", "de")).toBe(0.01);
    for (const bad of ["", "abc", "EUR", "-5", "1e5", "0", "1,2,3.4,5", "1.234,5.6", "250-EUR", "2 50€x5"]) expect(parseAmount(bad, "en")).toBeNull();
  });
});
