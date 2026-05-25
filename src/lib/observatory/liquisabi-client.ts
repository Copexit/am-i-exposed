/**
 * liquisabi.com client - Phase 1 surface.
 *
 * Only the `dashboard` mega-method is wrapped; it already returns Summary,
 * Totals, PaginatedRounds, Graph and Coordinators in a single round trip.
 */

import { postJsonRpc } from "./transport";
import { withObservatoryCache } from "./cache";
import type { LiquiSabiDashboard } from "./types";

export async function getLiquiSabiDashboard(
  url: string,
  signal?: AbortSignal,
): Promise<LiquiSabiDashboard> {
  return withObservatoryCache(
    `liquisabi:dashboard:${url}`,
    () => postJsonRpc<LiquiSabiDashboard>(url, "dashboard", {}, { signal }),
  );
}
