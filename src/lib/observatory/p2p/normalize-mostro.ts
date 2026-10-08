import { getService } from "@/lib/services/registry";
import { latestReplaceable, tag } from "./nostr-verify";
import { currencyCode, fiatRange, num, pricing, toLayer } from "./normalize-common";
import { indexFor } from "./market";
import { paymentMethodIds } from "./payment-methods";
import { sanitizeMethods, sanitizeNotice } from "./sanitize";
import type { DailyVolume, IndexPrices, NostrEvent, P2pOffer, VenueHost } from "./types";

const DAY = 86_400;
/** Instances whose latest info is older than this are dead and not listed. */
const DEAD_AFTER = 30 * DAY;

/** Listed Mostro instance pubkeys (registry `mostro-nostr.p2p.instances`). */
export const MOSTRO_INSTANCES: ReadonlySet<string> = new Set(
  (getService("mostro-nostr")?.p2p?.instances ?? []).map((i) => i.pubkey),
);
const ACTIVE_WINDOW = 48 * 3600;

function liveOrders(orders: NostrEvent[], info: NostrEvent[], nowSec: number): NostrEvent[] {
  const authors = new Set(info.map((e) => e.pubkey));
  return latestReplaceable(orders).filter((e) => {
    if (!authors.has(e.pubkey) || tag(e, "y")?.[0] !== "mostro") return false;
    if (tag(e, "network")?.[0] !== "mainnet" || tag(e, "s")?.[0] !== "pending") return false;
    const exp = num(tag(e, "expires_at")?.[0]);
    return exp !== null && exp > nowSec;
  });
}

const instanceName = (e?: NostrEvent) => (e ? sanitizeNotice(tag(e, "y")?.[1] ?? "", 40) : null);

export function mostroOffers(orders: NostrEvent[], info: NostrEvent[], index: IndexPrices | null, nowSec: number): P2pOffer[] {
  const out: P2pOffer[] = [];
  for (const e of liveOrders(orders, info, nowSec)) {
    const side = tag(e, "k")?.[0];
    const d = tag(e, "d")?.[0];
    const currency = currencyCode(tag(e, "f")?.[0]);
    if ((side !== "buy" && side !== "sell") || !d || !currency) continue;
    const { fiatMin, fiatMax } = fiatRange(tag(e, "fa"));
    const { price, premium, satsMax } = pricing(currency, num(tag(e, "premium")?.[0]), fiatMin, fiatMax, num(tag(e, "amt")?.[0]), index);
    out.push({
      id: `mostro:${e.pubkey}:${d}`,
      venue: "mostro",
      host: e.pubkey,
      side,
      currency,
      fiatMin,
      fiatMax,
      satsMax,
      premium,
      price,
      methods: sanitizeMethods(tag(e, "pm") ?? []),
      pm: paymentMethodIds(tag(e, "pm") ?? []),
      layer: toLayer(tag(e, "layer")?.[0]),
      bondPct: null,
      createdAt: num(tag(e, "published_at")?.[0]) ?? e.created_at,
      expiresAt: num(tag(e, "expires_at")?.[0]),
      link: null,
      ...(MOSTRO_INSTANCES.has(e.pubkey) ? {} : { unlisted: true }),
    });
  }
  return out;
}

export function mostroHosts(orders: NostrEvent[], info: NostrEvent[], nowSec: number): VenueHost[] {
  const latestInfo = new Map<string, NostrEvent>();
  for (const e of info) {
    // Instances on regtest or testnet are not markets; silent ones are dead.
    const net = tag(e, "lnd_networks")?.[0];
    if ((net && net !== "mainnet") || nowSec - e.created_at > DEAD_AFTER) continue;
    const cur = latestInfo.get(e.pubkey);
    if (!cur || e.created_at > cur.created_at) latestInfo.set(e.pubkey, e);
  }
  const live = liveOrders(orders, info, nowSec);
  const byHost = new Map<string, NostrEvent[]>();
  for (const e of live) byHost.set(e.pubkey, [...(byHost.get(e.pubkey) ?? []), e]);

  return [...latestInfo.values()].map((i) => {
    const own = byHost.get(i.pubkey) ?? [];
    const newestOrder = own.reduce<NostrEvent | undefined>((a, b) => (!a || b.created_at > a.created_at ? b : a), undefined);
    const fee = num(tag(i, "fee")?.[0]);
    const maintenance = tag(i, "maintenance_mode")?.[0] === "true";
    const fresh = nowSec - i.created_at <= ACTIVE_WINDOW;
    const currencies = (tag(i, "fiat_currencies_accepted")?.[0] ?? "").split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{3,5}$/.test(c));
    return {
      venue: "mostro",
      key: i.pubkey,
      name: instanceName(newestOrder) ?? instanceName(i) ?? i.pubkey.slice(0, 8),
      status: maintenance ? "down" : fresh || own.length > 0 ? "up" : "down",
      inBook: own.length,
      version: tag(i, "mostro_version")?.[0] ?? null,
      makerFeePct: fee !== null ? fee * 100 : null,
      takerFeePct: null,
      bondPct: null,
      minSats: num(tag(i, "min_order_amount")?.[0]),
      maxSats: num(tag(i, "max_order_amount")?.[0]),
      volume24hBtc: null,
      lifetimeBtc: null,
      robotsToday: null,
      premium24h: null,
      notice: null,
      lastSeen: i.created_at,
      currencies,
      ...(MOSTRO_INSTANCES.has(i.pubkey) ? {} : { unlisted: true }),
    } satisfies VenueHost;
  });
}

const utcDay = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

/** Completed trades of listed instances per UTC day, last `days` days ending today, zero-filled. */
export function mostroDaily(trades: NostrEvent[], index: IndexPrices | null, nowSec: number, days = 7, authors: ReadonlySet<string> = MOSTRO_INSTANCES): DailyVolume[] {
  const bins = new Map<string, DailyVolume>();
  for (let i = days - 1; i >= 0; i--) {
    const date = utcDay(nowSec - i * DAY);
    bins.set(date, { date, btc: 0, trades: 0 });
  }
  for (const e of latestReplaceable(trades)) {
    if (!authors.has(e.pubkey) || tag(e, "y")?.[0] !== "mostro" || tag(e, "s")?.[0] !== "success" || tag(e, "network")?.[0] !== "mainnet") continue;
    const bin = bins.get(utcDay(e.created_at));
    if (!bin) continue;
    bin.trades += 1;
    const amt = num(tag(e, "amt")?.[0]);
    if (amt !== null && amt > 0) {
      bin.btc += amt / 1e8;
    } else {
      const fa = num(tag(e, "fa")?.[0]);
      const idx = indexFor((tag(e, "f")?.[0] ?? "").toUpperCase(), index);
      if (fa !== null && idx) bin.btc += fa / idx;
    }
  }
  return [...bins.values()];
}
