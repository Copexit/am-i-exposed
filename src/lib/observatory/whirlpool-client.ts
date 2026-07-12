/**
 * whirlpoolstats.xyz client.
 *
 * `summary` and `charts` are cached page-load data; `txs` is the paginated
 * coinjoin-cycle history (only the first page is cached, later pages are
 * fetched on demand as the user paginates).
 */

import { getJson } from "./transport";
import { withObservatoryCache } from "./cache";
import type {
  WhirlpoolSummary,
  WhirlpoolCharts,
  WhirlpoolTxsPage,
} from "./types";

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

export async function getWhirlpoolTxs(
  base: string,
  page: number = 1,
  signal?: AbortSignal,
): Promise<WhirlpoolTxsPage> {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  return withObservatoryCache(
    `whirlpool:txs:${base}:${safePage}`,
    () => getJson<WhirlpoolTxsPage>(`${base}/txs?page=${safePage}`, { signal }),
  );
}
