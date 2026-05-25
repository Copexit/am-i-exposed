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
  WhirlpoolChartSeries,
} from "./types";

const MAX_SPARKLINE_POINTS = 60;

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

export function whirlpoolSparkline(
  series: WhirlpoolChartSeries,
  poolKey: string,
): SparklinePoint[] {
  const ys = series.series[poolKey];
  if (!ys) return [];
  return downsampleSeries(series.blocks, ys);
}

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

/**
 * Project LiquiSabi coordinators into the simpler view model the UI uses.
 * Paid coordinators (CoordinationFeeRate > 0) are flagged so the UI can hide
 * or visually distinguish them - LiquiSabi's own `coords` method drops paid
 * coordinators entirely, so we match that default by treating them as "paid".
 */
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
      // Active coordinators first (descending by share), then inactive.
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
 * Sum of FreshInputsEstimateBtc across the most recent N graph entries.
 * Used by the hero "fresh inputs 24h" KPI.
 */
export function sumRecentFreshInputs(
  graph: LiquiSabiGraphEntry[],
  recentDays: number,
): number {
  if (!graph.length) return 0;
  const slice = graph.slice(-recentDays);
  return slice.reduce((acc, entry) => acc + (entry.Averages?.FreshInputsEstimateBtc ?? 0), 0);
}

/**
 * Sum of round counts across the most recent N graph entries. LiquiSabi's
 * Averages.RoundId field is overloaded as the "count of rounds in window"
 * (see LiquiSabiRpc.GetSummary in turbolay/LiquiSabi).
 */
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
