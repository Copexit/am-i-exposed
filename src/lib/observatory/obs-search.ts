import type { Scene, SkyEvent } from "./sky-model";
import type { Period } from "./wabisator-client";

export type SearchQuery = { kind: "txid"; txid: string } | { kind: "date"; t: number } | { kind: "invalid" };
export type SearchResult = { kind: "found"; event: SkyEvent } | { kind: "not-found"; txid: string } | { kind: "in-period"; t: number } | { kind: "out-of-period"; t: number; suggested: Period | null } | { kind: "invalid" };

const PERIODS: Period[] = [1, 7, 30];

/** A 64-hex txid, or a UTC date "YYYY-MM-DD" / "YYYY-MM-DD HH:MM". Pure: nothing is sent anywhere. */
export function parseSearch(input: string): SearchQuery {
  const s = input.trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return { kind: "txid", txid: s.toLowerCase() };
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(s);
  if (!m) return { kind: "invalid" };
  const [y, mo, d, h, mi] = [1, 2, 3, 4, 5].map((i) => Number(m[i] ?? 0)) as [number, number, number, number, number];
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const dt = new Date(ms);
  // Reject rollovers like 2026-02-30 or 25:00.
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || h > 23 || mi > 59) return { kind: "invalid" };
  return { kind: "date", t: ms / 1000 };
}

export function resolveSearch(q: SearchQuery, scene: Scene, nowSec: number): SearchResult {
  if (q.kind === "invalid") return q;
  if (q.kind === "txid") {
    const event = scene.events.find((e) => e.txid === q.txid);
    return event ? { kind: "found", event } : { kind: "not-found", txid: q.txid };
  }
  if (q.t >= scene.since && q.t <= scene.until) return { kind: "in-period", t: q.t };
  const suggested = q.t <= nowSec ? PERIODS.find((p) => q.t >= nowSec - p * 86400) ?? null : null;
  return { kind: "out-of-period", t: q.t, suggested };
}
