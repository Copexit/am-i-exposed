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

const GENESIS = {
  mainnet: "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
  testnet3: "000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943",
  testnet4: "00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043",
  signet: "00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6",
  regtest: "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206",
};

const UMBREL_ROUTES: Record<string, Route> = {
  "/api/local-info": { delay: 50, body: { mempoolPort: "3006", mempoolOnion: "", mempoolExternalUrl: "" } },
  "/api/blocks/tip/height": { delay: 20, body: "850000" },
  "/api/block-height/0": { delay: 20, body: GENESIS.mainnet },
};

/** An Umbrel whose node serves the chain behind `genesis` (and reports `hint` in local-info). */
const umbrelOn = (genesis: string | null, hint = ""): Record<string, Route> => ({
  ...UMBREL_ROUTES,
  "/api/local-info": { delay: 50, body: { mempoolPort: "3006", mempoolOnion: "", mempoolExternalUrl: "", bitcoinNetwork: hint } },
  "/api/block-height/0": genesis ? { delay: 20, body: genesis } : { delay: 20, status: 404, body: "Not found" },
});

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

  it("goes back to 'checking' (not 'clearnet') while probing after skip turns off", async () => {
    mockFetch({ "tor-check": { delay: 3000, body: { isTor: true } } });
    const { useTorDetection } = await import("../useTorDetection");
    const { result, rerender } = renderHook(({ skip }) => useTorDetection(skip), { initialProps: { skip: true } });
    expect(result.current).toBe("clearnet");
    rerender({ skip: false });
    await flush(100);
    expect(result.current).toBe("checking");
    await flush(5000);
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

  it("routeReady on Umbrel never reports a non-Umbrel route first", async () => {
    mockFetch(UMBREL_ROUTES);
    const { NetworkProvider, useNetwork } = await import("@/context/NetworkContext");
    const seen: { routeReady: boolean; isUmbrel: boolean }[] = [];
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StrictMode><NetworkProvider>{children}</NetworkProvider></StrictMode>
    );
    renderHook(() => { const n = useNetwork(); seen.push({ routeReady: n.routeReady, isUmbrel: n.isUmbrel }); }, { wrapper });
    await flush(15_000);
    expect(seen.some((s) => s.routeReady)).toBe(true);
    expect(seen.filter((s) => s.routeReady).every((s) => s.isUmbrel)).toBe(true);
  });

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

  it("apiReady waits for both the local API probe and Tor detection", async () => {
    mockFetch({
      "/api/local-info": { delay: 50, status: 404, body: "not found" },
      "tor-check": { delay: 500, body: { isTor: true } },
    });
    const { result } = await renderNetwork();
    expect(result.current.apiReady).toBe(false);
    expect(result.current.routeReady).toBe(false);
    await flush(100); // local probe settled, Tor still checking
    expect(result.current.localApiStatus).not.toBe("checking");
    expect(result.current.apiReady).toBe(false);
    expect(result.current.routeReady).toBe(true); // Observatory routing does not wait for Tor
    expect(result.current.isUmbrel).toBe(false);
    await flush(15_000);
    expect(result.current.torStatus).toBe("tor");
    expect(result.current.apiReady).toBe(true);
  });

  it("skips Tor detection when a custom API (own node) is set", async () => {
    localStorage.setItem("ami-custom-api-url", "http://localhost:3006/api");
    const fetchFn = mockFetch({ "/api/local-info": { delay: 50, status: 404, body: "not found" } });
    const { result } = await renderNetwork();
    await flush(15_000);
    expect(result.current.torStatus).not.toBe("checking");
    const urls = calledUrls(fetchFn);
    expect(urls.some((u) => u.includes("tor-check") || u.includes(".onion"))).toBe(false);
  });

  it("chain tip on Umbrel only queries the node, never public mempool.space", async () => {
    const fetchFn = mockFetch(UMBREL_ROUTES);
    const { NetworkProvider } = await import("@/context/NetworkContext");
    const { useChainTip } = await import("../useChainTip");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StrictMode><NetworkProvider>{children}</NetworkProvider></StrictMode>
    );
    const { result } = renderHook(() => useChainTip(), { wrapper });
    await flush(15_000);
    await flush();
    expect(result.current).toBe(850000);
    expect(calledUrls(fetchFn).some((u) => u.includes("mempool.space"))).toBe(false);
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

  it("isCustomApi: false on Tor (the onion endpoint is mempool.space), true for a custom URL and on Umbrel", async () => {
    const offUmbrel = { "/api/local-info": { delay: 5, status: 404, body: "not found" } };
    mockFetch({ ...offUmbrel, "tor-check": { delay: 5, body: { isTor: true } } });
    const tor = await renderNetwork();
    await flush();
    await flush(15_000);
    expect(tor.result.current.torStatus).toBe("tor");
    expect(tor.result.current.config.mempoolBaseUrl).toContain(".onion");
    expect(tor.result.current.isCustomApi).toBe(false);
    act(() => tor.result.current.setCustomApiUrl("https://node.local/api"));
    expect(tor.result.current.isCustomApi).toBe(true);
    act(() => tor.result.current.setCustomApiUrl(null));
    cleanup();

    vi.resetModules();
    mockFetch(UMBREL_ROUTES);
    const umbrel = await renderNetwork();
    await flush();
    expect(umbrel.result.current.isUmbrel).toBe(true);
    expect(umbrel.result.current.isCustomApi).toBe(true);
  });
});

