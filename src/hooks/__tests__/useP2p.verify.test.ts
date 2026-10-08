// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { NOW, signedSample, mostroInfo, templeInfo, lakeInfo, templeLimits, hodl0 } from "@/lib/observatory/p2p/__tests__/fixtures";
import { tag } from "@/lib/observatory/p2p/nostr-verify";

vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ isUmbrel: false, routeReady: true }) }));
vi.mock("@/lib/observatory/cache", () => ({ withObservatoryCache: (_k: string, fn: () => Promise<unknown>) => fn() }));
import { useP2p } from "../useP2p";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useP2p signature checks (no mocks)", () => {
  it("a forged order in a snapshot never reaches the book and is counted", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW * 1000 + 60_000 });
    const robo = signedSample.events.filter((e) => tag(e, "y")?.[0] === "robosats");
    const victim = robo.find((e) => tag(e, "f")?.[0] === "EUR")!;
    // Same signature, premium rewritten: the id no longer matches.
    const forged = { ...victim, tags: victim.tags.map((t) => (t[0] === "premium" ? ["premium", "-30"] : t)) };
    const snapshot = { events: [...robo.filter((e) => e !== victim), forged], relays: [{ url: "wss://r", status: "eose" }], fetchedAt: NOW };
    const routes: Record<string, unknown> = {
      "/svc/robosats-nostr/orders": snapshot,
      "/svc/mostro-nostr/orders": { ...signedSample, relays: [{ url: "wss://r", status: "eose" }] },
      "/svc/mostro-nostr/info": mostroInfo,
      "/svc/robosats-temple/api/info/": templeInfo,
      "/svc/robosats-lake/api/info/": lakeInfo,
      "/svc/robosats-temple/api/limits/": templeLimits,
      "/svc/hodlhodl/api/v1/offers": { ...hodl0, offers: [] },
    };
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      const body = routes[new URL(u).pathname];
      return body ? { ok: true, status: 200, json: async () => structuredClone(body) } : { ok: false, status: 404, json: async () => ({}) };
    }));
    const { result } = renderHook(() => useP2p());
    await waitFor(() => expect(result.current.sources.find((s) => s.id === "robosats")!.state).not.toBe("loading"), { timeout: 10_000 });
    const rs = result.current.offers.filter((o) => o.venue === "robosats");
    expect(rs.length).toBe(robo.length - 1);
    expect(rs.some((o) => o.id.endsWith(tag(victim, "d")![0]!))).toBe(false);
    expect(result.current.sources.find((s) => s.id === "robosats")!.rejected).toBe(1);
    expect(result.current.offers.some((o) => o.venue === "mostro")).toBe(true);
  });
});
