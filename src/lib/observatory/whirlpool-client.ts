/**
 * whirlpool.observer client - Phase 1 surface.
 *
 * Only `summary` and `charts` are wrapped; the per-tx endpoints are reserved
 * for Phase 2 (recent-cycles table + contextual results card).
 */

import { getJson } from "./transport";
import { withObservatoryCache } from "./cache";
import type { WhirlpoolSummary, WhirlpoolCharts } from "./types";

export async function getWhirlpoolSummary(
  base: string,
  signal?: AbortSignal,
): Promise<WhirlpoolSummary> {
  return withObservatoryCache(
    `whirlpool:summary:${base}`,
    () => getJson<WhirlpoolSummary>(`${base}/summary`, { signal }),
  );
}

export async function getWhirlpoolCharts(
  base: string,
  signal?: AbortSignal,
): Promise<WhirlpoolCharts> {
  return withObservatoryCache(
    `whirlpool:charts:${base}`,
    () => getJson<WhirlpoolCharts>(`${base}/charts`, { signal }),
  );
}
