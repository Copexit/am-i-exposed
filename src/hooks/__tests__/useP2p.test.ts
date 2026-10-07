// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import {
  NOW, robosatsOrders, mostroOrders, mostroInfo, templeInfo, lakeInfo, templeLimits, hodl0, hodl500,
} from "@/lib/observatory/p2p/__tests__/fixtures";
import type { NostrSnapshot } from "@/lib/observatory/p2p/types";

vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ isUmbrel: false, routeReady: true }) }));
vi.mock("@/lib/observatory/cache", () => ({ withObservatoryCache: (_k: string, fn: () => Promise<unknown>) => fn() }));
// The redacted fixtures no longer verify; signature checks are covered in nostr-verify.test.ts.
vi.mock("@/lib/observatory/p2p/nostr-verify", async (orig) => ({
  ...(await orig<typeof import("@/lib/observatory/p2p/nostr-verify")>()),
  verifyEvent: () => true,
  verifySnapshot: (s: NostrSnapshot) => ({ events: s.events, rejected: 0 }),
}));
import { useP2p } from "../useP2p";

const allEose = (s: NostrSnapshot): NostrSnapshot => ({ ...s, relays: s.relays.map((r) => ({ ...r, status: "eose" as const })) });

function serve(overrides: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    "/svc/robosats-nostr/orders": allEose(robosatsOrders),
    "/svc/mostro-nostr/orders": mostroOrders,
    "/svc/mostro-nostr/info": mostroInfo,
    "/svc/robosats-temple/api/info/": templeInfo,
    "/svc/robosats-lake/api/info/": lakeInfo,
    "/svc/robosats-temple/api/limits/": templeLimits,
    ...overrides,
  };
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    calls.push(u);
    const url = new URL(u);
    const body = url.pathname.endsWith("/svc/hodlhodl/api/v1/offers")
      ? routes.hodlhodl ?? (Number(url.searchParams.get("pagination[offset]")) >= 500 ? hodl500 : hodl0)
      : routes[url.pathname.replace(/^\/tor-proxy/, "")];
    if (body === undefined || body === "fail") return { ok: false, status: 502, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => structuredClone(body) };
  }));
  return calls;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], now: NOW * 1000 }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useP2p", () => {
  it("composes offers from all three venues into markets with every source ok", async () => {
    const calls = serve();
    const { result } = renderHook(() => useP2p());
    await waitFor(() => expect(result.current.sources.every((s) => s.state !== "loading")).toBe(true));
    const venues = new Set(result.current.offers.map((o) => o.venue));
    expect([...venues].sort()).toEqual(["hodlhodl", "mostro", "robosats"]);
    expect(result.current.markets.get("EUR")).toBeDefined();
    expect(result.current.sources.map((s) => [s.id, s.state])).toEqual([["robosats", "ok"], ["mostro", "ok"], ["hodlhodl", "ok"], ["index", "ok"]]);
    expect(result.current.hosts.find((h) => h.key === "temple")!.status).toBe("up");
    expect(result.current.hosts.find((h) => h.key === "bazaar")!.status).toBe("unknown");
    expect(calls.some((u) => /robosats-(bazaar|alice|eleuteria|freeport|ammanaya)/.test(u))).toBe(false);
  });

  it("a failing HodlHodl route is down while the others stay ok", async () => {
    serve({ hodlhodl: "fail" });
    const { result } = renderHook(() => useP2p());
    await waitFor(() => expect(result.current.sources.find((s) => s.id === "hodlhodl")!.state).toBe("down"));
    await waitFor(() => expect(result.current.sources.find((s) => s.id === "robosats")!.state).toBe("ok"));
    expect(result.current.sources.find((s) => s.id === "mostro")!.state).toBe("ok");
    expect(result.current.offers.some((o) => o.venue === "hodlhodl")).toBe(false);
    expect(result.current.offers.some((o) => o.venue === "mostro")).toBe(true);
  });

  it("a timed-out relay makes the source partial and names it", async () => {
    const partial = { ...mostroOrders, relays: [{ url: "wss://relay.mostro.network", status: "eose" }, { url: "wss://nos.lol", status: "timeout" }] };
    serve({ "/svc/mostro-nostr/orders": partial });
    const { result } = renderHook(() => useP2p());
    await waitFor(() => expect(result.current.sources.find((s) => s.id === "mostro")!.state).toBe("partial"));
    expect(result.current.sources.find((s) => s.id === "mostro")!.detail).toContain("wss://nos.lol");
  });

  it("without the index, declared premiums remain and the index source is down", async () => {
    serve({ "/svc/robosats-temple/api/limits/": "fail" });
    const { result } = renderHook(() => useP2p());
    await waitFor(() => expect(result.current.sources.find((s) => s.id === "index")!.state).toBe("down"));
    await waitFor(() => expect(result.current.offers.length).toBeGreaterThan(100));
    expect(result.current.index).toBeNull();
    expect(result.current.offers.some((o) => o.venue === "robosats" && o.premium !== null)).toBe(true);
  });
});
