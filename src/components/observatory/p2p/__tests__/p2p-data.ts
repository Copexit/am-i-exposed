/** P2pData built from the recorded fixtures, for component tests. */
import { vi } from "vitest";
import { robosatsHost, robosatsIndex, robosatsOffers, ROBOSATS_COORDINATORS } from "@/lib/observatory/p2p/normalize-robosats";
import { mostroHosts, mostroOffers } from "@/lib/observatory/p2p/normalize-mostro";
import { hodlhodlHost, hodlhodlOffers } from "@/lib/observatory/p2p/normalize-hodlhodl";
import { buildMarkets } from "@/lib/observatory/p2p/market";
import type { P2pData, SourceStatus } from "@/hooks/useP2p";
import {
  NOW, robosatsOrders, mostroOrders, mostroInfo, templeInfo, lakeInfo, templeLimits, hodl0, hodl500,
} from "@/lib/observatory/p2p/__tests__/fixtures";

export { NOW };
export const index = robosatsIndex(templeLimits, "Temple of Sats (RoboSats)", NOW);
export const offers = [
  ...robosatsOffers(robosatsOrders.events, index, NOW),
  ...mostroOffers(mostroOrders.events, mostroInfo.events, index, NOW),
  ...hodlhodlOffers([hodl0, hodl500], index, NOW),
];
const infos: Record<string, typeof templeInfo> = { temple: templeInfo, lake: lakeInfo };
export const hosts = [
  ...ROBOSATS_COORDINATORS.map((c) => robosatsHost(c.key, infos[c.key] ?? null, offers.filter((o) => o.host === c.key).length, c.key in infos)),
  ...mostroHosts(mostroOrders.events, mostroInfo.events, NOW),
  hodlhodlHost(offers.filter((o) => o.venue === "hodlhodl"), true, [hodl0, hodl500]),
];

export const source = (id: SourceStatus["id"], state: SourceStatus["state"] = "ok", over: Partial<SourceStatus> = {}): SourceStatus =>
  ({ id, state, updatedAt: state === "ok" ? NOW * 1000 : null, detail: [], rejected: 0, refresh: vi.fn(), ...over });

export function p2pData(over: Partial<P2pData> = {}): P2pData {
  return {
    offers,
    hosts,
    index,
    markets: buildMarkets(offers, index),
    sources: [source("robosats"), source("mostro"), source("hodlhodl"), source("index")],
    nowSec: NOW,
    ...over,
  };
}

export const emptyData = (state: SourceStatus["state"]): P2pData => ({
  offers: [], hosts: [], index: null, markets: new Map(), nowSec: NOW,
  sources: [source("robosats", state), source("mostro", state), source("hodlhodl", state), source("index", state)],
});
