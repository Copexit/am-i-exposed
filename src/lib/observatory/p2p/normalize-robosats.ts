import { SERVICES } from "@/lib/services/registry";
import { tag } from "./nostr-verify";
import { currencyCode, fiatRange, num, pricing, toLayer } from "./normalize-common";
import { sanitizeMethods, sanitizeNotice } from "./sanitize";
import type { DailyVolume, IndexPrices, NostrEvent, P2pOffer, RoboHistorical, RoboInfo, RoboLimits, VenueHost } from "./types";

export const ROBOSATS_COORDINATORS: { key: string; name: string; pubkey: string; serviceId: string; onion: string | null }[] =
  SERVICES.filter((s) => s.p2p?.venue === "robosats" && s.p2p.pubkey).map((s) => ({
    key: s.p2p!.key,
    name: s.name.replace(/\s*\(RoboSats\)$/, ""),
    pubkey: s.p2p!.pubkey!,
    serviceId: s.id,
    onion: s.onion ?? null,
  }));

const BY_PUBKEY = new Map(ROBOSATS_COORDINATORS.map((c) => [c.pubkey, c]));

export function robosatsOffers(events: NostrEvent[], index: IndexPrices | null, nowSec: number): P2pOffer[] {
  const out: P2pOffer[] = [];
  for (const e of events) {
    const coord = BY_PUBKEY.get(e.pubkey);
    if (!coord || tag(e, "y")?.[0] !== "robosats" || tag(e, "network")?.[0] !== "mainnet" || tag(e, "s")?.[0] !== "pending") continue;
    const expiresAt = num(tag(e, "expiration")?.[0]);
    if (expiresAt !== null && expiresAt <= nowSec) continue;
    const side = tag(e, "k")?.[0];
    const d = tag(e, "d")?.[0];
    if ((side !== "buy" && side !== "sell") || !d) continue;
    const currency = currencyCode(tag(e, "f")?.[0]);
    if (!currency) continue;
    const { fiatMin, fiatMax } = fiatRange(tag(e, "fa"));
    const { price, premium, satsMax } = pricing(currency, num(tag(e, "premium")?.[0]), fiatMin, fiatMax, num(tag(e, "amt")?.[0]), index);
    const source = tag(e, "source")?.[0] ?? "";
    out.push({
      id: `robosats:${coord.key}:${d}`,
      venue: "robosats",
      host: coord.key,
      side,
      currency,
      fiatMin,
      fiatMax,
      satsMax,
      premium,
      price,
      // RoboSats splits labels on spaces: join them back before sanitizing.
      methods: sanitizeMethods([(tag(e, "pm") ?? []).join(" ")]),
      layer: toLayer(tag(e, "layer")?.[0]),
      bondPct: num(tag(e, "bond")?.[0]),
      createdAt: e.created_at,
      expiresAt,
      link: coord.onion && /^http:\/\/[a-z2-7]{56}\.onion\//.test(source) && source.startsWith(`${coord.onion}/`) ? source : null,
    });
  }
  return out;
}

export function robosatsHost(key: string, info: RoboInfo | null, inBook: number, reachable: boolean): VenueHost {
  const name = ROBOSATS_COORDINATORS.find((c) => c.key === key)?.name ?? key;
  const sev = (info?.notice_severity ?? "").toLowerCase();
  return {
    venue: "robosats",
    key,
    name,
    status: !reachable ? "unknown" : info ? "up" : "down",
    inBook,
    version: info ? `${info.version.major}.${info.version.minor}.${info.version.patch}` : null,
    makerFeePct: info ? info.maker_fee * 100 : null,
    takerFeePct: info ? info.taker_fee * 100 : null,
    bondPct: info?.bond_size ?? null,
    minSats: info?.min_order_size ?? null,
    maxSats: info?.max_order_size ?? null,
    volume24hBtc: info?.last_day_volume ?? null,
    lifetimeBtc: info?.lifetime_volume ?? null,
    robotsToday: info?.active_robots_today ?? null,
    premium24h: info?.last_day_nonkyc_btc_premium ?? null,
    notice: info && sev && sev !== "none" ? sanitizeNotice(info.notice_message) : null,
    noticeWarn: ["warning", "error", "critical"].includes(sev),
    lastSeen: null,
  };
}

/** Sorted by date asc, date = first 10 chars of the key. */
export function robosatsHistory(h: RoboHistorical): DailyVolume[] {
  return Object.entries(h)
    .map(([k, v]) => ({ date: k.slice(0, 10), btc: v.volume, trades: v.num_contracts }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function robosatsIndex(l: RoboLimits, source: string, at: number): IndexPrices {
  const prices: Record<string, number> = {};
  for (const v of Object.values(l)) if (v.code && v.price > 0) prices[v.code.toUpperCase()] = v.price;
  return { source, prices, at };
}
