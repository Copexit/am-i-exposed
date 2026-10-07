import type { Period } from "./wabisator-client";

export interface ObsState { tab: string; period: Period; coordinator: string | null; tx: string | null; view: "map" | "table" }

const DEFAULTS: ObsState = { tab: "wabisabi", period: 1, coordinator: null, tx: null, view: "map" };

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
  };
}

/** "#wabisabi&period=7&coordinator=kruw"; default values are omitted. */
export function serializeObsHash(s: ObsState): string {
  const parts = [s.tab];
  if (s.period !== DEFAULTS.period) parts.push(`period=${s.period}`);
  if (s.coordinator) parts.push(`coordinator=${encodeURIComponent(s.coordinator)}`);
  if (s.tx) parts.push(`tx=${s.tx}`);
  if (s.view !== DEFAULTS.view) parts.push(`view=${s.view}`);
  return `#${parts.join("&")}`;
}
