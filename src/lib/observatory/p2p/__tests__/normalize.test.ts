import { describe, it, expect } from "vitest";
import { ROBOSATS_COORDINATORS, robosatsOffers, robosatsHost, robosatsHistory, robosatsIndex } from "../normalize-robosats";
import { mostroOffers, mostroHosts, mostroDaily } from "../normalize-mostro";
import { hodlhodlOffers, hodlhodlHost } from "../normalize-hodlhodl";
import { latestReplaceable, tag } from "../nostr-verify";
import {
  NOW, robosatsOrders, mostroOrders, mostroInfo, mostroTrades, templeInfo, templeLimits, templeHistorical, hodl0, hodl500,
} from "./fixtures";

const index = robosatsIndex(templeLimits, "Temple of Sats", NOW);

describe("RoboSats", () => {
  it("index: 80 codes, USD price", () => {
    expect(Object.keys(index.prices)).toHaveLength(80);
    expect(index.prices.USD).toBe(82905.69);
  });

  it("orders map to offers from the federation, ranges kept, sats from the index, no names", () => {
    const expected = robosatsOrders.events.filter((e) =>
      tag(e, "network")?.[0] === "mainnet" && Number(tag(e, "expiration")?.[0]) > NOW).length;
    const offers = robosatsOffers(robosatsOrders.events, index, NOW);
    expect(offers).toHaveLength(expected);
    const keys = new Set(ROBOSATS_COORDINATORS.map((c) => c.key));
    expect(keys.size).toBe(7);
    expect(offers.every((o) => keys.has(o.host))).toBe(true);
    expect(offers.some((o) => o.fiatMin !== null && o.fiatMax !== null && o.fiatMin < o.fiatMax)).toBe(true);
    const usd = offers.find((o) => o.currency === "USD" && o.premium !== null && o.fiatMax !== null)!;
    const expectedSats = (usd.fiatMax! / (index.prices.USD! * (1 + usd.premium! / 100))) * 1e8;
    expect(Math.abs(usd.satsMax! - expectedSats) / expectedSats).toBeLessThan(0.01);
    expect(JSON.stringify(offers).includes("Robot")).toBe(false);
    expect(offers.every((o) => o.link === null || /^http:\/\/[a-z2-7]{56}\.onion\//.test(o.link))).toBe(true);
    expect(offers.some((o) => o.link !== null)).toBe(true);
  });

  it("drops events from unknown pubkeys", () => {
    const e = { ...robosatsOrders.events[0]!, pubkey: "ab".repeat(32) };
    expect(robosatsOffers([e], index, NOW)).toEqual([]);
  });

  it("info units: fee fractions to percent, bond percent, volumes in BTC", () => {
    const h = robosatsHost("temple", templeInfo, 10, true);
    expect(h.makerFeePct).toBeCloseTo(0.025, 10);
    expect(h.takerFeePct).toBeCloseTo(0.175, 10);
    expect(h.bondPct).toBe(3);
    expect(h.volume24hBtc).toBe(0.25827531);
    expect(h.lifetimeBtc).toBe(192.30429803);
    expect(h.version).toBe("0.8.7");
    expect(h.minSats).toBe(15000);
    expect(h.status).toBe("up");
    expect(h.name).toBe("Temple of Sats");
    expect(h.notice).toBeNull();
    expect(robosatsHost("bazaar", null, 22, false).status).toBe("unknown");
    expect(robosatsHost("lake", null, 0, true).status).toBe("down");
  });

  it("historical: one entry per day, BTC volume", () => {
    const h = robosatsHistory(templeHistorical);
    expect(h).toHaveLength(1076);
    expect(h.at(-1)).toEqual({ date: "2026-10-06", btc: 0.189, trades: 28 });
    expect(h[0]!.date < h[1]!.date).toBe(true);
  });
});

describe("Mostro", () => {
  it("keeps live mainnet orders from instances that published info", () => {
    const offers = mostroOffers(mostroOrders.events, mostroInfo.events, index, NOW);
    const infoKeys = new Set(mostroInfo.events.map((e) => e.pubkey));
    const reasons = latestReplaceable(mostroOrders.events).map((e) =>
      tag(e, "network")?.[0] !== "mainnet" ? "network" : Number(tag(e, "expires_at")?.[0]) <= NOW ? "expired" : !infoKeys.has(e.pubkey) ? "no-info" : "kept");
    expect(offers.length, JSON.stringify(reasons.reduce<Record<string, number>>((a, r) => ({ ...a, [r]: (a[r] ?? 0) + 1 }), {}))).toBe(103);
    expect(offers.every((o) => infoKeys.has(o.host) && o.link === null && (o.expiresAt ?? 0) > NOW)).toBe(true);
    expect(JSON.stringify(offers)).not.toMatch(/\[link\]|\[number\]|@user/);
  });

  it("drops regtest and expired orders", () => {
    const e = mostroOrders.events.find((x) => tag(x, "network")?.[0] === "regtest")!;
    expect(mostroOffers([e], mostroInfo.events, index, NOW)).toEqual([]);
    expect(mostroOffers(mostroOrders.events, mostroInfo.events, index, NOW + 10 * 86400)).toEqual([]);
  });

  it("instance status: live orders give up, stale info with no orders gives down", () => {
    const hosts = mostroHosts(mostroOrders.events, mostroInfo.events, NOW);
    expect(hosts.length).toBe(new Set(mostroInfo.events.map((e) => e.pubkey)).size);
    const withOrders = hosts.filter((h) => h.inBook > 0);
    expect(withOrders.length).toBeGreaterThan(0);
    expect(withOrders.every((h) => h.status === "up")).toBe(true);
    const stale = hosts.filter((h) => h.inBook === 0 && NOW - (h.lastSeen ?? 0) > 48 * 3600);
    expect(stale.length).toBeGreaterThan(0);
    expect(stale.every((h) => h.status === "down")).toBe(true);
    const fee = hosts.find((h) => h.makerFeePct !== null)!;
    expect(fee.makerFeePct!).toBeLessThan(5);
  });

  it("daily completed trades: 7 zero-filled UTC days ending today", () => {
    const days = mostroDaily(mostroTrades.events, index, NOW);
    expect(days).toHaveLength(7);
    expect(days.at(-1)!.date).toBe("2026-10-07");
    expect(days[0]!.date).toBe("2026-10-01");
    const inWindow = latestReplaceable(mostroTrades.events).filter((e) =>
      tag(e, "s")?.[0] === "success" && tag(e, "network")?.[0] === "mainnet"
      && new Date(e.created_at * 1000).toISOString().slice(0, 10) >= "2026-10-01").length;
    expect(days.reduce((s, d) => s + d.trades, 0)).toBe(inWindow);
    expect(days.some((d) => d.btc > 0)).toBe(true);
  });
});

describe("HodlHodl", () => {
  const offers = hodlhodlOffers([hodl0, hodl500], index, NOW);

  it("skips ARK and offers not working now; both method shapes give labels", () => {
    expect(offers.length).toBeGreaterThan(150);
    const raw = [...hodl0.offers, ...hodl500.offers];
    expect(offers).toHaveLength(raw.filter((o) => o.asset_layer === "BTC" && o.working_now).length);
    const instr = raw.find((o) => !o.payment_methods?.length && o.payment_method_instructions?.length)!;
    expect(offers.find((o) => o.id === `hodlhodl:hodlhodl:${instr.id}`)!.methods.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.layer === "onchain" && o.link?.startsWith("https://hodlhodl.com/offers/"))).toBe(true);
  });

  it("declared premium from sign and deviation; fixed price computed against the index", () => {
    const gbp = hodl0.offers.find((o) => o.currency_code === "GBP" && o.exchange_price_sign === "-" && o.exchange_price_deviation === "5.00000000")!;
    expect(offers.find((o) => o.id.endsWith(gbp.id))!.premium).toBe(-5);
    const fixed = [...hodl0.offers, ...hodl500.offers].find((o) => o.asset_layer === "BTC" && o.price_source === "fixed_value" && index.prices[o.currency_code])!;
    const f = offers.find((o) => o.id.endsWith(fixed.id))!;
    expect(f.premium).toBeCloseTo((Number(fixed.price) / index.prices[fixed.currency_code]! - 1) * 100, 6);
  });

  it("never carries trader data, titles or descriptions", () => {
    const s = JSON.stringify(offers);
    expect(s).not.toContain("trader-");
    expect(s).not.toContain("description");
    expect(s).not.toContain("title");
  });

  it("dedupes repeated pages and summarizes one host", () => {
    expect(hodlhodlOffers([hodl0, hodl0], index, NOW)).toHaveLength(hodlhodlOffers([hodl0], index, NOW).length);
    const h = hodlhodlHost(offers, true, [hodl0, hodl500]);
    expect(h.status).toBe("up");
    expect(h.inBook).toBe(offers.length);
    expect(h.makerFeePct).toBeGreaterThan(0);
    expect(hodlhodlHost([], false).status).toBe("down");
  });
});
