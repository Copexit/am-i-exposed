/**
 * The sky map's drawing, over a plain CanvasRenderingContext2D. No React: SkyMap.tsx owns sizing,
 * the clock and the loop, and hands this module a layout (pixel positions, labels) plus a mutable
 * SkyDynamics object (particles, pulses, replay cursor) that `step` advances once per frame.
 */
import { coordinatorColorToken } from "@/lib/observatory/coordinator-palette";
import { hash01, particleBudget, type Scene, type SkyEvent } from "@/lib/observatory/sky-model";

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface SkyView { w: number; h: number; inset: { top: number; right: number; bottom: number; left: number }; mobile: boolean }
export interface SkyFonts { sans: string; mono: string }

// ---------- colour ----------

/** Normalizes a computed CSS colour to `#rrggbb`, or returns the fallback (canvas cannot read CSS variables). */
export function resolveColor(raw: string | null | undefined, fallback: string): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return fallback;
}

export interface SkyPalette { sky: string; fg: string; edge: string; tone: (token: string) => string }

/**
 * Resolves the sky tokens once per theme. Each falls back to a broader token (the sky to the page
 * background, its foreground to the page foreground, the vignette edge to the sky); unknown or
 * missing star tokens use --coord-other, then the sky foreground.
 */
export function resolvePalette(read: (name: string) => string, tokens: string[]): SkyPalette {
  const sky = resolveColor(read("--obs-sky"), resolveColor(read("--background"), ""));
  const fg = resolveColor(read("--obs-sky-fg"), resolveColor(read("--foreground"), ""));
  const edge = resolveColor(read("--obs-sky-edge"), sky);
  const other = resolveColor(read("--coord-other"), fg);
  const map = new Map(tokens.map((t) => [t, resolveColor(read(t), other)]));
  return { sky, fg, edge, tone: (t) => map.get(t) ?? other };
}

/** `#rrggbb` plus alpha as rgba(). */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

// ---------- geometry ----------

/** A point just outside the nearest canvas edge, slid along it by `u` in [0, 1) (0.5 = straight across). */
export function edgeEntry(x: number, y: number, w: number, h: number, u: number): { x: number; y: number } {
  const OUT = 8;
  const d = [x, w - x, y, h - y];
  const side = d.indexOf(Math.min(...d));
  const along = (pos: number, len: number) => Math.max(0, Math.min(len, pos + (u - 0.5) * 0.5 * len));
  if (side === 0) return { x: -OUT, y: along(y, h) };
  if (side === 1) return { x: w + OUT, y: along(y, h) };
  if (side === 2) return { x: along(x, w), y: -OUT };
  return { x: along(x, w), y: h + OUT };
}

/** Quadratic control point: the chord's midpoint pushed left of the direction of travel by `bend` x length. */
export function curveControl(ax: number, ay: number, bx: number, by: number, bend: number): { x: number; y: number } {
  return { x: (ax + bx) / 2 - (by - ay) * bend, y: (ay + by) / 2 + (bx - ax) * bend };
}

export function quadPoint(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, t: number): { x: number; y: number } {
  const u = 1 - t;
  return { x: u * u * ax + 2 * u * t * cx + t * t * bx, y: u * u * ay + 2 * u * t * cy + t * t * by };
}

// ---------- labels ----------

export interface LabelItem { key: string; x: number; y: number; r: number; name: string; vol: string; nameW: number; volW: number; weight: number }
export type LabelSide = "below" | "above" | "right" | "left";
export interface LabelBox { key: string; x: number; y: number; w: number; h: number; side: LabelSide; showVolume: boolean; name: string; vol: string }
/** pad: from a star's clear radius to its label; sep / sepX: min vertical / horizontal gap between two labels (side by side they need more, or they read as one line). */
export interface LabelMetrics { nameH: number; volH: number; gap: number; pad: number; sep: number; sepX: number }

const SIDES: LabelSide[] = ["below", "above", "right", "left"];

