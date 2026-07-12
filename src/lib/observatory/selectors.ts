/**
 * Pure data shaping for the observatory UI.
 *
 * No fetch calls, no React, no side effects. Everything testable with literal
 * fixtures.
 */

import type {
  LiquiSabiDashboard,
  LiquiSabiGraphEntry,
  CoordinatorView,
  CycleRow,
  SparklinePoint,
  WhirlpoolCharts,
  WhirlpoolSummary,
  WhirlpoolTxsPage,
} from "./types";

const MAX_SPARKLINE_POINTS = 60;

/** ~30 days of Bitcoin blocks at 10 min/block (used for "last 30d" windows). */
export const BLOCKS_PER_30D = 4320;

/**
 * Drop the array down to at most maxPoints by uniform bucket averaging.
 * Preserves the first and last samples so the trend endpoints stay visible.
 */
export function downsampleSeries(
  xs: number[],
  ys: number[],
  maxPoints: number = MAX_SPARKLINE_POINTS,
): SparklinePoint[] {
  if (xs.length !== ys.length) return [];
  if (xs.length === 0) return [];
  if (xs.length <= maxPoints) {
    return xs.map((x, i) => ({ x, y: ys[i] }));
  }
  const bucket = xs.length / maxPoints;
  const out: SparklinePoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.min(xs.length, Math.floor((i + 1) * bucket));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += ys[j];
      count++;
    }
    out.push({ x: xs[start], y: count > 0 ? sum / count : 0 });
  }
  return out;
}

/**
 * Build a per-pool sparkline from the current-capacity charts payload.
 * Reads `charts.capacity.series[poolKey]` against `charts.capacity.blocks`.
 */
export function whirlpoolSparkline(
  charts: WhirlpoolCharts,
  poolKey: string,
): SparklinePoint[] {
  const ys = charts.capacity?.series?.[poolKey];
  if (!ys) return [];
  return downsampleSeries(charts.capacity.blocks, ys);
}

/**
 * Approximate net change in current capacity over the last 30 days.
 * - `poolKey` undefined → sum across all pools in the payload.
 * - Returns null if the chart has too few samples to span a 30d window.
 */
export function whirlpool30dDelta(
  charts: WhirlpoolCharts,
  poolKey?: string,
): number | null {
  const blocks = charts.capacity?.blocks;
  if (!blocks || blocks.length < 2) return null;
  const firstBlock = blocks[0];
  const lastBlock = blocks[blocks.length - 1];
  // Need at least 30 days of data span to be meaningful.
  if (lastBlock - firstBlock < BLOCKS_PER_30D) return null;
  const targetBlock = lastBlock - BLOCKS_PER_30D;
  // Find the latest sample whose block height is <= targetBlock (i.e., the
  // "30 days ago" reference point). Linear scan is fine - charts are tiny
  // after downsampling.
  let startIdx = -1;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i] <= targetBlock) startIdx = i;
    else break;
  }
  if (startIdx === -1) return null;
  const keys = poolKey ? [poolKey] : Object.keys(charts.capacity.series ?? {});
  if (keys.length === 0) return null;
  let delta = 0;
  for (const k of keys) {
    const series = charts.capacity.series[k];
    if (!series || series.length === 0) continue;
    delta += series[series.length - 1] - series[startIdx];
  }
  return delta;
}

/**
 * Current per-pool capacity (last sample in the time series).
 * Returns null if the pool is missing or empty.
 */
export function whirlpoolCurrentCapacity(
  charts: WhirlpoolCharts,
  poolKey: string,
): number | null {
  const series = charts.capacity?.series?.[poolKey];
  if (!series || series.length === 0) return null;
  return series[series.length - 1];
}

/** Sum the latest capacity across all pools in the charts payload. */
export function whirlpoolTotalCurrentCapacity(charts: WhirlpoolCharts): number {
  const keys = Object.keys(charts.capacity?.series ?? {});
  let total = 0;
  for (const k of keys) {
    const v = whirlpoolCurrentCapacity(charts, k);
    if (v != null) total += v;
  }
  return total;
}

/** Sum of lifetime entered BTC across all pools in the summary. */
export function whirlpoolLifetimeEntered(summary: WhirlpoolSummary): number {
  return summary.pools.reduce((acc, p) => acc + p.entered_btc, 0);
}

/** Sum of cycles across all pools in the summary. */
export function whirlpoolLifetimeCycles(summary: WhirlpoolSummary): number {
  return summary.pools.reduce((acc, p) => acc + p.cycles, 0);
}

