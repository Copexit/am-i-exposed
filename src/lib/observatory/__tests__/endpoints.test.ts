import { describe, it, expect } from "vitest";
import { getObservatoryEndpoints } from "../endpoints";

describe("getObservatoryEndpoints", () => {
  it("returns Cloudflare Worker URLs on hosted/public deployments", () => {
    const ep = getObservatoryEndpoints({ isUmbrel: false });
    expect(ep.whirlpoolBase).toBe(
      "https://coinjoin-stats.copexit.workers.dev/whirlpool",
    );
    expect(ep.liquiSabiUrl).toBe(
      "https://coinjoin-stats.copexit.workers.dev/liquisabi/api",
    );
  });

  it("returns same-origin /tor-proxy paths on Umbrel", () => {
    const ep = getObservatoryEndpoints({ isUmbrel: true });
    expect(ep.whirlpoolBase).toBe("/tor-proxy/observatory/whirlpool");
    expect(ep.liquiSabiUrl).toBe("/tor-proxy/observatory/liquisabi/api");
  });
});
