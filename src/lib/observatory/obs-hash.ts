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
  /** P2P amount filter: a positive number in the market currency or in BTC (amtu) */
  amt: number | null;
  amtu: "fiat" | "btc";
}

/** Sane bounds for a typed amount: one cent or one sat at least; no market lists an offer above the ceilings. */
export const AMT_MIN = { fiat: 0.01, btc: 1e-8 } as const;
export const AMT_MAX = { fiat: 1e12, btc: 21e6 } as const;

/** The amount when it is within AMT_MIN..AMT_MAX for its unit, else null. */
export const amtInRange = (n: number | null, unit: "fiat" | "btc"): number | null =>
  n !== null && n >= AMT_MIN[unit] - 1e-12 && n <= AMT_MAX[unit] ? n : null;

const DEFAULTS: ObsState = { tab: "wabisabi", period: 1, coordinator: null, tx: null, view: "map", cur: null, side: "buy", venue: [...VENUES], pm: null, amt: null, amtu: "fiat" };

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Tolerant: unknown or malformed values fall back to defaults; never throws. */
export function parseObsHash(hash: string, knownTabs: readonly string[]): ObsState {
  const [tab = "", ...rest] = hash.replace(/^#/, "").split("&");
  const params = new Map(rest.map((p) => { const i = p.indexOf("="); return i < 0 ? [p, ""] : [p.slice(0, i), decode(p.slice(i + 1))]; }));
  const period = Number(params.get("period"));
  const tx = (params.get("tx") ?? "").toLowerCase();
  const amtu = params.get("amtu") === "btc" ? "btc" : "fiat";
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
    amt: parseAmt(params.get("amt"), amtu),
    amtu,
  };
}

function parseCur(v: string | undefined): string | null {
  const c = (v ?? "").toUpperCase();
  return /^[A-Z]{3,5}$/.test(c) ? c : null;
}

/** Plain decimal only ("250", "0.0034"): no signs, exponents or separators. */
function parseAmt(v: string | undefined, unit: "fiat" | "btc"): number | null {
  if (!/^\d{1,13}(\.\d{1,8})?$/.test(v ?? "")) return null;
  return amtInRange(Number(v), unit);
}

function parseVenues(v: string | undefined): Venue[] {
  const picked = new Set((v ?? "").split(","));
  const out = VENUES.filter((x) => picked.has(x));
  return out.length ? out : [...VENUES];
}

type P2pKey = "cur" | "side" | "venue" | "pm" | "amt" | "amtu";

/** "#wabisabi&period=7&coordinator=kruw"; default values are omitted. */
export function serializeObsHash(input: Omit<ObsState, P2pKey> & Partial<Pick<ObsState, P2pKey>>): string {
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
  if (s.amt !== null) parts.push(`amt=${s.amt.toFixed(s.amtu === "btc" ? 8 : 2).replace(/\.?0+$/, "")}`, `amtu=${s.amtu}`);
  return `#${parts.join("&")}`;
}
