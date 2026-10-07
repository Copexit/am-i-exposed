import type { Flow } from "./sky-model";

/** An angular span, radians clockwise from 12 o'clock. */
export interface Span { a0: number; a1: number }
export interface ChordGroup extends Span {
  key: string;
  /** BTC through the coordinator: internal + in from others + out to others. */
  total: number;
  inBtc: number; inCoins: number;
  outBtc: number; outCoins: number;
  internalBtc: number; internalCoins: number;
  /** The internal-remix share of the arc, drawn as an inner band; null without internal remix. */
  internal: Span | null;
}
export interface ChordRibbon { from: string; to: string; btc: number; coins: number; source: Span; target: Span }
export interface ChordLayout { groups: ChordGroup[]; ribbons: ChordRibbon[] }

/**
 * Splits `total` across `values` proportionally, but no part below `min` (so a tiny coordinator or
 * flow stays visible). The parts always sum to `total`; if `min` cannot fit, the split is even.
 */
export function allocate(values: number[], total: number, min: number): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n * min >= total) return values.map(() => total / n);
  const floored = new Set<number>();
  for (;;) {
    const rest = total - floored.size * min;
    const free = values.map((_, i) => i).filter((i) => !floored.has(i));
    const sum = free.reduce((s, i) => s + values[i]!, 0);
    const share = (i: number) => (sum > 0 ? (rest * values[i]!) / sum : rest / free.length);
    const under = free.filter((i) => share(i) < min);
    if (under.length === 0) return values.map((_, i) => (floored.has(i) ? min : share(i)));
    for (const i of under) floored.add(i);
  }
}

/**
 * Chord geometry for the remix flows: one arc per coordinator sized by the BTC through it, one
 * ribbon per cross-coordinator flow sized by its BTC at both ends, and self-flows (internal remix)
 * as a span of the arc rather than a ribbon. Arcs run largest first, with `gap` between them.
 */
export function chordLayout(flows: Flow[], { gap = 0.04, minGroup = 0.16, minEnd = 0.012 } = {}): ChordLayout {
  const live = flows.filter((f) => f.btc > 0);
  const stats = new Map<string, Omit<ChordGroup, keyof Span | "internal">>();
  const get = (key: string) => {
    let s = stats.get(key);
    if (!s) stats.set(key, (s = { key, total: 0, inBtc: 0, inCoins: 0, outBtc: 0, outCoins: 0, internalBtc: 0, internalCoins: 0 }));
    return s;
  };
  for (const f of live) {
    if (f.from === f.to) {
      const s = get(f.from);
      s.internalBtc += f.btc; s.internalCoins += f.coins; s.total += f.btc;
    } else {
      const a = get(f.from), b = get(f.to);
      a.outBtc += f.btc; a.outCoins += f.coins; a.total += f.btc;
      b.inBtc += f.btc; b.inCoins += f.coins; b.total += f.btc;
    }
  }
  const order = [...stats.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  const n = order.length;
  if (n === 0) return { groups: [], ribbons: [] };
  const index = new Map(order.map((g, i) => [g.key, i]));
  const sizes = allocate(order.map((g) => g.total), 2 * Math.PI - n * gap, minGroup);

  const cross = live.filter((f) => f.from !== f.to);
  const ends = new Map<Flow, { source?: Span; target?: Span }>(cross.map((f) => [f, {}]));
  const groups: ChordGroup[] = [];
  // One BTC-to-angle scale for every ribbon end and internal band, so a floored (tiny) coordinator's
  // ribbon is as thin as its BTC, not as wide as its padded arc. Its spare arc stays plain.
  const k = Math.min(...order.map((g, i) => sizes[i]! / g.total));
  let a = gap / 2;
  order.forEach((g, i) => {
    const size = sizes[i]!;
    // Internal first, then the ribbon ends, farthest partner first so neighbours meet without crossing.
    const parts: { btc: number; flow?: Flow; side?: "source" | "target" }[] = [];
    if (g.internalBtc > 0) parts.push({ btc: g.internalBtc });
    const offset = (key: string) => (index.get(key)! - i + n) % n;
    const partner = (p: { flow: Flow; side: "source" | "target" }) => (p.side === "source" ? p.flow.to : p.flow.from);
    const mine = cross
      .filter((f) => f.from === g.key || f.to === g.key)
      .map((f) => ({ btc: f.btc, flow: f, side: f.from === g.key ? ("source" as const) : ("target" as const) }))
      .sort((x, y) => offset(partner(y)) - offset(partner(x)) || (x.side === y.side ? 0 : x.side === "source" ? -1 : 1));
    parts.push(...mine);
    const widths = parts.map((p) => (p.flow ? Math.max(minEnd, p.btc * k) : 0));
    const endsSum = widths.reduce((x, w) => x + w, 0);
    const fit = endsSum > size ? size / endsSum : 1;
    for (let j = 0; j < parts.length; j++) widths[j] = parts[j]!.flow ? widths[j]! * fit : Math.max(0, Math.min(parts[j]!.btc * k, size - endsSum));
    const used = widths.reduce((x, w) => x + w, 0);
    let internal: Span | null = null;
    let p0 = a + (size - used) / 2;
    parts.forEach((p, j) => {
      const span = { a0: p0, a1: p0 + widths[j]! };
      if (p.flow && p.side) ends.get(p.flow)![p.side] = span;
      else internal = span;
      p0 = span.a1;
    });
    groups.push({ ...g, a0: a, a1: a + size, internal });
    a += size + gap;
  });
  const ribbons = cross.map((f) => ({ from: f.from, to: f.to, btc: f.btc, coins: f.coins, source: ends.get(f)!.source!, target: ends.get(f)!.target! }));
  return { groups, ribbons };
}

const pt = (r: number, a: number) => `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
const large = (s: Span) => (s.a1 - s.a0 > Math.PI ? 1 : 0);

/** An annulus sector between radii r0 < r1, centred on the origin. */
export function arcPath(r0: number, r1: number, s: Span): string {
  return `M${pt(r1, s.a0)}A${r1} ${r1} 0 ${large(s)} 1 ${pt(r1, s.a1)}L${pt(r0, s.a1)}A${r0} ${r0} 0 ${large(s)} 0 ${pt(r0, s.a0)}Z`;
}

/**
 * Control point for a curve between two angles on radius r: through the centre for opposite ends,
 * pulled out toward the rim for near neighbours, so short ribbons bow instead of pinching.
 */
function control(r: number, a0: number, a1: number): string {
  let d = a1 - a0;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return pt(r * 0.7 * Math.max(0, 1 - Math.abs(d) / Math.PI), a0 + d / 2);
}

/** A ribbon between two spans on the circle of radius r, curving toward the centre. */
export function ribbonPath(r: number, source: Span, target: Span): string {
  return `M${pt(r, source.a0)}A${r} ${r} 0 ${large(source)} 1 ${pt(r, source.a1)}Q${control(r, source.a1, target.a0)} ${pt(r, target.a0)}A${r} ${r} 0 ${large(target)} 1 ${pt(r, target.a1)}Q${control(r, target.a1, source.a0)} ${pt(r, source.a0)}Z`;
}

/** Ranked flows for the narrow layout: between coordinators first, internal remix after. */
export function rankFlows(flows: Flow[]): { cross: Flow[]; internal: Flow[] } {
  const live = flows.filter((f) => f.btc > 0).sort((a, b) => b.btc - a.btc || b.coins - a.coins);
  return { cross: live.filter((f) => !f.internal), internal: live.filter((f) => f.internal) };
}