/** Room a star needs around it: its glow core, the hover/selection orbit and the highlight ring. */
export const clearRadius = (r: number) => Math.max(r + 14, Math.min(r * 2.2, r + 28));

function candidate(it: LabelItem, side: LabelSide, withVol: boolean, m: LabelMetrics): LabelBox {
  const w = withVol ? Math.max(it.nameW, it.volW) : it.nameW;
  const h = withVol ? m.nameH + m.gap + m.volH : m.nameH;
  const off = clearRadius(it.r) + m.pad;
  const pos = side === "below" ? { x: it.x - w / 2, y: it.y + off }
    : side === "above" ? { x: it.x - w / 2, y: it.y - off - h }
    : side === "right" ? { x: it.x + off, y: it.y - h / 2 }
    : { x: it.x - off - w, y: it.y - h / 2 };
  return { key: it.key, ...pos, w, h, side, showVolume: withVol, name: it.name, vol: it.vol };
}

const area = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Collision-avoided label placement. Heaviest stars choose first; each tries below, above, right,
 * left with the volume line, then the same with the name alone. A label must stay in `bounds` and
 * clear every star disc and every label already placed. If nothing fits, the name-only spot with
 * the least overlap is clamped into bounds.
 */
export function placeLabels(items: LabelItem[], bounds: Rect, m: LabelMetrics): LabelBox[] {
  const order = [...items].sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : 1));
  const discs = items.map((s) => {
    // Keep a label clear of other stars' rings, but allow it under their outer glow.
    const c = clearRadius(s.r) - 2;
    return { x: s.x - c, y: s.y - c, w: 2 * c, h: 2 * c };
  });
  const placed: LabelBox[] = [];
  const cost = (b: LabelBox) => {
    const pad = { x: b.x - m.sepX, y: b.y - m.sep, w: b.w + 2 * m.sepX, h: b.h + 2 * m.sep };
    return placed.reduce((s, p) => s + area(pad, p), 0) + discs.reduce((s, d) => s + area(b, d), 0);
  };
  const inside = (b: LabelBox) => b.x >= bounds.x0 && b.y >= bounds.y0 && b.x + b.w <= bounds.x1 && b.y + b.h <= bounds.y1;
  for (const it of order) {
    let pick: LabelBox | undefined;
    for (const withVol of [true, false]) {
      pick = SIDES.map((s) => candidate(it, s, withVol, m)).find((b) => inside(b) && cost(b) === 0);
      if (pick) break;
    }
    if (!pick) {
      const clamp = (b: LabelBox): LabelBox => ({
        ...b,
        x: Math.max(bounds.x0, Math.min(bounds.x1 - b.w, b.x)),
        y: Math.max(bounds.y0, Math.min(bounds.y1 - b.h, b.y)),
      });
      pick = SIDES.map((s) => clamp(candidate(it, s, false, m))).sort((a, b) => cost(a) - cost(b))[0]!;
    }
    placed.push(pick);
  }
  return items.map((it) => placed.find((p) => p.key === it.key)!);
}

// ---------- layout ----------

export interface StarPx { key: string; x: number; y: number; r: number; tone: string; online: boolean; volume: number }
export interface SkyLayout { view: SkyView; plot: Rect; stars: StarPx[]; byKey: Map<string, StarPx>; labels: LabelBox[]; fonts: SkyFonts; nameSize: number; maxEventVol: number }

export const labelMetrics = (mobile: boolean): LabelMetrics => (mobile ? { nameH: 12, volH: 10, gap: 3, pad: 4, sep: 4, sepX: 10 } : { nameH: 13, volH: 11, gap: 4, pad: 6, sep: 6, sepX: 12 });

