import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../worker.js";
import { createSvc } from "../svc.js";

const env = { ALLOWED_ORIGIN: "https://am-i.exposed" };
const cacheStore = new Map();
// Models Cloudflare's Cache API, which ignores URL fragments.
const cacheKey = (req) => { const u = new URL(req.url); u.hash = ""; return u.href; };
globalThis.caches = { default: {
  async match(req) { return cacheStore.get(cacheKey(req)) ?? null; },
  async put(req, res) { cacheStore.set(cacheKey(req), res); },
} };
const ctx = { waitUntil: (p) => p };
const TX = "c575fb58fc4221882a281ceebe051131b2cc397f738156a93877c93639909cea";
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const post = (path, body) => handler.fetch(new Request(`https://w.dev${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://am-i.exposed" }, body: JSON.stringify(body),
}), env, ctx);

beforeEach(() => { cacheStore.clear(); vi.restoreAllMocks(); });

describe("/svc route", () => {
  it("forwards a lookup with normalized params, rebuilt body, no-store, no cache", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ jsonrpc: "2.0", id: 1, result: { Matches: [] } }));
    const res = await post("/svc/wabisator/api.php", { jsonrpc: "2.0", id: 7, method: "search", params: { query: TX.toUpperCase() }, extra: "x" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://am-i.exposed");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://wabisator.com/api.php");
    expect(JSON.parse(init.body)).toEqual({ jsonrpc: "2.0", id: 1, method: "search", params: { query: TX } });
    expect(cacheStore.size).toBe(0);
  });

  it("rejects lookups with bad or extra params", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    for (const params of [{ query: "nope" }, { query: TX, more: 1 }, {}, null]) {
      const res = await post("/svc/wabisator/api.php", { jsonrpc: "2.0", method: "search", params });
      expect(res.status).toBe(400);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects methods not in the registry", async () => {
    const res = await post("/svc/wabisator/api.php", { jsonrpc: "2.0", method: "graph", params: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("DISALLOWED");
  });

  it("caches aggregate RPC per method and params", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ jsonrpc: "2.0", id: 1, result: { a: 1 } }));
    await post("/svc/wabisator/api.php", { jsonrpc: "2.0", method: "dashboard", params: {} });
    const res = await post("/svc/wabisator/api.php", { jsonrpc: "2.0", method: "dashboard", params: {} });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("GET forwards only declared, validated query params", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ items: [] }));
    const res = await handler.fetch(new Request("https://w.dev/svc/whirlpoolstats/txs?page=0&evil=1"), env, ctx);
    expect(res.status).toBe(200);
    expect(f.mock.calls[0][0]).toBe("https://whirlpoolstats.xyz/api/txs?page=1");
  });

  it("404s unknown services and routes; 413 on huge bodies; 502 on upstream errors", async () => {
    expect((await handler.fetch(new Request("https://w.dev/svc/nope/x"), env, ctx)).status).toBe(404);
    expect((await handler.fetch(new Request("https://w.dev/svc/whirlpoolstats/admin"), env, ctx)).status).toBe(404);
    const big = await post("/svc/wabisator/api.php", { jsonrpc: "2.0", method: "dashboard", params: { pad: "x".repeat(70_000) } });
    expect(big.status).toBe(413);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));
    const bad = await post("/svc/wabisator/api.php", { jsonrpc: "2.0", method: "search", params: { query: TX } });
    expect(bad.status).toBe(502);
    expect(bad.headers.get("Cache-Control")).toBe("no-store");
  });

  it("legacy routes still answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ pools: [] }));
    expect((await handler.fetch(new Request("https://w.dev/whirlpool/summary"), env, ctx)).status).toBe(200);
  });
});

describe("fail-closed class handling", () => {
  const fake = { services: [{ id: "x", base: "https://x.dev", routes: [
    { path: "/rpc", http: "POST", rpc: { typo: { class: "lookpu", ttl: 60, params: { query: "txid" } }, none: {} } },
    { path: "/get", http: "GET" },
  ] }] };
  const svc = createSvc(fake);
  const call = (path, init) => svc(new Request(`https://w.dev${path}`, init), new URL(`https://w.dev${path}`), ctx, {});

  it("500s unknown or missing class without fetching or caching", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    for (const method of ["typo", "none"]) {
      const res = await call("/svc/x/rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method, params: { query: TX } }) });
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe("MISCONFIGURED");
    }
    expect((await call("/svc/x/get", { method: "GET" })).status).toBe(500);
    expect(f).not.toHaveBeenCalled();
    expect(cacheStore.size).toBe(0);
  });
});

describe("aggregate cache key", () => {
  const svc = createSvc({ services: [{ id: "a", base: "https://a.dev", routes: [
    { path: "/rpc", http: "POST", rpc: { one: { class: "aggregate", ttl: 60 }, two: { class: "aggregate", ttl: 60 } } },
  ] }] });
  const call = (method) => svc(new Request("https://w.dev/svc/a/rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method, params: {} }) }),
    new URL("https://w.dev/svc/a/rpc"), ctx, {});

  it("keeps different methods on the same path in separate cache entries", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok({ result: 1 }));
    await call("one");
    await call("two");
    await call("one");
    expect(f).toHaveBeenCalledTimes(2);
    expect(cacheStore.size).toBe(2);
  });
});

describe("GET query validation", () => {
  const svc = createSvc({ services: [{ id: "q", base: "https://q.dev", routes: [
    { path: "/g", http: "GET", class: "lookup", query: { tx: "txid" } },
  ] }] });
  it("400s an invalid txid query value without fetching", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const url = "https://w.dev/svc/q/g?tx=zz";
    const res = await svc(new Request(url), new URL(url), ctx, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_PARAMS");
    expect(f).not.toHaveBeenCalled();
  });
});
