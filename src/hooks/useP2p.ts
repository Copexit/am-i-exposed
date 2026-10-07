"use client";

import { useEffect, useMemo, useState } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { getService } from "@/lib/services/registry";
import { usePolled, type Polled } from "./usePolled";
import {
  getHodlhodl, getNostr, getRoboHistorical, getRoboInfo, getRoboLimits, P2P_REFRESH_MS, reachableRobosats,
} from "@/lib/observatory/p2p/p2p-client";
import { verifySnapshot } from "@/lib/observatory/p2p/nostr-verify";
import { ROBOSATS_COORDINATORS, robosatsHistory, robosatsHost, robosatsOffers } from "@/lib/observatory/p2p/normalize-robosats";
import { mostroDaily, mostroHosts, mostroOffers } from "@/lib/observatory/p2p/normalize-mostro";
import { hodlhodlHost, hodlhodlOffers } from "@/lib/observatory/p2p/normalize-hodlhodl";
import { buildMarkets } from "@/lib/observatory/p2p/market";
import { sumDaily } from "@/lib/observatory/p2p/volume";
import type { DailyVolume, HodlPage, IndexPrices, Market, NostrEvent, NostrSnapshot, P2pOffer, RoboInfo, VenueHost } from "@/lib/observatory/p2p/types";

export type SourceId = "robosats" | "mostro" | "hodlhodl" | "index";
export type SourceState = "ok" | "partial" | "stale" | "down" | "loading";
export interface SourceStatus {
  id: SourceId;
  state: SourceState;
  updatedAt: number | null;
  /** Relay URLs that timed out or failed, coordinators that are down. */
  detail: string[];
  /** Events dropped by signature verification in the latest snapshot. */
  rejected: number;
  refresh: () => void;
}
export interface P2pData {
  offers: P2pOffer[];
  hosts: VenueHost[];
  index: IndexPrices | null;
  markets: Map<string, Market>;
  sources: SourceStatus[];
  nowSec: number;
}

interface Verified { events: NostrEvent[]; rejected: number; relays: NostrSnapshot["relays"]; fetchedAt: number }

const verified = (p: Promise<NostrSnapshot>): Promise<Verified> =>
  p.then((s) => ({ ...verifySnapshot(s), relays: s.relays ?? [], fetchedAt: s.fetchedAt }));

const relayDetail = (v: Verified | null) => (v?.relays ?? []).filter((r) => r.status !== "eose").map((r) => r.url);
const tooManyRejected = (v: Verified | null) => !!v && v.rejected > 0 && v.rejected / (v.events.length + v.rejected) > 0.1;

/** loading / down without data; stale once the last success is 3 intervals old and the latest fetch failed. */
function baseState(p: Polled<unknown>, interval: number, now: number): SourceState | null {
  if (p.data === null) return p.loading || !p.error ? "loading" : "down";
  if (p.error && p.updatedAt !== null && now - p.updatedAt > 3 * interval) return "stale";
  return null;
}

