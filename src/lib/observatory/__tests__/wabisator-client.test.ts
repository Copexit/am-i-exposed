import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import flow1d from "./fixtures/wabisator/flow-map-1d.json";
import status from "./fixtures/wabisator/coordinators-status.json";
import volume from "./fixtures/wabisator/volume-history.json";
import rounds from "./fixtures/wabisator/rounds-kruw.json";

const cacheSpy = vi.hoisted(() => vi.fn());
vi.mock("../cache", () => ({ withObservatoryCache: (k: string, fn: () => Promise<unknown>, ttl: number) => { cacheSpy(k, ttl); return fn(); } }));
import { flowMapWindow, getFlowMap, getCoordinatorsStatus, getVolumeHistory, getRounds, REFRESH_MS } from "../wabisator-client";

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); });
const reply = (env: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(env), { status: 200 }));
const sent = () => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as { method: string; params: Record<string, unknown> } };
};

describe("wabisator client", () => {
  it("rounds the flow-map window to 5 minutes", () => {
    expect(flowMapWindow(1, 1_000_000_123)).toEqual({ until: 999_999_900, since: 999_913_500 });
    expect(flowMapWindow(30, 1_000_000_123).since).toBe(999_999_900 - 30 * 86400);
  });
  it("getFlowMap posts rounded params to the worker", async () => {
    reply(flow1d);
    const r = await getFlowMap(1, { isUmbrel: false, nowSec: 1_000_000_123 });
    const { url, body } = sent();
    expect(url.endsWith("/svc/wabisator/api.php")).toBe(true);
    expect(url.startsWith("https://")).toBe(true);
    expect(body).toMatchObject({ method: "flow-map", params: { until: 999_999_900, since: 999_913_500 } });
    expect(r.Coinjoins.length).toBeGreaterThan(0);
  });
  it("uses the tor-proxy sidecar on Umbrel", async () => {
    reply(status);
    const r = await getCoordinatorsStatus({ isUmbrel: true });
    expect(sent().url).toBe("/tor-proxy/svc/wabisator/api.php");
    expect(sent().body.method).toBe("coordinators-status");
    expect(r.Coordinators.length).toBeGreaterThan(0);
  });
  it("getVolumeHistory and getRounds send the right method and params", async () => {
    reply(volume);
    expect(Object.keys((await getVolumeHistory({ isUmbrel: false })).Coordinators).length).toBeGreaterThan(0);
    expect(sent().body.method).toBe("volume-history");
    fetchMock.mockClear();
    reply(rounds);
    expect((await getRounds("kruw", 2, { isUmbrel: false })).Rounds.length).toBeGreaterThan(0);
    expect(sent().body).toMatchObject({ method: "rounds-paginated", params: { coordinatorEndpoint: ["kruw"], page: 2, pageSize: 25 } });
  });
  it("flow-map cache key depends on the period only, not on nowSec; TTL is interval - 1000", async () => {
    reply(flow1d);
    await getFlowMap(7, { isUmbrel: false, nowSec: 1_000_000_123 });
    const [key, ttl] = cacheSpy.mock.calls.at(-1) as [string, number];
    reply(flow1d);
    await getFlowMap(7, { isUmbrel: false, nowSec: 1_000_000_123 + 3 * 86400 });
    expect(cacheSpy.mock.calls.at(-1)?.[0]).toBe(key);
    expect(key).toBe("wabisator:flow-map:7");
    expect(ttl).toBe(59_000);
    reply(flow1d);
    await getFlowMap(1, { isUmbrel: false, nowSec: 1_000_000_123 });
    expect(cacheSpy.mock.calls.at(-1)?.[0]).toBe("wabisator:flow-map:1");
  });
  it("refresh intervals match the spec", () => {
    expect(REFRESH_MS.flowMap).toEqual({ 1: 60_000, 7: 60_000, 30: 120_000 });
    expect([REFRESH_MS.status, REFRESH_MS.volume, REFRESH_MS.rounds]).toEqual([10_000, 600_000, 60_000]);
  });
});
