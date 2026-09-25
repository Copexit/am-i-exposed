// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { StrictMode } from "react";
import { renderHook, act, cleanup } from "@testing-library/react";

type Route = { delay: number; status?: number; body: unknown };

/** fetch mock: routes by URL substring, resolves after `delay` ms, rejects on abort. */
function mockFetch(routes: Record<string, Route>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const route = Object.entries(routes).find(([k]) => url.includes(k))?.[1];
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
      const timer = setTimeout(() => {
        if (!route) return reject(new TypeError("network error"));
        const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
        resolve(new Response(body, { status: route.status ?? 200 }));
      }, route?.delay ?? 0);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const calledUrls = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls.map(([u]) => (typeof u === "string" ? u : u.toString()));

const UMBREL_ROUTES: Record<string, Route> = {
  "/api/local-info": { delay: 50, body: { mempoolPort: "3006", mempoolOnion: "", mempoolExternalUrl: "" } },
  "/api/blocks/tip/height": { delay: 20, body: "850000" },
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flush(ms = 1000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useTorDetection", () => {
  it("resolves to 'tor' under StrictMode double-mount (aborted probe is not reused)", async () => {
    mockFetch({ "tor-check": { delay: 10, body: { isTor: true } } });
    const { useTorDetection } = await import("../useTorDetection");
    const { result } = renderHook(() => useTorDetection(false), { reactStrictMode: true });
    await flush();
    expect(result.current).toBe("tor");
  });

  it("does not probe while deferred", async () => {
    const fetchFn = mockFetch({ "tor-check": { delay: 10, body: { isTor: false } } });
    const { useTorDetection } = await import("../useTorDetection");
    const { result } = renderHook(() => useTorDetection(false, true));
    await flush();
    expect(result.current).toBe("checking");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("useLocalApi", () => {
  it("an aborted StrictMode probe never caches a non-Umbrel result", async () => {
    mockFetch(UMBREL_ROUTES);
    const { useLocalApi } = await import("../useLocalApi");
    renderHook(() => useLocalApi(), { reactStrictMode: true });
    await flush(10);
    // A consumer mounting before the real probe finishes must not read a stale cache
    const late = renderHook(() => useLocalApi());
    expect(late.result.current.status).toBe("checking");
    await flush();
    expect(late.result.current.isUmbrel).toBe(true);
    expect(late.result.current.status).toBe("available");
  });
});

describe("NetworkProvider", () => {
  async function renderNetwork() {
    const { NetworkProvider, useNetwork } = await import("@/context/NetworkContext");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StrictMode><NetworkProvider>{children}</NetworkProvider></StrictMode>
    );
    return renderHook(() => useNetwork(), { wrapper });
  }

  it("never contacts the Tor check worker or the .onion probe on Umbrel", async () => {
    const fetchFn = mockFetch(UMBREL_ROUTES);
    const { result } = await renderNetwork();
    await flush(15_000);
    expect(result.current.isUmbrel).toBe(true);
    expect(result.current.torStatus).toBe("clearnet");
    const urls = calledUrls(fetchFn);
    expect(urls.some((u) => u.includes("tor-check") || u.includes(".onion"))).toBe(false);
  });

  it("runs Tor detection only after local API detection settles off Umbrel", async () => {
    const fetchFn = mockFetch({
      "/api/local-info": { delay: 50, status: 404, body: "not found" },
      "tor-check": { delay: 10, body: { isTor: false } },
    });
    const { result } = await renderNetwork();
    await flush(40);
    expect(calledUrls(fetchFn).some((u) => u.includes("tor-check"))).toBe(false);
    await flush(15_000);
    expect(calledUrls(fetchFn).some((u) => u.includes("tor-check"))).toBe(true);
    expect(result.current.isUmbrel).toBe(false);
  });

  it("pins the network to mainnet on Umbrel, ignoring ?network=", async () => {
    window.history.replaceState(null, "", "/?network=signet");
    mockFetch(UMBREL_ROUTES);
    const { result } = await renderNetwork();
    await flush();
    expect(result.current.network).toBe("mainnet");
    expect(result.current.config.mempoolBaseUrl).toBe("/api");
    act(() => result.current.setNetwork("testnet4"));
    expect(result.current.network).toBe("mainnet");
  });
});

describe("resolveNetworkConfig", () => {
  it("uses the onion endpoint for mainnet on Tor", async () => {
    const { resolveNetworkConfig } = await import("@/context/NetworkContext");
    const { NETWORK_CONFIG } = await import("@/lib/bitcoin/networks");
    const opts = { customUrl: null, isUmbrel: false, torStatus: "tor" as const, localApi: {} };
    expect(resolveNetworkConfig("mainnet", opts).mempoolBaseUrl).toBe(NETWORK_CONFIG.mainnet.mempoolOnionUrl);
    // No onion for testnets: clearnet URL
    expect(resolveNetworkConfig("signet", opts).mempoolBaseUrl).toBe(NETWORK_CONFIG.signet.mempoolBaseUrl);
  });
});
