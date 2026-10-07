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
