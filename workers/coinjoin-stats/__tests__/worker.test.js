import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../worker.js";

const env = { ALLOWED_ORIGIN: "https://am-i.exposed" };

// Stub the edge cache (caches.default) - the worker calls cache.match/put.
const cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(req) {
      return cacheStore.get(req.url) ?? null;
    },
    async put(req, res) {
      cacheStore.set(req.url, res);
    },
  },
};

const ctx = { waitUntil: (p) => p };

const SUMMARY = { title: "Whirlpool.Observer", is_synced: true, pools: [{}, {}] };
const CHARTS = { capacity: { blocks: [1], series: { "0.025_BTC_Pool": [1] } } };
const TXS = { items: [{ txid: "a" }], page: 1, per_page: 25, total: 1, total_pages: 1 };

beforeEach(() => {
  cacheStore.clear();
  vi.restoreAllMocks();
});

function withFetchMock(response) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("coinjoin-stats worker", () => {
  it("responds to CORS preflight", async () => {
    const res = await handler.fetch(
      new Request("https://w.dev/whirlpool/summary", { method: "OPTIONS" }),
      env,
      ctx,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://am-i.exposed",
    );
  });

  it("404s unknown paths", async () => {
    const res = await handler.fetch(
      new Request("https://w.dev/nope", { method: "GET" }),
      env,
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it("405s POST to a GET-only path", async () => {
    const res = await handler.fetch(
      new Request("https://w.dev/whirlpool/summary", { method: "POST" }),
      env,
      ctx,
    );
    expect(res.status).toBe(405);
  });

  it("passes through whirlpoolstats.xyz/api/summary JSON with 60s cache", async () => {
    const spy = withFetchMock(jsonResponse(SUMMARY));
    const res = await handler.fetch(
      new Request("https://w.dev/whirlpool/summary", { method: "GET" }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://am-i.exposed",
    );
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(spy).toHaveBeenCalledWith(
      "https://whirlpoolstats.xyz/api/summary",
      expect.any(Object),
    );
    const body = await res.json();
    expect(body.title).toBe("Whirlpool.Observer");
    expect(body.pools).toHaveLength(2);
  });

  it("passes through /api/charts JSON with 120s cache", async () => {
    const spy = withFetchMock(jsonResponse(CHARTS));
    const res = await handler.fetch(
      new Request("https://w.dev/whirlpool/charts", { method: "GET" }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=120");
    expect(spy).toHaveBeenCalledWith(
      "https://whirlpoolstats.xyz/api/charts",
      expect.any(Object),
    );
    const body = await res.json();
    expect(body.capacity.series["0.025_BTC_Pool"]).toEqual([1]);
  });

  it("forwards the page query on /whirlpool/txs", async () => {
    const spy = withFetchMock(jsonResponse(TXS));
    const res = await handler.fetch(
      new Request("https://w.dev/whirlpool/txs?page=3", { method: "GET" }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(spy).toHaveBeenCalledWith(
      "https://whirlpoolstats.xyz/api/txs?page=3",
      expect.any(Object),
    );
  });

  it("caches txs per page (page 2 is not served page 1's body)", async () => {
    // Fresh Response per call - a single reused Response would lock its body
    // stream on the second upstream read.
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse(TXS));
    // Page 1 and page 2 must each hit the upstream (distinct cache keys)...
    await handler.fetch(
      new Request("https://w.dev/whirlpool/txs?page=1", { method: "GET" }),
      env,
      ctx,
    );
    await handler.fetch(
      new Request("https://w.dev/whirlpool/txs?page=2", { method: "GET" }),
      env,
      ctx,
    );
    expect(spy).toHaveBeenCalledTimes(2);
    // ...and a repeat of page 1 is served from cache (no third fetch).
    await handler.fetch(
      new Request("https://w.dev/whirlpool/txs?page=1", { method: "GET" }),
      env,
      ctx,
    );
    expect(spy).toHaveBeenCalledTimes(2);
    const urls = spy.mock.calls.map((c) => c[0]);
    expect(urls).toContain("https://whirlpoolstats.xyz/api/txs?page=1");
    expect(urls).toContain("https://whirlpoolstats.xyz/api/txs?page=2");
  });

  it("clamps a bad page to 1", async () => {
    const spy = withFetchMock(jsonResponse(TXS));
    await handler.fetch(
      new Request("https://w.dev/whirlpool/txs?page=-5", { method: "GET" }),
      env,
      ctx,
    );
    expect(spy).toHaveBeenCalledWith(
      "https://whirlpoolstats.xyz/api/txs?page=1",
      expect.any(Object),
    );
  });

  it("returns 502 UPSTREAM_DOWN when upstream fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const res = await handler.fetch(
      new Request("https://w.dev/whirlpool/summary", { method: "GET" }),
      env,
      ctx,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error?.code).toBe("UPSTREAM_DOWN");
  });

  it("returns 502 UPSTREAM_HTTP when upstream responds non-2xx", async () => {
    withFetchMock(new Response("nope", { status: 503 }));
    const res = await handler.fetch(
      new Request("https://w.dev/whirlpool/charts", { method: "GET" }),
      env,
      ctx,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error?.code).toBe("UPSTREAM_HTTP");
  });

  it("accepts liquisabi dashboard POST and forwards to upstream", async () => {
    const spy = withFetchMock(
      jsonResponse({ jsonrpc: "2.0", id: 1, result: { Coordinators: [] } }),
    );
    const res = await handler.fetch(
      new Request("https://w.dev/liquisabi/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "dashboard", id: 1 }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      "https://liquisabi.com/api",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(spy.mock.calls[0][1].body);
    expect(body.method).toBe("dashboard");
  });

  it("rejects liquisabi POST with disallowed method", async () => {
    withFetchMock(jsonResponse({}));
    const res = await handler.fetch(
      new Request("https://w.dev/liquisabi/api", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "rounds", id: 1 }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("rejects liquisabi POST with missing jsonrpc version", async () => {
    const res = await handler.fetch(
      new Request("https://w.dev/liquisabi/api", {
        method: "POST",
        body: JSON.stringify({ method: "dashboard", id: 1 }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("rejects liquisabi POST with non-JSON body", async () => {
    const res = await handler.fetch(
      new Request("https://w.dev/liquisabi/api", {
        method: "POST",
        body: "not json",
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("serves the second whirlpool request from edge cache", async () => {
    const spy = withFetchMock(jsonResponse(SUMMARY));
    await handler.fetch(
      new Request("https://w.dev/whirlpool/summary", { method: "GET" }),
      env,
      ctx,
    );
    await handler.fetch(
      new Request("https://w.dev/whirlpool/summary", { method: "GET" }),
      env,
      ctx,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
