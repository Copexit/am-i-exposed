import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hodl0, hodl500, templeLimits, mostroOrders, templeInfo } from "./fixtures";

vi.mock("../../cache", () => ({ withObservatoryCache: (_k: string, fn: () => Promise<unknown>) => fn() }));
import { getNostr, getRoboInfo, getRoboLimits, getHodlhodl, reachableRobosats, getRoboHistorical } from "../p2p-client";

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

describe("p2p client", () => {
  it("nostr snapshots go to the worker on the public site", async () => {
    fetchMock.mockResolvedValueOnce(json(mostroOrders));
    const s = await getNostr("mostro-nostr", "/orders", { isUmbrel: false });
    expect(urls()).toEqual(["https://coinjoin-stats.copexit.workers.dev/svc/mostro-nostr/orders"]);
    expect(s.events.length).toBe(mostroOrders.events.length);
  });

  it("self-hosted reaches onion-only coordinators through the sidecar", async () => {
    fetchMock.mockResolvedValueOnce(json(templeInfo));
    await getRoboInfo("robosats-bazaar", { isUmbrel: true });
    expect(urls()).toEqual(["/tor-proxy/svc/robosats-bazaar/api/info/"]);
  });

  it("the public site never requests an onion-only coordinator", async () => {
    expect(reachableRobosats(false)).toEqual(["robosats-temple", "robosats-lake"]);
    expect(reachableRobosats(true)).toHaveLength(7);
    await expect(getRoboInfo("robosats-bazaar", { isUmbrel: false })).rejects.toThrow();
    await expect(getRoboHistorical("robosats-freeport", { isUmbrel: false })).rejects.toThrow();
    fetchMock.mockResolvedValue(json({}, 502));
    await expect(getRoboLimits({ isUmbrel: false })).rejects.toThrow();
    expect(urls().some((u) => /robosats-(bazaar|alice|eleuteria|freeport|ammanaya)/.test(u))).toBe(false);
  });

  it("limits fall back to lake when temple fails", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: {} }, 502)).mockResolvedValueOnce(json(templeLimits));
    const idx = await getRoboLimits({ isUmbrel: false });
    expect(urls()).toEqual([
      "https://coinjoin-stats.copexit.workers.dev/svc/robosats-temple/api/limits/",
      "https://coinjoin-stats.copexit.workers.dev/svc/robosats-lake/api/limits/",
    ]);
    expect(idx.source).toBe("TheBigLake (RoboSats)");
    expect(idx.prices.USD).toBe(82905.69);
  });

  it("HodlHodl pages two at a time and stops at the short page", async () => {
    fetchMock.mockImplementation(async (u: string) => {
      const off = Number(new URL(u).searchParams.get("pagination[offset]"));
      return json(off >= 500 ? hodl500 : hodl0);
    });
    const pages = await getHodlhodl({ isUmbrel: false });
    expect(pages).toHaveLength(6);
    expect(urls().map((u) => new URL(u).searchParams.get("pagination[offset]"))).toEqual(["0", "100", "200", "300", "400", "500"]);
    expect(urls().every((u) => u.startsWith("https://coinjoin-stats.copexit.workers.dev/svc/hodlhodl/api/v1/offers?"))).toBe(true);
  });
});
