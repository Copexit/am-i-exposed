/**
 * Sole source of truth for which URLs the Whirlpool tab hits at runtime
 * (WabiSabi data goes through serviceRpc, see wabisator-client.ts).
 *
 * Whirlpool goes through the generic /svc/<id> route (worker on the public site,
 * tor-proxy sidecar when self-hosted).
 *
 * Decision is driven by NetworkContext.isUmbrel.
 */

import { serviceUrl } from "@/lib/services/route";

export interface ObservatoryEndpoints {
  whirlpoolBase: string;
}

export function getObservatoryEndpoints({
  isUmbrel,
}: {
  isUmbrel: boolean;
}): ObservatoryEndpoints {
  return {
    whirlpoolBase: serviceUrl("whirlpoolstats", "", { isUmbrel }),
  };
}
