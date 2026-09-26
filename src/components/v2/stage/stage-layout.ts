import type { IoTag, IoView } from "@/lib/view/tx-io";

/**
 * Pure layout for the transaction stage: which rows to show on each side
 * (individual IOs, equal-value tiers, an aggregated "more" row) and the ribbon
 * geometry between them. Nothing here re-detects facts: tiers come from the
 * view model's anon-set tags, never from recounting values.
 */

export type StageSide = "input" | "output";

export type StageRow =
  | { kind: "io"; key: string; side: StageSide; value: number; io: IoView; tags: IoTag[] }
  | {
      kind: "tier"; key: string; side: StageSide; value: number;
      /** Value of each member output. */
      unit: number; members: IoView[]; tags: IoTag[];
    }
  | { kind: "more"; key: string; side: StageSide; value: number; count: number };

export interface RowOptions {
  /** Group outputs that share an anon-set tag into one tier row. */
  groupTiers: boolean;
  /** Max rows before the rest collapses into a "more" row; null shows all. */
  limit: number | null;
}

const hasFindingTag = (tags: readonly IoTag[]) => tags.some((t) => t.source.kind === "finding");

/** Union of member tags, one per (kind, source) pair, in first-seen order. */
function mergeTags(members: readonly IoView[]): IoTag[] {
  const seen = new Set<string>();
  const out: IoTag[] = [];
  for (const m of members) {
    for (const tag of m.tags) {
      const p = tag.params ?? {};
      const id = `${tag.kind}:${tag.source.kind === "finding" ? tag.source.findingId : "tx"}:${p.entityName ?? ""}:${p.childTxid ?? p.parentTxid ?? ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(tag);
    }
  }
  return out;
}

export function buildStageRows(items: readonly IoView[], side: StageSide, { groupTiers, limit }: RowOptions): StageRow[] {
  const ioRow = (io: IoView): StageRow => ({ kind: "io", key: `${side}-${io.index}`, side, value: io.value, io, tags: io.tags });
  let rows: StageRow[];

  if (groupTiers) {
    const tiers = new Map<number, IoView[]>();
    const singles: IoView[] = [];
    for (const io of items) {
      const inSet = io.tags.some((t) => t.kind === "anon-set" && Number(t.params?.anonSet) >= 2);
      if (inSet) tiers.set(io.value, [...(tiers.get(io.value) ?? []), io]);
      else singles.push(io);
    }
    const tierRows: StageRow[] = [...tiers.entries()]
      .sort(([va, a], [vb, b]) => b.length - a.length || vb - va)
      .map(([unit, members]) => ({
        // The anon-set tag is what the tier header already says ("5 x ..."), so it is not repeated.
        kind: "tier", key: `${side}-tier-${unit}`, side, value: unit * members.length, unit, members,
        tags: mergeTags(members).filter((t) => t.kind !== "anon-set"),
      }));
    rows = [...tierRows, ...singles.map(ioRow)];
  } else {
    rows = items.map(ioRow);
  }

  if (limit === null || rows.length <= limit) return rows;

  // Keep evidence visible: rows carrying a finding-backed tag always stay,
  // then the first plain rows fill the budget (one slot is the "more" row).
  const budget = Math.max(1, limit - 1);
  const keep = new Set<StageRow>(rows.filter((r) => r.kind !== "more" && hasFindingTag(r.tags)).slice(0, budget));
  for (const r of rows) {
    if (keep.size >= budget) break;
    keep.add(r);
  }
  const hidden = rows.filter((r) => !keep.has(r));
  const hiddenCount = hidden.reduce((s, r) => s + (r.kind === "tier" ? r.members.length : 1), 0);
  return [
    ...rows.filter((r) => keep.has(r)),
    { kind: "more", key: `${side}-more`, side, value: hidden.reduce((s, r) => s + r.value, 0), count: hiddenCount },
  ];
}

/** Number of IOs a row stands for. */
export function rowCount(row: StageRow): number {
  return row.kind === "tier" ? row.members.length : row.kind === "more" ? row.count : 1;
}

// ---------------------------------------------------------------------------
// Ribbon geometry
// ---------------------------------------------------------------------------

export interface Port {
  key: string;
  /** Vertical center of the row, in the diagram's coordinate space. */
  y: number;
  value: number;
}

export interface Ribbon {
  key: string;
  side: StageSide;
  /** Closed band path from the row port to its slot on the junction. */
  d: string;
  width: number;
}

export interface FlowLayout {
  junction: { x: number; y0: number; y1: number };
  ribbons: Ribbon[];
}

export const MIN_BAND = 1.5;

/**
 * Bow-tie layout: every input band flows into one central junction and every
 * output band leaves it. Band width is linear in value (one scale for both
 * sides, so widths are comparable), floored at MIN_BAND so dust stays visible.
 */
export function layoutFlow(
  inPorts: readonly Port[],
  outPorts: readonly Port[],
  { width, maxBand, maxJunction }: { width: number; maxBand: number; maxJunction: number },
): FlowLayout {
  const all = [...inPorts, ...outPorts];
  const maxValue = Math.max(1, ...all.map((p) => p.value));
  const sumIn = inPorts.reduce((s, p) => s + p.value, 0);
  const sumOut = outPorts.reduce((s, p) => s + p.value, 0);
  const k = Math.min(maxBand / maxValue, maxJunction / Math.max(1, sumIn, sumOut));
  const bandW = (v: number) => Math.max(MIN_BAND, v * k);

  const ys = all.map((p) => p.y);
  const cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  const stackIn = inPorts.reduce((s, p) => s + bandW(p.value), 0);
  const stackOut = outPorts.reduce((s, p) => s + bandW(p.value), 0);
  const jh = Math.max(stackIn, stackOut);
  const jx = width / 2;

  const side = (ports: readonly Port[], s: StageSide, stack: number): Ribbon[] => {
    let cursor = cy - stack / 2;
    return ports.map((p) => {
      const w = bandW(p.value);
      const slot = cursor + w / 2;
      cursor += w;
      const [x0, y0, x1, y1] = s === "input" ? [0, p.y, jx, slot] : [jx, slot, width, p.y];
      return { key: p.key, side: s, width: w, d: band(x0, y0, x1, y1, w) };
    });
  };

  return {
    junction: { x: jx, y0: cy - jh / 2, y1: cy + jh / 2 },
    ribbons: [...side(inPorts, "input", stackIn), ...side(outPorts, "output", stackOut)],
  };
}

const r = (n: number) => Math.round(n * 10) / 10;

/** Closed cubic band of constant width w from (x0,y0) to (x1,y1). */
export function band(x0: number, y0: number, x1: number, y1: number, w: number): string {
  const mx = r((x0 + x1) / 2);
  const h = w / 2;
  return `M${r(x0)},${r(y0 - h)}C${mx},${r(y0 - h)} ${mx},${r(y1 - h)} ${r(x1)},${r(y1 - h)}`
    + `L${r(x1)},${r(y1 + h)}C${mx},${r(y1 + h)} ${mx},${r(y0 + h)} ${r(x0)},${r(y0 + h)}Z`;
}

/** Single cubic curve from (x0,y0) to (x1,y1), used for linkability links. */
export function curve(x0: number, y0: number, x1: number, y1: number): string {
  const mx = r((x0 + x1) / 2);
  return `M${r(x0)},${r(y0)}C${mx},${r(y0)} ${mx},${r(y1)} ${r(x1)},${r(y1)}`;
}