describe("NetworkProvider backend network (genesis check)", () => {
  async function renderNetwork() {
    const { NetworkProvider, useNetwork } = await import("@/context/NetworkContext");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StrictMode><NetworkProvider>{children}</NetworkProvider></StrictMode>
    );
    return renderHook(() => useNetwork(), { wrapper });
  }

  it("mainnet Umbrel: mainnet, pinned, same /api routing as before", async () => {
    mockFetch(umbrelOn(GENESIS.mainnet));
    const { result } = await renderNetwork();
    await flush();
    expect(result.current.network).toBe("mainnet");
    expect(result.current.networkPinned).toBe(true);
    expect(result.current.unsupportedChain).toBeNull();
    expect(result.current.config.mempoolBaseUrl).toBe("/api");
    expect(result.current.apiReady).toBe(true);
  });

  it.each(["signet", "testnet4"] as const)("%s Umbrel: the node's network, ?network= and setNetwork for others ignored", async (chain) => {
    window.history.replaceState(null, "", "/?network=mainnet");
    mockFetch(umbrelOn(GENESIS[chain]));
    const { result } = await renderNetwork();
    await flush();
    expect(result.current.network).toBe(chain);
    expect(result.current.config.mempoolBaseUrl).toBe("/api");
    act(() => result.current.setNetwork("mainnet"));
    expect(result.current.network).toBe(chain);
    const { cacheKeyPrefix } = await import("@/lib/api/cache-policy");
    expect(cacheKeyPrefix("/api")).toBe(`${chain}@/api`);
  });

  it.each(["testnet3", "regtest"] as const)("%s Umbrel: reported as unsupported, not treated as a supported network", async (chain) => {
    mockFetch(umbrelOn(GENESIS[chain]));
    const { result } = await renderNetwork();
    await flush();
    expect(result.current.unsupportedChain).toBe(chain);
    expect(result.current.networkPinned).toBe(true);
  });

  it("Umbrel with an unknown genesis (custom chain): unsupported 'unknown'", async () => {
    mockFetch(umbrelOn("ab".repeat(32)));
    const { result } = await renderNetwork();
    await flush();
    expect(result.current.unsupportedChain).toBe("unknown");
  });

  it("Umbrel whose node cannot be asked: the local-info hint, else mainnet", async () => {
    mockFetch(umbrelOn(null, "signet"));
    const hinted = await renderNetwork();
    await flush();
    expect(hinted.result.current.network).toBe("signet");
    expect(hinted.result.current.localApiStatus).toBe("available"); // tip height still answered
    cleanup();

    vi.resetModules();
    mockFetch(umbrelOn(null));
    const bare = await renderNetwork();
    await flush();
    expect(bare.result.current.network).toBe("mainnet");
    expect(bare.result.current.unsupportedChain).toBeNull();
  });

  it("custom URL: the network its backend reports, used for config and the cache key", async () => {
    localStorage.setItem("ami-custom-api-url", "http://node.local:3006/api");
    const fetchFn = mockFetch({
      "/api/local-info": { delay: 5, status: 404, body: "not found" },
      "node.local:3006/api/block-height/0": { delay: 20, body: GENESIS.signet },
    });
    const { result } = await renderNetwork();
    expect(result.current.apiReady).toBe(false);
    await flush();
    expect(result.current.backendChain).toBe("signet");
    expect(result.current.network).toBe("signet");
    expect(result.current.networkPinned).toBe(true);
    expect(result.current.apiReady).toBe(true);
    expect(result.current.config.mempoolBaseUrl).toBe("http://node.local:3006/api");
    act(() => result.current.setNetwork("mainnet"));
    expect(result.current.network).toBe("signet");
    const { cacheKeyPrefix } = await import("@/lib/api/cache-policy");
    expect(cacheKeyPrefix("http://node.local:3006/api")).toBe("signet@http://node.local:3006/api");
    // Only the custom backend was asked
    expect(calledUrls(fetchFn).some((u) => u.includes("mempool.space"))).toBe(false);
  });

  it("custom URL that cannot be asked: keeps the selected network, not pinned", async () => {
    localStorage.setItem("ami-custom-api-url", "http://node.local:3006/api");
    window.history.replaceState(null, "", "/?network=testnet4");
    mockFetch({ "/api/local-info": { delay: 5, status: 404, body: "not found" } });
    const { result } = await renderNetwork();
    await flush(15_000);
    expect(result.current.backendChain).toBeNull();
    expect(result.current.network).toBe("testnet4");
    expect(result.current.networkPinned).toBe(false);
    expect(result.current.apiReady).toBe(true);
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
