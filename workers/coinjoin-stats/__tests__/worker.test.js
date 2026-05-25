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

  it("forwards whirlpool/summary and sets CORS + cache headers", async () => {
    const spy = withFetchMock(jsonResponse({ tip_height: 123 }));
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
      "https://whirlpool.observer/api/summary",
      expect.any(Object),
    );
    expect(await res.json()).toEqual({ tip_height: 123 });
  });

  it("forwards whirlpool/charts with 120s cache", async () => {
    withFetchMock(jsonResponse({}));
    const res = await handler.fetch(
      new Request("https://w.dev/whirlpool/charts", { method: "GET" }),
      env,
      ctx,
    );
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=120");
  });

  it("returns 502 when upstream fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const res = await handler.fetch(
      new Request("https://w.dev/whirlpool/summary", { method: "GET" }),
      env,
      ctx,
    );
    expect(res.status).toBe(502);
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
    const spy = withFetchMock(jsonResponse({ tip_height: 7 }));
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
