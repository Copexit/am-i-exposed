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
  SparklinePoint,
  WhirlpoolCharts,
  WhirlpoolSummary,
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
 * Build a per-pool sparkline from the cumulative-capacity charts payload.
 * Reads `charts.capacity_btc[poolKey]` against `charts.blocks` and downsamples.
 */
export function whirlpoolSparkline(
  charts: WhirlpoolCharts,
  poolKey: string,
): SparklinePoint[] {
  const ys = charts.capacity_btc?.[poolKey];
  if (!ys) return [];
  return downsampleSeries(charts.blocks, ys);
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
  if (!charts.blocks || charts.blocks.length < 2) return null;
  const firstBlock = charts.blocks[0];
  const lastBlock = charts.blocks[charts.blocks.length - 1];
  // Need at least 30 days of data span to be meaningful.
  if (lastBlock - firstBlock < BLOCKS_PER_30D) return null;
  const targetBlock = lastBlock - BLOCKS_PER_30D;
  // Find the latest sample whose block height is <= targetBlock (i.e., the
  // "30 days ago" reference point). Linear scan is fine - charts are tiny
  // after downsampling.
  let startIdx = -1;
  for (let i = 0; i < charts.blocks.length; i++) {
    if (charts.blocks[i] <= targetBlock) startIdx = i;
    else break;
  }
  if (startIdx === -1) return null;
  const keys = poolKey ? [poolKey] : Object.keys(charts.capacity_btc ?? {});
  if (keys.length === 0) return null;
  let delta = 0;
  for (const k of keys) {
    const series = charts.capacity_btc[k];
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
  const series = charts.capacity_btc?.[poolKey];
  if (!series || series.length === 0) return null;
  return series[series.length - 1];
}

/** Sum the latest capacity across all pools in the charts payload. */
export function whirlpoolTotalCurrentCapacity(charts: WhirlpoolCharts): number {
  const keys = Object.keys(charts.capacity_btc ?? {});
  let total = 0;
  for (const k of keys) {
    const v = whirlpoolCurrentCapacity(charts, k);
    if (v != null) total += v;
  }
  return total;
}

/** Sum of total_entered_btc across all pools in the summary. */
export function whirlpoolLifetimeEntered(summary: WhirlpoolSummary): number {
  if (summary.total_entered_btc != null) return summary.total_entered_btc;
  return summary.pools.reduce((acc, p) => acc + p.total_entered_btc, 0);
}

/** Sum of cycles across all pools in the summary. */
export function whirlpoolLifetimeCycles(summary: WhirlpoolSummary): number {
  return summary.pools.reduce((acc, p) => acc + p.cycles, 0);
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
