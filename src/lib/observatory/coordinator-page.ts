import type { Flow } from "./sky-model";
import type { FlowCoinjoin, FlowMap, VolumeHistory } from "./wabisator-types";

export interface CoordinatorKpis { volume: number; coinjoins: number; freshBtc: number; remixIn: number; remixOut: number; internalRemix: number; avgAnonset: number | null; allTimeVolume: number | null; ath: { date: string; volume: number } | null }
export type HistoryRange = "30d" | "90d" | "1y" | "all";

const RANGE_DAYS: Record<HistoryRange, number> = { "30d": 30, "90d": 90, "1y": 365, all: Infinity };

export function coordinatorKpis(key: string, flow: FlowMap, history: VolumeHistory | null): CoordinatorKpis {
  const c = flow.Coordinators.find((x) => x.Key === key);
  let w = 0, sum = 0;
  for (const cj of flow.Coinjoins) if (cj.Coordinator === key) { w += cj.Volume; sum += cj.Anonset * cj.Volume; }
  const h = history?.Coordinators[key];
  return {
    volume: c?.Volume ?? 0,
    coinjoins: c?.Coinjoins ?? 0,
    freshBtc: c?.FreshBtc ?? 0,
    remixIn: c?.RemixInBtc ?? 0,
    remixOut: c?.RemixOutBtc ?? 0,
    internalRemix: c?.InternalRemixBtc ?? 0,
    avgAnonset: w > 0 ? sum / w : null,
    allTimeVolume: h?.TotalVolume ?? null,
    ath: h?.Ath ? { date: h.Ath.Date, volume: h.Ath.Volume } : null,
  };
}

export function largestCoinjoins(key: string, flow: FlowMap, n = 10): FlowCoinjoin[] {
  return flow.Coinjoins.filter((c) => c.Coordinator === key).sort((a, b) => b.Volume - a.Volume).slice(0, n);
}

/** Cross-coordinator remix: `into` = coins arriving at `key`, `from` = coins leaving `key`. Internal remix excluded. BTC desc. */
export function remixPartners(key: string, flow: FlowMap): { into: Flow[]; from: Flow[] } {
  const flows = flow.Links.filter((l) => l.From !== l.To)
    .map((l) => ({ from: l.From, to: l.To, btc: l.Btc, coins: l.Coins, internal: false }))
    .sort((a, b) => b.btc - a.btc);
  return { into: flows.filter((f) => f.to === key), from: flows.filter((f) => f.from === key) };
}

/** Daily series for the last N days up to and including `today` (YYYY-MM-DD, UTC). */
export function volumeSeries(key: string, history: VolumeHistory, range: HistoryRange, today: string): { date: string; volume: number; coinjoins: number }[] {
  const days = RANGE_DAYS[range];
  const from = Number.isFinite(days) ? new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10) : "";
  return (history.Coordinators[key]?.Daily ?? [])
    .filter((d) => d.Date >= from && d.Date <= today)
    .map((d) => ({ date: d.Date, volume: d.Volume, coinjoins: d.Coinjoins }));
}
