/**
 * Pure data shaping for the observatory UI.
 *
 * No fetch calls, no React, no side effects. Everything testable with literal
 * fixtures.
 */

import type {
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
    return xs.map((x, i) => ({ x, y: ys[i]! })); // same length, checked above
  }
  const bucket = xs.length / maxPoints;
  const out: SparklinePoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.min(xs.length, Math.floor((i + 1) * bucket));
    const x = xs[start];
    if (x === undefined) break;
    const bucketYs = ys.slice(start, end);
    const sum = bucketYs.reduce((acc, y) => acc + y, 0);
    out.push({ x, y: bucketYs.length > 0 ? sum / bucketYs.length : 0 });
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
  const lastBlock = blocks.at(-1);
  if (firstBlock === undefined || lastBlock === undefined) return null;
  // Need at least 30 days of data span to be meaningful.
  if (lastBlock - firstBlock < BLOCKS_PER_30D) return null;
  const targetBlock = lastBlock - BLOCKS_PER_30D;
  // Find the latest sample whose block height is <= targetBlock (i.e., the
  // "30 days ago" reference point). Linear scan is fine - charts are tiny
  // after downsampling.
  let startIdx = -1;
  for (const [i, block] of blocks.entries()) {
    if (block <= targetBlock) startIdx = i;
    else break;
  }
  if (startIdx === -1) return null;
  const keys = poolKey ? [poolKey] : Object.keys(charts.capacity.series ?? {});
  if (keys.length === 0) return null;
  let delta = 0;
  for (const k of keys) {
    const series = charts.capacity.series[k];
    const end = series?.at(-1);
    const start = series?.[startIdx];
    // Skip series too short to cover the 30d reference point
    if (end === undefined || start === undefined) continue;
    delta += end - start;
  }
  return delta;
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

/** Highest block height of each pool's cycles in a txs page (pool id -> block). */
export function lastCycleBlocks(page: WhirlpoolTxsPage | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const tx of page?.items ?? []) {
    if (!(tx.pool_name in out) || tx.block_height > out[tx.pool_name]!) {
      out[tx.pool_name] = tx.block_height;
    }
  }
  return out;
}
