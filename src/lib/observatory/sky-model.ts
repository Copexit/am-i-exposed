import { coordinatorColorToken } from "./coordinator-palette";
import type { Period } from "./wabisator-client";
import type { CoordinatorsStatus, FlowMap } from "./wabisator-types";

export interface Star { key: string; name: string; x: number; y: number; r: number; colorToken: string; volume: number; coinjoins: number; online: boolean }
export interface SkyEvent { txid: string; t: number; star: string; volume: number; inputs: number; outputs: number; anonset: number; feeRate: number; freshBtc: number; remixes: { from: string; btc: number; coins: number }[] }
export interface Bin { t0: number; t1: number; volume: number; count: number }
export interface Flow { from: string; to: string; btc: number; coins: number; internal: boolean }
export interface Scene { since: number; until: number; stars: Star[]; events: SkyEvent[]; bins: Bin[]; flows: Flow[]; totals: FlowMap["Totals"]; empty: boolean }

export const REPLAY_SECONDS: Record<Period, number> = { 1: 60, 7: 90, 30: 120 };

const MIN_DIST = 0.18;
const LO = 0.08;
const HI = 0.92;
/** Star radius bounds, in unit space (fraction of the canvas' shorter side). */
const R_MIN = 0.012;
const R_MAX = 0.06;

/** FNV-1a 32-bit, mapped to [0, 1). */
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0) / 2 ** 32;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Stable positions in unit space: a seed position hashed from the key, then a deterministic
 * pairwise relaxation until no two centers are closer than MIN_DIST. Volume is deliberately ignored
 * so a coordinator keeps its place when the period (and so its volume) changes.
 * ponytail: O(n^2) per iteration, fine for the ~10 coordinators that exist.
 */
