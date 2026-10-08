/**
 * P2P market sources, all through serviceGet (worker on the public site,
 * tor-proxy sidecar when self-hosted). Every route is aggregate; nothing
 * about the visitor is ever sent.
 */
import { serviceGet } from "@/lib/services/client";
import { getService, isReachable, SERVICES } from "@/lib/services/registry";
import { withObservatoryCache } from "../cache";
import { robosatsIndex } from "./normalize-robosats";
import type { HodlPage, IndexPrices, NostrSnapshot, RoboHistorical, RoboInfo, RoboLimits } from "./types";

export const P2P_REFRESH_MS = {
  orders: 30_000,
  info: 60_000,
  limits: 300_000,
  history: 3_600_000,
  mostroInfo: 300_000,
  trades: 600_000,
  hodlhodl: 60_000,
} as const;

type Opts = { isUmbrel: boolean; signal?: AbortSignal };

// The cache entry is written after the fetch: TTL slightly under the interval so each poll refetches.
const cached = <T>(key: string, interval: number, o: Opts, fn: () => Promise<T>) =>
  withObservatoryCache(`p2p:${key}:${o.isUmbrel}`, fn, Math.max(1000, interval - 1000));

const NOSTR_INTERVAL: Record<string, number> = {
  "/orders": P2P_REFRESH_MS.orders,
  "/info": P2P_REFRESH_MS.mostroInfo,
  "/trades": P2P_REFRESH_MS.trades,
};

export function getNostr(serviceId: "robosats-nostr" | "mostro-nostr", path: "/orders" | "/info" | "/trades", o: Opts): Promise<NostrSnapshot> {
  return cached(`${serviceId}${path}`, NOSTR_INTERVAL[path]!, o, () => serviceGet<NostrSnapshot>(serviceId, path, o));
}

/** RoboSats coordinator service ids the current hop can reach, in registry order (temple, lake first). */
export function reachableRobosats(isUmbrel: boolean): string[] {
  return SERVICES.filter((s) => s.p2p?.venue === "robosats" && s.p2p.pubkey && isReachable(s, isUmbrel)).map((s) => s.id);
}

function assertReachable(serviceId: string, isUmbrel: boolean) {
  const s = getService(serviceId);
  // Never ask the worker for an onion-only coordinator.
  if (!s || !isReachable(s, isUmbrel)) throw new Error("Service not reachable");
}

export async function getRoboInfo(serviceId: string, o: Opts): Promise<RoboInfo> {
  assertReachable(serviceId, o.isUmbrel);
  return cached(`${serviceId}:info`, P2P_REFRESH_MS.info, o, () => serviceGet<RoboInfo>(serviceId, "/api/info/", o));
}

export async function getRoboHistorical(serviceId: string, o: Opts): Promise<RoboHistorical> {
  assertReachable(serviceId, o.isUmbrel);
  return cached(`${serviceId}:historical`, P2P_REFRESH_MS.history, o, () => serviceGet<RoboHistorical>(serviceId, "/api/historical/", o));
}

/** Index from the first reachable coordinator that answers: temple, then lake, then (self-hosted) the rest. */
export function getRoboLimits(o: Opts): Promise<IndexPrices> {
  return cached("limits", P2P_REFRESH_MS.limits, o, async () => {
    let last: unknown = new Error("No reachable coordinator");
    for (const id of reachableRobosats(o.isUmbrel)) {
      try {
        const limits = await serviceGet<RoboLimits>(id, "/api/limits/", o);
        return robosatsIndex(limits, getService(id)!.name, Math.floor(Date.now() / 1000));
      } catch (e) {
        if (o.signal?.aborted) throw e;
        last = e;
      }
    }
    throw last;
  });
}

const HODL_PAGE = 100;
const HODL_MAX_PAGES = 10;

/** Offsets 0, 100, ... two at a time, until a short page; at most 10 pages. */
export function getHodlhodl(o: Opts): Promise<HodlPage[]> {
  return cached("hodlhodl", P2P_REFRESH_MS.hodlhodl, o, async () => {
    const pages: HodlPage[] = [];
    for (let i = 0; i < HODL_MAX_PAGES; i += 2) {
      const offsets = [i, i + 1].filter((n) => n < HODL_MAX_PAGES).map((n) => n * HODL_PAGE);
      const batch = await Promise.all(offsets.map((offset) =>
        serviceGet<HodlPage>("hodlhodl", "/api/v1/offers", { ...o, query: { "pagination[offset]": offset } })));
      for (const p of batch) {
        pages.push(p);
        if ((p.offers?.length ?? 0) < HODL_PAGE) return pages;
      }
    }
    return pages;
  });
}