/** Sum of currently-unspent BTC across all pools in the summary. */
export function whirlpoolTotalUnspent(summary: WhirlpoolSummary): number {
  return summary.pools.reduce((acc, p) => acc + p.unspent_btc, 0);
}

/** Sum of currently-unspent UTXOs across all pools in the summary. */
export function whirlpoolTotalUnspentUtxos(summary: WhirlpoolSummary): number {
  return summary.pools.reduce((acc, p) => acc + p.unspent_utxos, 0);
}

/** Sum of lifetime TX0 (premix) transactions across all pools. */
export function whirlpoolTotalTx0(summary: WhirlpoolSummary): number {
  return summary.pools.reduce((acc, p) => acc + p.tx0_count, 0);
}

/**
 * Shape a page of coinjoin-cycle history into table rows, linking each cycle
 * to the same-origin scanner (`/#tx=<txid>`) rather than the upstream's
 * external deep link.
 */
export function toCycleRows(page: WhirlpoolTxsPage | null): CycleRow[] {
  if (!page?.items) return [];
  return page.items.map((tx) => ({
    txid: tx.txid,
    blockHeight: tx.block_height,
    poolLabel: tx.pool_label,
    poolColor: tx.pool_color,
    tx0Count: tx.tx0_inputs?.length ?? 0,
    scanHref: `/#tx=${tx.txid}`,
  }));
}

// ---------- liquisabi (unchanged) ----------

export function liquiSabiFreshInputSparkline(
  graph: LiquiSabiGraphEntry[],
): SparklinePoint[] {
  if (!graph.length) return [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < graph.length; i++) {
    xs.push(i);
    ys.push(graph[i].Averages?.FreshInputsEstimateBtc ?? 0);
  }
  return downsampleSeries(xs, ys);
}

export function projectCoordinators(
  dashboard: LiquiSabiDashboard,
): CoordinatorView[] {
  const lastFeeByEndpoint = new Map<string, number>();
  for (const round of dashboard.PaginatedRounds.Rounds) {
    if (!lastFeeByEndpoint.has(round.CoordinatorEndpoint)) {
      lastFeeByEndpoint.set(round.CoordinatorEndpoint, round.CoordinationFeeRate);
    }
  }
  return dashboard.Coordinators
    .filter((c) => c.Coordinator.Name && c.Coordinator.Name.trim() !== "")
    .map((c) => ({
      endpoint: c.Coordinator.Endpoint,
      name: c.Coordinator.Name,
      readMore: c.Coordinator.ReadMore,
      description: c.Coordinator.Content,
      freshInputPercent: c.FreshInputPercent,
      roundCount: c.NbRounds,
      isPaid: (lastFeeByEndpoint.get(c.Coordinator.Endpoint) ?? 0) > 0,
    }))
    .sort((a, b) => {
      if ((a.roundCount > 0) !== (b.roundCount > 0)) {
        return a.roundCount > 0 ? -1 : 1;
      }
      return b.freshInputPercent - a.freshInputPercent;
    });
}

export function unpaidCoordinators(
  views: CoordinatorView[],
): CoordinatorView[] {
  return views.filter((c) => !c.isPaid);
}

/**
 * Coordinators that ran at least one round in the last 30 days.
 * `roundCount` is LiquiSabi's `NbRounds`, a 30-day rolling count.
 */
export function activeCoordinators(
  views: CoordinatorView[],
): CoordinatorView[] {
  return views.filter((c) => c.roundCount > 0);
}

/** Coordinators with zero rounds in the last 30 days (idle 30d+). */
export function inactiveCoordinators(
  views: CoordinatorView[],
): CoordinatorView[] {
  return views.filter((c) => c.roundCount === 0);
}

export function sumRecentFreshInputs(
  graph: LiquiSabiGraphEntry[],
  recentDays: number,
): number {
  if (!graph.length) return 0;
  const slice = graph.slice(-recentDays);
  return slice.reduce((acc, entry) => acc + (entry.Averages?.FreshInputsEstimateBtc ?? 0), 0);
}

export function sumRecentRoundCount(
  graph: LiquiSabiGraphEntry[],
  recentDays: number,
): number {
  if (!graph.length) return 0;
  const slice = graph.slice(-recentDays);
  let total = 0;
  for (const entry of slice) {
    const id = entry.Averages?.RoundId;
    const parsed = id ? parseInt(id, 10) : NaN;
    if (!isNaN(parsed)) total += parsed;
  }
  return total;
}
