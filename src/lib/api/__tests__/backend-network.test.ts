import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  _resetBackendChainsForTest,
  chainFromGenesis,
  chainFromHint,
  detectBackendChain,
  genesisCacheKey,
  knownBackendChain,
  type BackendChain,
  type ChainStore,
} from "../backend-network";
import { cacheKeyPrefix } from "../cache-policy";

// Bitcoin Core src/kernel/chainparams.cpp
const GENESIS = {
  mainnet: "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
  testnet3: "000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943",
  testnet4: "00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043",
  signet: "00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6",
  regtest: "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206",
} as const;

function memoryStore(init: Record<string, BackendChain> = {}): ChainStore & { data: Map<string, BackendChain> } {
  const data = new Map(Object.entries(init));
  return { data, get: async (k) => data.get(k), put: async (k, c) => { data.set(k, c); } };
}

function stubFetch(impl: (url: string) => Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL) => impl(String(input)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => _resetBackendChainsForTest());
afterEach(() => vi.unstubAllGlobals());

describe("chainFromGenesis", () => {
  it.each(Object.entries(GENESIS))("maps the %s genesis hash", (chain, hash) => {
    expect(chainFromGenesis(hash)).toBe(chain);
    expect(chainFromGenesis(`${hash.toUpperCase()}\n`)).toBe(chain);
  });

  it("an unknown block hash is an unknown chain; text that is not a hash is no answer", () => {
    expect(chainFromGenesis("ab".repeat(32))).toBe("unknown");
    expect(chainFromGenesis("<!doctype html>")).toBeNull();
    expect(chainFromGenesis("")).toBeNull();
  });
});

describe("chainFromHint", () => {
  it("maps Umbrel's APP_BITCOIN_NETWORK values", () => {
    expect(chainFromHint("mainnet")).toBe("mainnet");
    expect(chainFromHint("signet")).toBe("signet");
    expect(chainFromHint("testnet4")).toBe("testnet4");
    expect(chainFromHint("testnet")).toBe("testnet3");
    expect(chainFromHint("regtest")).toBe("regtest");
    expect(chainFromHint("")).toBeNull();
    expect(chainFromHint("${APP_BITCOIN_NETWORK}")).toBeNull();
    expect(chainFromHint(null)).toBeNull();
  });
});

describe("detectBackendChain", () => {
  it("asks {base}/block-height/0 once per backend and caches it in memory and the store", async () => {
    const fetchFn = stubFetch(async () => new Response(GENESIS.signet));
    const store = memoryStore();
    expect(await detectBackendChain("http://node.local:3006/api/", { store })).toBe("signet");
    expect(await detectBackendChain("http://node.local:3006/api", { store })).toBe("signet");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("http://node.local:3006/api/block-height/0");
    expect(store.data.get(genesisCacheKey("http://node.local:3006/api"))).toBe("signet");
    expect(knownBackendChain("http://node.local:3006/api")).toBe("signet");
  });

  it("a stored chain answers without a request", async () => {
    const fetchFn = stubFetch(async () => new Response(GENESIS.mainnet));
    const store = memoryStore({ [genesisCacheKey("http://n/api")]: "testnet4" });
    expect(await detectBackendChain("http://n/api", { store })).toBe("testnet4");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refresh re-asks the backend and overwrites both caches", async () => {
    stubFetch(async () => new Response(GENESIS.mainnet));
    const store = memoryStore({ [genesisCacheKey("http://n/api")]: "signet" });
    expect(await detectBackendChain("http://n/api", { store })).toBe("signet");
    expect(await detectBackendChain("http://n/api", { store, refresh: true })).toBe("mainnet");
    expect(store.data.get(genesisCacheKey("http://n/api"))).toBe("mainnet");
    expect(knownBackendChain("http://n/api")).toBe("mainnet");
  });

  it("falls back to null (nothing cached) on an HTTP error, a network error, a non-hash body or a timeout", async () => {
    const store = memoryStore();
    stubFetch(async () => new Response("nope", { status: 404 }));
    expect(await detectBackendChain("http://a/api", { store })).toBeNull();
    stubFetch(async () => { throw new TypeError("Failed to fetch"); });
    expect(await detectBackendChain("http://b/api", { store })).toBeNull();
    stubFetch(async () => new Response("<html></html>"));
    expect(await detectBackendChain("http://c/api", { store })).toBeNull();
    expect(store.data.size).toBe(0);
    expect(knownBackendChain("http://a/api")).toBeUndefined();

    vi.useFakeTimers();
    try {
      // A backend that never answers: only the timeout signal ends the request
      vi.stubGlobal("fetch", vi.fn((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_res, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
      })));
      const pending = detectBackendChain("http://slow/api");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the cache key prefix of a self-hosted backend carries its detected network", async () => {
    expect(cacheKeyPrefix("http://node.local/api")).toBe("mainnet@http://node.local/api");
    stubFetch(async () => new Response(GENESIS.signet));
    await detectBackendChain("http://node.local/api");
    expect(cacheKeyPrefix("http://node.local/api")).toBe("signet@http://node.local/api");
    // An explicit network still wins
    expect(cacheKeyPrefix("http://node.local/api", "testnet4")).toBe("testnet4@http://node.local/api");
  });
});