/** Pixel layout of the stars and labels for a view. Pure; recomputed on scene, size or font change. */
export function layoutSky(scene: Scene, view: SkyView, fonts: SkyFonts, volText: (key: string, volume: number) => string, measure: (text: string, font: string) => number): SkyLayout {
  const { w, h, inset, mobile } = view;
  const plot: Rect = { x0: inset.left, y0: inset.top, x1: Math.max(inset.left, w - inset.right), y1: Math.max(inset.top, h - inset.bottom) };
  const pw = plot.x1 - plot.x0, ph = plot.y1 - plot.y0;
  const side = Math.min(pw, ph);
  const rMax = mobile ? 18 : 26;
  const stars: StarPx[] = scene.stars.map((s) => ({
    key: s.key,
    x: plot.x0 + s.x * pw,
    y: plot.y0 + s.y * ph,
    r: Math.max(3.5, Math.min(rMax, s.r * side)),
    tone: s.colorToken,
    online: s.online,
    volume: s.volume,
  }));
  const m = labelMetrics(mobile);
  const nameSize = mobile ? 12 : 13;
  const nameFont = `500 ${nameSize}px ${fonts.sans}`;
  const volFont = `400 ${nameSize - 2}px ${fonts.mono}`;
  const items: LabelItem[] = scene.stars.map((s, i) => {
    const p = stars[i]!;
    const vol = volText(s.key, s.volume);
    return { key: s.key, x: p.x, y: p.y, r: p.r, name: s.name, vol, nameW: measure(s.name, nameFont), volW: measure(vol, volFont), weight: s.volume };
  });
  const bounds: Rect = { x0: 8, y0: 8, x1: w - Math.max(8, inset.right - 12), y1: h - inset.bottom + 4 };
  const labels = placeLabels(items, bounds, m);
  const maxEventVol = scene.events.reduce((mx, e) => Math.max(mx, e.volume), 0);
  return { view, plot, stars, byKey: new Map(stars.map((s) => [s.key, s])), labels, fonts, nameSize, maxEventVol };
}

// ---------- clock ----------

/**
 * The replay clock, wall-anchored so progress is a pure function of time: nothing advances it per
 * frame. Mutable on purpose (the canvas loop reads it every frame); `epoch` counts jumps.
 */
export class SkyClock {
  anchor: number;
  wall: number;
  playing = true;
  epoch = 0;
  constructor(public replaySec: number, anchor: number, now: number) {
    this.anchor = anchor;
    this.wall = now;
  }
  progress(now: number): number {
    if (!this.playing || this.anchor >= 1) return Math.min(1, this.anchor);
    return Math.min(1, this.anchor + (now - this.wall) / 1000 / this.replaySec);
  }
  jump(p: number, now: number): void {
    this.anchor = Math.max(0, Math.min(1, p));
    this.wall = now;
    this.epoch++;
  }
  restart(replaySec: number, anchor: number, now: number): void {
    this.replaySec = replaySec;
    this.playing = true;
    this.jump(anchor, now);
  }
  toggle(now: number): void {
    this.anchor = this.progress(now);
    this.wall = now;
    this.playing = !this.playing;
  }
}

// ---------- dynamics ----------

/** Path stored in canvas fractions so a resize keeps particles on course. Orbits use px radii. */
export interface Particle {
  orbit: boolean;
  /** Token of the colour; "" is the light of fresh coins. */
  tone: string;
  ax: number; ay: number; cx: number; cy: number; bx: number; by: number;
  born: number; dur: number;
}
export interface Pulse { key: string; txid: string; born: number; mag: number }
export interface SkyDynamics {
  animT: number; lastT: number; cursor: number; epoch: number; scene: Scene | null;
  budget: Map<string, number>; particles: Particle[]; pulses: Pulse[];
}

export const PULSE_SEC = 1.6;
/** Particles fly for about this long before their CoinJoin pulses. */
const ARRIVE = 2.2;
/** Events spawned in one step at most; a long jump (hidden tab) only shows the latest. */
const MAX_BURST = 24;

export const createDynamics = (): SkyDynamics => ({ animT: 0, lastT: -Infinity, cursor: 0, epoch: -1, scene: null, budget: new Map(), particles: [], pulses: [] });