/** Live P2P markets: verified Nostr snapshots, REST info, index and HodlHodl, composed into markets and source health. */
export function useP2p(): P2pData {
  const { isUmbrel, routeReady } = useNetwork();
  const k = (name: string) => (routeReady ? `p2p:${name}:${isUmbrel}` : null);
  const opts = (signal: AbortSignal) => ({ isUmbrel, signal });

  const rsOrders = usePolled(k("rs-orders"), (s) => verified(getNostr("robosats-nostr", "/orders", opts(s))), P2P_REFRESH_MS.orders);
  const rsInfo = usePolled(k("rs-info"), async (s) => {
    const ids = reachableRobosats(isUmbrel);
    const res = await Promise.allSettled(ids.map((id) => getRoboInfo(id, opts(s))));
    return Object.fromEntries(ids.map((id, i) => {
      const r = res[i]!;
      return [id, r.status === "fulfilled" ? r.value : null];
    })) as Record<string, RoboInfo | null>;
  }, P2P_REFRESH_MS.info);
  const limits = usePolled(k("limits"), (s) => getRoboLimits(opts(s)), P2P_REFRESH_MS.limits);
  const moOrders = usePolled(k("mo-orders"), (s) => verified(getNostr("mostro-nostr", "/orders", opts(s))), P2P_REFRESH_MS.orders);
  const moInfo = usePolled(k("mo-info"), (s) => verified(getNostr("mostro-nostr", "/info", opts(s))), P2P_REFRESH_MS.mostroInfo);
  const hodl = usePolled(k("hodlhodl"), async (s) => ({ pages: await getHodlhodl(opts(s)), at: Math.floor(Date.now() / 1000) }), P2P_REFRESH_MS.hodlhodl);

  // Visitor clock for expiry and staleness, ticking every 15 s.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const nowSec = Math.floor(now / 1000);
    const index = limits.data;
    const live = (o: P2pOffer) => o.expiresAt === null || o.expiresAt > nowSec;

    const rs = rsOrders.data ? robosatsOffers(rsOrders.data.events, index, rsOrders.data.fetchedAt).filter(live) : [];
    const mo = moOrders.data && moInfo.data
      ? mostroOffers(moOrders.data.events, moInfo.data.events, index, moOrders.data.fetchedAt).filter(live)
      : [];
    const hh = hodl.data ? hodlhodlOffers(hodl.data.pages as HodlPage[], index, hodl.data.at) : [];
    const offers = [...rs, ...mo, ...hh];

    const reachable = new Set(reachableRobosats(isUmbrel));
    const infoMap = rsInfo.data ?? {};
    const rsHosts = ROBOSATS_COORDINATORS.map((c) => {
      const inBook = rs.filter((o) => o.host === c.key).length;
      const h = robosatsHost(c.key, infoMap[c.serviceId] ?? null, inBook, reachable.has(c.serviceId));
      // Before the first info answer a reachable coordinator is not "down" yet.
      return rsInfo.data === null && h.status === "down" ? { ...h, status: "unknown" as const } : h;
    });
    const moHosts = moOrders.data && moInfo.data ? mostroHosts(moOrders.data.events, moInfo.data.events, moOrders.data.fetchedAt) : [];
    const hosts: VenueHost[] = [...rsHosts, ...moHosts, ...(hodl.data || hodl.error ? [hodlhodlHost(hh, hodl.data !== null && !hodl.error, hodl.data?.pages ?? [])] : [])];

    const rsDown = rsInfo.data ? rsHosts.filter((h) => h.status === "down").map((h) => h.name) : [];
    const rsBase = baseState(rsOrders, P2P_REFRESH_MS.orders, now);
    const rsDetail = [...relayDetail(rsOrders.data), ...rsDown];
    const moBase = moOrders.data && moInfo.data
      ? baseState(moOrders, P2P_REFRESH_MS.orders, now)
      : moOrders.loading || moInfo.loading ? "loading" : "down";
    const moDetail = [...new Set([...relayDetail(moOrders.data), ...relayDetail(moInfo.data)])];

    const sources: SourceStatus[] = [
      {
        id: "robosats",
        state: rsBase ?? (rsDetail.length || tooManyRejected(rsOrders.data) ? "partial" : "ok"),
        updatedAt: rsOrders.updatedAt,
        detail: rsDetail,
        rejected: rsOrders.data?.rejected ?? 0,
        refresh: () => { rsOrders.refresh(); rsInfo.refresh(); },
      },
      {
        id: "mostro",
        state: moBase ?? (moDetail.length || tooManyRejected(moOrders.data) || tooManyRejected(moInfo.data) ? "partial" : "ok"),
        updatedAt: moOrders.updatedAt,
        detail: moDetail,
        rejected: (moOrders.data?.rejected ?? 0) + (moInfo.data?.rejected ?? 0),
        refresh: () => { moOrders.refresh(); moInfo.refresh(); },
      },
      {
        id: "hodlhodl",
        state: baseState(hodl, P2P_REFRESH_MS.hodlhodl, now) ?? "ok",
        updatedAt: hodl.updatedAt,
        detail: [],
        rejected: 0,
        refresh: hodl.refresh,
      },
      {
        id: "index",
        state: baseState(limits, P2P_REFRESH_MS.limits, now) ?? "ok",
        updatedAt: limits.updatedAt,
        detail: index ? [index.source] : [],
        rejected: 0,
        refresh: limits.refresh,
      },
    ];

    return { offers, hosts, index, markets: buildMarkets(offers, index), sources, nowSec };
    // Polled objects change identity every render; depend on their data and status fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    now, isUmbrel,
    rsOrders.data, rsOrders.error, rsOrders.loading, rsOrders.updatedAt,
    rsInfo.data,
    limits.data, limits.error, limits.loading, limits.updatedAt,
    moOrders.data, moOrders.error, moOrders.loading, moOrders.updatedAt,
    moInfo.data, moInfo.error, moInfo.loading,
    hodl.data, hodl.error, hodl.loading, hodl.updatedAt,
  ]);
}

export interface P2pHistory {
  robosats: DailyVolume[];
  perCoordinator: Record<string, DailyVolume[]>;
  mostro: DailyVolume[];
  /** RoboSats coordinators whose history loaded */
  coordinators: number;
  loading: boolean;
}

/** RoboSats daily volume (reachable coordinators) and Mostro completed trades; starts once enabled turns true. */
export function useP2pHistory(enabled: boolean): P2pHistory {
  const { isUmbrel, routeReady } = useNetwork();
  const [started, setStarted] = useState(enabled);
  if (enabled && !started) setStarted(true);
  const on = started && routeReady;

  const hist = usePolled(on ? `p2p:hist:${isUmbrel}` : null, async (signal) => {
    const ids = reachableRobosats(isUmbrel);
    const res = await Promise.allSettled(ids.map((id) => getRoboHistorical(id, { isUmbrel, signal })));
    const per: Record<string, DailyVolume[]> = {};
    ids.forEach((id, i) => {
      const r = res[i]!;
      const key = getService(id)?.p2p?.key ?? id;
      if (r.status === "fulfilled") per[key] = robosatsHistory(r.value);
    });
    return per;
  }, P2P_REFRESH_MS.history);

  const trades = usePolled(on ? `p2p:trades:${isUmbrel}` : null, async (signal) => {
    const [snap, index] = await Promise.all([
      verified(getNostr("mostro-nostr", "/trades", { isUmbrel, signal })),
      getRoboLimits({ isUmbrel, signal }).catch(() => null),
    ]);
    return mostroDaily(snap.events, index, snap.fetchedAt);
  }, P2P_REFRESH_MS.trades);

  return useMemo(() => {
    const per = hist.data ?? {};
    return {
      robosats: sumDaily(Object.values(per)),
      perCoordinator: per,
      mostro: trades.data ?? [],
      coordinators: Object.keys(per).length,
      loading: !on || hist.loading || trades.loading,
    };
  }, [hist.data, hist.loading, trades.data, trades.loading, on]);
}
