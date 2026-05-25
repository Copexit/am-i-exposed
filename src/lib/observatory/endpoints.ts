/**
 * Sole source of truth for which URLs the observatory hits at runtime.
 *
 * - Hosted (public site): a Cloudflare Worker reverse-proxies both upstreams,
 *   adding CORS and edge caching.
 * - Self-hosted (Umbrel/StartOS): the existing tor-proxy sidecar forwards
 *   the same paths through Tor SOCKS5h.
 *
 * Decision is driven by NetworkContext.isUmbrel.
 */

const WORKER_BASE = "https://coinjoin-stats.copexit.workers.dev";
const UMBREL_BASE = "/tor-proxy/observatory";

export interface ObservatoryEndpoints {
  whirlpoolBase: string;
  liquiSabiUrl: string;
}

export function getObservatoryEndpoints({
  isUmbrel,
}: {
  isUmbrel: boolean;
}): ObservatoryEndpoints {
  if (isUmbrel) {
    return {
      whirlpoolBase: `${UMBREL_BASE}/whirlpool`,
      liquiSabiUrl: `${UMBREL_BASE}/liquisabi/api`,
    };
  }
  return {
    whirlpoolBase: `${WORKER_BASE}/whirlpool`,
    liquiSabiUrl: `${WORKER_BASE}/liquisabi/api`,
  };
}
