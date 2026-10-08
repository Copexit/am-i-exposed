import type { Period } from "./wabisator-client";
import { VENUES, type Venue } from "./p2p/types";
import { isPmId } from "./p2p/payment-methods";

export interface ObsState {
  tab: string;
  period: Period;
  coordinator: string | null;
  tx: string | null;
  view: "map" | "table";
  /** P2P market currency (3 to 5 uppercase letters) */
  cur: string | null;
  /** P2P visitor intent: "buy" lists sell offers */
  side: "buy" | "sell";
  /** P2P venue filter; default all three */
  venue: Venue[];
  /** P2P payment-method filter (canonical id); unknown ids are ignored */
  pm: string | null;
}

const DEFAULTS: ObsState = { tab: "wabisabi", period: 1, coordinator: null, tx: null, view: "map", cur: null, side: "buy", venue: [...VENUES], pm: null };

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Tolerant: unknown or malformed values fall back to defaults; never throws. */
export function parseObsHash(hash: string, knownTabs: readonly string[]): ObsState {
  const [tab = "", ...rest] = hash.replace(/^#/, "").split("&");
  const params = new Map(rest.map((p) => { const i = p.indexOf("="); return i < 0 ? [p, ""] : [p.slice(0, i), decode(p.slice(i + 1))]; }));
  const period = Number(params.get("period"));
  const tx = (params.get("tx") ?? "").toLowerCase();
  return {
    tab: knownTabs.includes(tab) ? tab : DEFAULTS.tab,
    period: period === 7 || period === 30 ? period : DEFAULTS.period,
    coordinator: params.get("coordinator") || null,
    tx: /^[0-9a-f]{64}$/.test(tx) ? tx : null,
    view: params.get("view") === "table" ? "table" : "map",
    cur: parseCur(params.get("cur")),
    side: params.get("side") === "sell" ? "sell" : "buy",
    venue: parseVenues(params.get("venue")),
    pm: isPmId(params.get("pm") ?? "") ? params.get("pm")! : null,
  };
}

function parseCur(v: string | undefined): string | null {
  const c = (v ?? "").toUpperCase();
  return /^[A-Z]{3,5}$/.test(c) ? c : null;
}

function parseVenues(v: string | undefined): Venue[] {
  const picked = new Set((v ?? "").split(","));
  const out = VENUES.filter((x) => picked.has(x));
  return out.length ? out : [...VENUES];
}

/** "#wabisabi&period=7&coordinator=kruw"; default values are omitted. */
export function serializeObsHash(input: Omit<ObsState, "cur" | "side" | "venue" | "pm"> & Partial<Pick<ObsState, "cur" | "side" | "venue" | "pm">>): string {
  const s: ObsState = { ...DEFAULTS, ...input };
  const parts = [s.tab];
  if (s.period !== DEFAULTS.period) parts.push(`period=${s.period}`);
  if (s.coordinator) parts.push(`coordinator=${encodeURIComponent(s.coordinator)}`);
  if (s.tx) parts.push(`tx=${s.tx}`);
  if (s.view !== DEFAULTS.view) parts.push(`view=${s.view}`);
  if (s.cur) parts.push(`cur=${s.cur}`);
  if (s.side !== DEFAULTS.side) parts.push(`side=${s.side}`);
  const venues = VENUES.filter((v) => s.venue.includes(v));
  if (venues.length && venues.length < VENUES.length) parts.push(`venue=${venues.join(",")}`);
  if (s.pm) parts.push(`pm=${s.pm}`);
  return `#${parts.join("&")}`;
}
