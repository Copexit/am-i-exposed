import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import handler from "../worker.js";

const env = { ALLOWED_ORIGIN: "https://am-i.exposed" };

const here = dirname(fileURLToPath(import.meta.url));
const HTML_FIXTURE = readFileSync(join(here, "fixtures/whirlpoolstats.html"), "utf8");
const CSV_FIXTURE = readFileSync(join(here, "fixtures/whirlpool_stats.head-tail.csv"), "utf8");

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

function htmlResponse(body, init = {}) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html" },
    ...init,
  });
}

function csvResponse(body, init = {}) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/csv" },
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

  it("fetches whirlpoolstats.xyz HTML and emits parsed summary JSON", async () => {
    const spy = withFetchMock(htmlResponse(HTML_FIXTURE));
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
      "https://www.whirlpoolstats.xyz/",
      expect.any(Object),
    );
    const body = await res.json();
    expect(body.pools).toHaveLength(2);
    expect(body.total_entered_btc).toBeGreaterThan(0);
  });

  it("fetches whirlpoolstats.xyz CSV and emits parsed charts JSON with 120s cache", async () => {
    const spy = withFetchMock(csvResponse(CSV_FIXTURE));
    const res = await handler.fetch(
      new Request("https://w.dev/whirlpool/charts", { method: "GET" }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=120");
    expect(spy).toHaveBeenCalledWith(
      "https://www.whirlpoolstats.xyz/whirlpool_stats.csv",
      expect.any(Object),
    );
    const body = await res.json();
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.capacity_btc["0.025_BTC_Pool"].length).toBe(body.blocks.length);
  });

  it("returns 502 with structured error when upstream fails", async () => {
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

  it("returns 502 with PARSER_HTML code when the HTML structure breaks", async () => {
    withFetchMock(htmlResponse("<html><body>nothing here</body></html>"));
    const res = await handler.fetch(
      new Request("https://w.dev/whirlpool/summary", { method: "GET" }),
      env,
      ctx,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error?.code).toBe("PARSER_HTML");
    expect(Array.isArray(body.error?.fields_missing)).toBe(true);
  });

  it("returns 502 with PARSER_CSV code when the CSV is too short", async () => {
    withFetchMock(csvResponse("899205,0.05,0.0\n899206,0.05,0.0\n"));
    const res = await handler.fetch(
      new Request("https://w.dev/whirlpool/charts", { method: "GET" }),
      env,
      ctx,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error?.code).toBe("PARSER_CSV");
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
    const spy = withFetchMock(htmlResponse(HTML_FIXTURE));
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
