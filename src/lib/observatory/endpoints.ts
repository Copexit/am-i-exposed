/**
 * Sole source of truth for which URLs the observatory hits at runtime.
 *
 * Both go through the generic /svc/<id> route (worker on the public site,
 * tor-proxy sidecar when self-hosted).
 *
 * Decision is driven by NetworkContext.isUmbrel.
 */

import { serviceUrl } from "@/lib/services/route";

export interface ObservatoryEndpoints {
  whirlpoolBase: string;
  liquiSabiUrl: string;
}

export function getObservatoryEndpoints({
  isUmbrel,
}: {
  isUmbrel: boolean;
}): ObservatoryEndpoints {
  return {
    whirlpoolBase: serviceUrl("whirlpoolstats", "", { isUmbrel }),
    liquiSabiUrl: serviceUrl("liquisabi", "/api", { isUmbrel }),
  };
}