function firstAfter(events: SkyEvent[], t: number): number {
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function rng(seed: string): () => number {
  let a = Math.floor(hash01(seed) * 2 ** 32);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spawn(dyn: SkyDynamics, layout: SkyLayout, e: SkyEvent, cap: number) {
  const target = layout.byKey.get(e.star);
  if (!target) return;
  const { w, h } = layout.view;
  if (w <= 0 || h <= 0) return;
  const mag = layout.maxEventVol > 0 ? Math.log1p(e.volume) / Math.log1p(layout.maxEventVol) : 0;
  dyn.pulses.push({ key: e.star, txid: e.txid, born: dyn.animT + ARRIVE, mag });

  const n = Math.min(dyn.budget.get(e.txid) ?? 1, cap - dyn.particles.length);
  if (n <= 0) return;
  const sources = [{ from: "", btc: e.freshBtc }, ...e.remixes.map((r) => ({ from: r.from, btc: r.btc }))].filter((s) => s.btc > 0);
  const total = sources.reduce((s, x) => s + x.btc, 0);
  const rand = rng(e.txid);
  for (let i = 0, acc = 0, si = 0; i < n; i++) {
    // Deterministic split proportional to BTC per source.
    const u = (i + 0.5) / n;
    while (total > 0 && si < sources.length - 1 && u * total > acc + sources[si]!.btc) acc += sources[si++]!.btc;
    const src = total > 0 ? sources[si]! : { from: "", btc: 0 };
    const dur = 1.15 + rand() * 0.75;
    const born = dyn.animT + ARRIVE - dur + (rand() - 0.5) * 0.5;
    if (src.from === e.star) {
      dyn.particles.push({ orbit: true, tone: target.tone, ax: target.x / w, ay: target.y / h, cx: rand() * Math.PI * 2, cy: rand() < 0.5 ? -1 : 1, bx: Math.min(clearRadius(target.r) - 8, target.r * (1.4 + rand() * 0.6)), by: target.r * 0.95, born, dur: dur + 0.6 });
      continue;
    }
    const from = src.from ? layout.byKey.get(src.from) : undefined;
    let ax: number, ay: number, bend: number;
    if (from) {
      const a = rand() * Math.PI * 2, d = rand() * from.r * 0.8;
      ax = from.x + Math.cos(a) * d;
      ay = from.y + Math.sin(a) * d;
      bend = 0.16 + rand() * 0.12;
    } else {
      ({ x: ax, y: ay } = edgeEntry(target.x, target.y, w, h, rand()));
      bend = (rand() - 0.5) * 0.5;
    }
    const tx = target.x + (rand() - 0.5) * target.r * 0.6, ty = target.y + (rand() - 0.5) * target.r * 0.6;
    const c = curveControl(ax, ay, tx, ty, bend);
    const tone = src.from ? coordinatorColorToken(src.from) : "";
    dyn.particles.push({ orbit: false, tone, ax: ax / w, ay: ay / h, cx: c.x / w, cy: c.y / h, bx: tx / w, by: ty / h, born, dur });
  }
}

/**
 * Advances the dynamics to replay time `clockT` (Infinity when live). A new `epoch` (scrub, period
 * change) clears the sky and resumes after the clock without replaying the past. `cap` is the max
 * number of particles alive at once.
 */
export function step(dyn: SkyDynamics, layout: SkyLayout, scene: Scene, clockT: number, dt: number, cap: number, epoch: number): void {
  // ponytail: live mode resumes after the last seen event time, so a CoinJoin indexed late with an
  // older Time never pulses; track seen txids if that matters.
  if (dyn.scene !== scene) {
    dyn.scene = scene;
    dyn.budget = particleBudget(scene.events, cap * 3);
    dyn.cursor = firstAfter(scene.events, dyn.lastT);
  }
  if (dyn.epoch !== epoch) {
    dyn.epoch = epoch;
    dyn.particles.length = 0;
    dyn.pulses.length = 0;
    dyn.lastT = clockT <= scene.since ? -Infinity : Math.min(clockT, scene.until);
    dyn.cursor = firstAfter(scene.events, dyn.lastT);
  }
  dyn.animT += dt;
  const ev = scene.events;
  let end = dyn.cursor;
  while (end < ev.length && ev[end]!.t <= clockT) end++;
  for (let i = Math.max(dyn.cursor, end - MAX_BURST); i < end; i++) spawn(dyn, layout, ev[i]!, cap);
  if (end > dyn.cursor) dyn.lastT = ev[end - 1]!.t;
  dyn.cursor = end;
  const now = dyn.animT;
  dyn.particles = dyn.particles.filter((p) => now - p.born < p.dur);
  dyn.pulses = dyn.pulses.filter((p) => now - p.born < PULSE_SEC);
}

// ---------- drawing ----------

const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const TAIL = 0.1;
const TRAIL = [1, 0.5, 0.2];

function particleAt(p: Particle, k: number, w: number, h: number): { x: number; y: number } {
  const e = easeInOut(Math.max(0, Math.min(1, k)));
  if (p.orbit) {
    const ang = p.cx + p.cy * Math.PI * 1.1 * e;
    const rad = p.bx + (p.by - p.bx) * e;
    return { x: p.ax * w + Math.cos(ang) * rad, y: p.ay * h + Math.sin(ang) * rad };
  }
  return quadPoint(p.ax * w, p.ay * h, p.cx * w, p.cy * h, p.bx * w, p.by * h, e);
}

/** Seeded star-field grain, stable for a given seed (its pattern does not depend on the canvas size). */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, fg: string) {
  const rand = rng("am-i.exposed sky");
  const n = Math.min(900, Math.round((w * h) / 1500));
  for (let i = 0; i < n; i++) {
    const x = rand() * w, y = rand() * h, b = rand() ** 3, s = rand();
    ctx.fillStyle = rgba(fg, 0.05 + b * 0.4);
    const size = s > 0.97 ? 1.6 : s > 0.8 ? 1.1 : 0.7;
    ctx.fillRect(x, y, size, size);
  }
}

function flowPath(ctx: CanvasRenderingContext2D, a: StarPx, b: StarPx) {
  const c = curveControl(a.x, a.y, b.x, b.y, 0.18);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
}

/** bleed: the sky dissolves into the page (dark theme) instead of deepening at its card edge. */
export interface BackdropOpts { palette: SkyPalette; scene: Scene; reduced: boolean; bleed: boolean }

/**
 * The still layer, drawn once per scene, size or theme: sky, nebula tint, grain, vignette, flow
 * lines (strong, BTC-wide in reduced motion; a faint constellation otherwise).
 */
export function drawBackdrop(ctx: CanvasRenderingContext2D, layout: SkyLayout, o: BackdropOpts): void {
  const { w, h } = layout.view;
  const { palette } = o;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = palette.sky;
  ctx.fillRect(0, 0, w, h);

  // Faint nebulae behind the three busiest stars.
  const top = [...layout.stars].filter((s) => s.volume > 0).sort((a, b) => b.volume - a.volume).slice(0, 3);
  for (const [i, s] of top.entries()) {
    const R = Math.max(w, h) * (0.32 - i * 0.06);
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, R);
    g.addColorStop(0, rgba(palette.tone(s.tone), 0.075 - i * 0.015));
    g.addColorStop(1, rgba(palette.tone(s.tone), 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  grain(ctx, w, h, palette.fg);

  // Vignette: in dark the sky dissolves into the page; in light it deepens toward the card edge.
  const vg = ctx.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.3, w / 2, h * 0.5, Math.hypot(w, h) * 0.62);
  vg.addColorStop(0, rgba(palette.edge, 0));
  vg.addColorStop(1, rgba(palette.edge, o.bleed ? 0.9 : 0.55));
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  // Flow lines between coordinators.
  const flows = o.scene.flows.filter((f) => layout.byKey.has(f.from) && layout.byKey.has(f.to));
  const maxBtc = flows.reduce((m, f) => Math.max(m, f.btc), 0);
  ctx.lineCap = "round";
  for (const f of flows) {
    const a = layout.byKey.get(f.from)!, b = layout.byKey.get(f.to)!;
    const k = maxBtc > 0 ? Math.sqrt(f.btc / maxBtc) : 0;
    if (f.internal) {
      if (!o.reduced) continue;
      const lw = 1 + 6 * k;
      ctx.strokeStyle = rgba(palette.tone(a.tone), 0.32);
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r + 5 + lw / 2, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    const alpha = o.reduced ? 0.5 : 0.13;
    g.addColorStop(0, rgba(palette.tone(a.tone), alpha));
    g.addColorStop(1, rgba(palette.tone(b.tone), alpha));
    ctx.strokeStyle = g;
    ctx.lineWidth = o.reduced ? 1 + 7 * k : 0.6 + 1.6 * k;
    flowPath(ctx, a, b);
    ctx.stroke();
  }

}


/** Labels: name in the sky foreground, volume in muted tabular figures. Drawn above the particles. */
function drawLabels(ctx: CanvasRenderingContext2D, layout: SkyLayout, palette: SkyPalette) {
  const m = labelMetrics(layout.view.mobile);
  ctx.textBaseline = "top";
  ctx.shadowColor = rgba(palette.sky, 0.9);
  ctx.shadowBlur = 8;
  for (const l of layout.labels) {
    const star = layout.byKey.get(l.key);
    const dim = star && !star.online ? 0.55 : 1;
    ctx.textAlign = l.side === "right" ? "left" : l.side === "left" ? "right" : "center";
    const tx = l.side === "right" ? l.x : l.side === "left" ? l.x + l.w : l.x + l.w / 2;
    ctx.font = `500 ${layout.nameSize}px ${layout.fonts.sans}`;
    ctx.fillStyle = rgba(palette.fg, 0.92 * dim);
    ctx.fillText(l.name, tx, l.y);
    if (l.showVolume) {
      ctx.font = `400 ${layout.nameSize - 2}px ${layout.fonts.mono}`;
      ctx.fillStyle = rgba(palette.fg, 0.5 * dim);
      ctx.fillText(l.vol, tx, l.y + m.nameH + m.gap);
    }
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
}

export interface FrameUi { hover: string | null; selected: string | null; highlight: { key: string; txid: string } | null }

function drawStar(ctx: CanvasRenderingContext2D, s: StarPx, palette: SkyPalette, flash: number) {
  const c = palette.tone(s.tone);
  const glowR = s.r * (3.4 + flash * 1.6);
  const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR);
  const ga = s.online ? 0.34 + flash * 0.3 : 0.1;
  g.addColorStop(0, rgba(c, ga));
  g.addColorStop(0.3, rgba(c, ga * 0.32));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  if (!s.online) {
    ctx.strokeStyle = rgba(c, 0.5);
    ctx.lineWidth = 1.25;
    ctx.stroke();
    return;
  }
  const body = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
  body.addColorStop(0, rgba(palette.fg, 0.95));
  body.addColorStop(0.28 - flash * 0.1, rgba(c, 1));
  body.addColorStop(1, rgba(c, 0.82));
  ctx.fillStyle = body;
  ctx.fill();
  // A hairline rim keeps small stars crisp against their glow.
  ctx.strokeStyle = rgba(palette.fg, 0.18 + flash * 0.3);
  ctx.lineWidth = 0.75;
  ctx.stroke();
}

/** One frame: the backdrop, then particles (additive, with short trails), pulses, stars and focus rings. */
export function drawFrame(ctx: CanvasRenderingContext2D, layout: SkyLayout, dyn: SkyDynamics, palette: SkyPalette, backdrop: CanvasImageSource | null, ui: FrameUi): void {
  const { w, h } = layout.view;
  if (backdrop) ctx.drawImage(backdrop, 0, 0, w, h);
  const now = dyn.animT;

  // Particles, batched by colour and alpha bucket.
  if (dyn.particles.length) {
    const buckets = new Map<string, number[]>();
    for (const p of dyn.particles) {
      const k = (now - p.born) / p.dur;
      if (k <= 0 || k >= 1) continue;
      const a = Math.min(1, k / 0.14, (1 - k) / 0.2) * (p.orbit ? 0.45 : 1);
      // A soft trail: three segments fading toward the tail.
      let prev = particleAt(p, k, w, h);
      for (let s = 1; s <= 3; s++) {
        const next = particleAt(p, k - (TAIL * s) / 3, w, h);
        const level = Math.ceil(a * TRAIL[s - 1]! * 6);
        if (level > 0) {
          const key = `${p.tone}|${level}`;
          let arr = buckets.get(key);
          if (!arr) buckets.set(key, (arr = []));
          arr.push(next.x, next.y, prev.x, prev.y);
        }
        prev = next;
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineWidth = layout.view.mobile ? 1.1 : 1.25;
    for (const [key, pts] of buckets) {
      const [tone, level] = key.split("|");
      const base = tone ? palette.tone(tone!) : palette.fg;
      ctx.strokeStyle = rgba(base, (Number(level) / 6) * (tone ? 0.85 : 0.7));
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 4) {
        ctx.moveTo(pts[i]!, pts[i + 1]!);
        ctx.lineTo(pts[i + 2]!, pts[i + 3]!);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Pulses: an eased ring per CoinJoin, and a flash on its star.
  const flash = new Map<string, number>();
  for (const p of dyn.pulses) {
    const k = (now - p.born) / PULSE_SEC;
    const s = layout.byKey.get(p.key);
    if (k < 0 || !s) continue;
    const e = easeOut(k);
    const rad = s.r + (8 + 30 * p.mag) * (layout.view.mobile ? 0.7 : 1) * e + 2;
    ctx.strokeStyle = rgba(palette.tone(s.tone), 0.6 * (1 - k) ** 2);
    ctx.lineWidth = 0.6 + 1.4 * (1 - k);
    ctx.beginPath();
    ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
    ctx.stroke();
    if (k < 0.4) flash.set(p.key, Math.max(flash.get(p.key) ?? 0, (1 - k / 0.4) * (0.35 + 0.65 * p.mag)));
  }

  for (const s of layout.stars) drawStar(ctx, s, palette, flash.get(s.key) ?? 0);
  drawLabels(ctx, layout, palette);

  // Orbit ring for the hovered or selected star, with a slow satellite.
  for (const key of new Set([ui.hover, ui.selected])) {
    const s = key ? layout.byKey.get(key) : undefined;
    if (!s) continue;
    const R = s.r + 9;
    ctx.strokeStyle = rgba(palette.fg, key === ui.selected ? 0.5 : 0.32);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(s.x, s.y, R, 0, Math.PI * 2);
    ctx.stroke();
    const a = now * 0.9 - Math.PI / 2;
    ctx.fillStyle = rgba(palette.fg, 0.85);
    ctx.beginPath();
    ctx.arc(s.x + Math.cos(a) * R, s.y + Math.sin(a) * R, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // The highlighted CoinJoin's star breathes.
  const hs = ui.highlight ? layout.byKey.get(ui.highlight.key) : undefined;
  if (hs) {
    const b = 0.5 + 0.5 * Math.sin(now * 2.6);
    ctx.strokeStyle = rgba(palette.fg, 0.45 + 0.35 * b);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(hs.x, hs.y, hs.r + 10 + 2 * b, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** The pulse ring under a point, newest first, for hover and click. */
export function pulseAt(layout: SkyLayout, dyn: SkyDynamics, x: number, y: number): string | null {
  for (let i = dyn.pulses.length - 1; i >= 0; i--) {
    const p = dyn.pulses[i]!;
    const k = (dyn.animT - p.born) / PULSE_SEC;
    const s = layout.byKey.get(p.key);
    if (k < 0 || k > 0.85 || !s) continue;
    const rad = s.r + (8 + 30 * p.mag) * (layout.view.mobile ? 0.7 : 1) * easeOut(k) + 2;
    if (Math.abs(Math.hypot(x - s.x, y - s.y) - rad) < 8) return p.txid;
  }
  return null;
}
