import { describe, it, expect } from "vitest";
import { getObservatoryEndpoints } from "../endpoints";

describe("getObservatoryEndpoints", () => {
  it("returns Cloudflare Worker URLs on hosted/public deployments", () => {
    const ep = getObservatoryEndpoints({ isUmbrel: false });
    expect(ep.whirlpoolBase).toBe(
      "https://coinjoin-stats.copexit.workers.dev/svc/whirlpoolstats",
    );
  });

  it("returns same-origin /tor-proxy paths on Umbrel", () => {
    const ep = getObservatoryEndpoints({ isUmbrel: true });
    expect(ep.whirlpoolBase).toBe("/tor-proxy/svc/whirlpoolstats");
  });
});
