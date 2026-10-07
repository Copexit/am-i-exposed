import type { HistoryRange } from "../coordinator-page";
import type { DailyVolume } from "./types";

/** Sum by date over the union of dates, sorted ascending. */
export function sumDaily(series: DailyVolume[][]): DailyVolume[] {
  const by = new Map<string, DailyVolume>();
  for (const s of series) {
    for (const d of s) {
      const cur = by.get(d.date) ?? { date: d.date, btc: 0, trades: 0 };
      cur.btc += d.btc;
      cur.trades += d.trades;
      by.set(d.date, cur);
    }
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const RANGE_DAYS: Record<HistoryRange, number> = { "30d": 30, "90d": 90, "1y": 365, all: Infinity };

/** Days in the range ending `today` (inclusive). */
export function rangeSlice(d: DailyVolume[], range: HistoryRange, today: string): DailyVolume[] {
  const days = RANGE_DAYS[range];
  const from = Number.isFinite(days) ? new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10) : "";
  return d.filter((x) => x.date >= from && x.date <= today);
}

export function athOf(d: DailyVolume[]): { date: string; volume: number } | null {
  let best: DailyVolume | null = null;
  for (const x of d) if (x.btc > 0 && (!best || x.btc > best.btc)) best = x;
  return best ? { date: best.date, volume: best.btc } : null;
}

/** Each coordinator's share of the range's volume, largest first. */
export function shares(per: Record<string, DailyVolume[]>, range: HistoryRange, today: string): { key: string; btc: number; pct: number }[] {
  const sums = Object.entries(per).map(([key, d]) => ({ key, btc: rangeSlice(d, range, today).reduce((s, x) => s + x.btc, 0) }));
  const total = sums.reduce((s, x) => s + x.btc, 0);
  return sums.map((x) => ({ ...x, pct: total > 0 ? (x.btc / total) * 100 : 0 })).sort((a, b) => b.btc - a.btc);
}