export function layoutStars(keys: string[], _volumes: Record<string, number>): Record<string, { x: number; y: number }> {
  const ks = [...new Set(keys)].sort();
  const pts = ks.map((k) => ({ k, x: LO + hash01(`${k}:x`) * (HI - LO), y: LO + hash01(`${k}:y`) * (HI - LO)}));
  for (let iter = 0; iter < 300; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!, b = pts[j]!;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        if (dist >= MIN_DIST) continue;
        const ang = dist > 1e-9 ? Math.atan2(b.y - a.y, b.x - a.x) : hash01(`${a.k}|${b.k}`) * 2 * Math.PI;
        const ux = Math.cos(ang), uy = Math.sin(ang);
        // Overshoot slightly so clamping at the edges still converges.
        const push = (MIN_DIST - dist) * 1.05 + 1e-4;
        a.x = clamp(a.x - ux * push / 2, LO, HI);
        a.y = clamp(a.y - uy * push / 2, LO, HI);
        b.x = clamp(b.x + ux * push / 2, LO, HI);
        b.y = clamp(b.y + uy * push / 2, LO, HI);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return Object.fromEntries(pts.map((p) => [p.k, { x: p.x, y: p.y }]));
}

const toSec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** Precomputes everything the sky draws. O(coinjoins + coordinators). */
export function buildScene(flow: FlowMap, status: CoordinatorsStatus | null, binCount = 96): Scene {
  const since = toSec(flow.Since);
  const until = toSec(flow.Until);
  const statusBy = new Map((status?.Coordinators ?? []).map((c) => [c.Key, c]));
  const flowBy = new Map(flow.Coordinators.map((c) => [c.Key, c]));
  const keys = [...new Set([...flowBy.keys(), ...statusBy.keys()])];

  const volumes: Record<string, number> = Object.fromEntries(keys.map((k) => [k, flowBy.get(k)?.Volume ?? 0]));
  const maxVol = Math.max(0, ...Object.values(volumes));
  const pos = layoutStars(keys, volumes);
  const stars: Star[] = keys.map((key) => {
    const f = flowBy.get(key);
    const s = statusBy.get(key);
    const volume = volumes[key] ?? 0;
    const p = pos[key] ?? { x: 0.5, y: 0.5 };
    return {
      key,
      name: f?.Name ?? s?.Name ?? key,
      x: p.x,
      y: p.y,
      r: R_MIN + (R_MAX - R_MIN) * (maxVol > 0 ? Math.sqrt(volume / maxVol) : 0),
      colorToken: coordinatorColorToken(key),
      volume,
      coinjoins: f?.Coinjoins ?? 0,
      online: (s?.Status ?? f?.Status) === "Online",
    };
  });

  const events: SkyEvent[] = flow.Coinjoins.map((c) => ({
    txid: c.TxId, t: c.Time, star: c.Coordinator, volume: c.Volume, inputs: c.Inputs, outputs: c.Outputs,
    anonset: c.Anonset, feeRate: c.FeeRate, freshBtc: c.FreshBtc,
    remixes: c.Remixes.map((r) => ({ from: r.From, btc: r.Btc, coins: r.Coins })),
  })).sort((a, b) => a.t - b.t);

  const span = Math.max(1, until - since);
  const bins: Bin[] = Array.from({ length: binCount }, (_, i) => ({ t0: since + (span * i) / binCount, t1: since + (span * (i + 1)) / binCount, volume: 0, count: 0 }));
  for (const e of events) {
    const b = bins[clamp(Math.floor(((e.t - since) / span) * binCount), 0, binCount - 1)]!;
    b.volume += e.volume;
    b.count++;
  }

  const flows: Flow[] = flow.Links.map((l) => ({ from: l.From, to: l.To, btc: l.Btc, coins: l.Coins, internal: l.From === l.To }));
  return { since, until, stars, events, bins, flows, totals: flow.Totals, empty: events.length === 0 };
}

/** Max particles alive on screen at once, enforced by the renderer. */
export const MAX_LIVE_PARTICLES = { desktop: 2200, mobile: 900 } as const;

/**
 * Particles to spawn per CoinJoin over the replay (txid -> count). Each event wants
 * max(1, round(6 * ln(1 + BTC))). If the wants exceed `cap`, the total is exactly `cap`:
 * with more events than cap, the `cap` largest get 1 each; otherwise every event gets 1 and the
 * rest is split by largest remainder over the extra wants. Bigger events never get fewer.
 */
export function particleBudget(events: SkyEvent[], cap: number): Map<string, number> {
  const want = events.map((e) => Math.max(1, Math.round(6 * Math.log1p(Math.max(0, e.volume)))));
  const total = want.reduce((s, n) => s + n, 0);
  if (total <= cap) return new Map(events.map((e, i) => [e.txid, want[i]!]));
  const budget = Math.max(0, Math.floor(cap));
  // Largest first; ties by txid so the result does not depend on input order.
  const order = events.map((_, i) => i).sort((i, j) => events[j]!.volume - events[i]!.volume || (events[i]!.txid < events[j]!.txid ? -1 : 1));
  const alloc = new Array<number>(events.length).fill(0);
  if (events.length >= budget) {
    for (const i of order.slice(0, budget)) alloc[i] = 1;
  } else {
    const extra = want.map((w) => w - 1);
    const extraTotal = extra.reduce((s, n) => s + n, 0);
    const spare = budget - events.length; // < extraTotal, because total > cap
    const exact = extra.map((x) => (spare * x) / extraTotal);
    let left = spare;
    exact.forEach((x, i) => { alloc[i] = 1 + Math.floor(x); left -= Math.floor(x); });
    // Hand out the remainder by fractional part; `order` breaks ties toward bigger events.
    const byFrac = [...order].sort((i, j) => (exact[j]! % 1) - (exact[i]! % 1));
    for (const i of byFrac.slice(0, left)) alloc[i]! += 1;
  }
  return new Map(events.map((e, i) => [e.txid, alloc[i]!]));
}

export function replayTime(progress: number, scene: Scene): number {
  return scene.since + clamp(progress, 0, 1) * (scene.until - scene.since);
}

export function replayProgress(t: number, scene: Scene): number {
  const span = scene.until - scene.since;
  return span > 0 ? clamp((t - scene.since) / span, 0, 1) : 1;
}
