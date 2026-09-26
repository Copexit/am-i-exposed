import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { createHandler } from "../handler.js";

const SUMMARY_JSON = JSON.stringify({
  title: "Whirlpool.Observer",
  is_synced: true,
  pools: [{}, {}],
});
const CHARTS_JSON = JSON.stringify({
  capacity: { blocks: [1], series: { "0.025_BTC_Pool": [1] } },
});
const TXS_JSON = JSON.stringify({
  items: [{ txid: "a" }],
  page: 1,
  per_page: 25,
  total: 1,
  total_pages: 1,
});

function makeReq({ url, method = "GET", body }) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.url = url;
  stream.method = method;
  return stream;
}

function makeRes() {
  let statusCode = 0;
  let headers = {};
  const chunks = [];
  const res = {
    writeHead(code, h = {}) {
      statusCode = code;
      headers = { ...headers, ...h };
    },
    end(body) {
      if (body) chunks.push(Buffer.from(body));
    },
    body() {
      return Buffer.concat(chunks).toString();
    },
    status() {
      return statusCode;
    },
    headers() {
      return headers;
    },
  };
  return res;
}

const silentLogger = { error: () => {}, info: () => {} };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("tor-proxy handler", () => {
  it("returns 200 on /health", async () => {
    const handler = createHandler({
      fetchViaAgent: vi.fn(),
      logger: silentLogger,
    });
    const res = makeRes();
    await handler(makeReq({ url: "/health" }), res);
    expect(res.status()).toBe(200);
    expect(res.body()).toBe("ok");
  });

  it("passes through /api/summary JSON on /observatory/whirlpool/summary", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue(SUMMARY_JSON);
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/observatory/whirlpool/summary" }), res);
    expect(res.status()).toBe(200);
    expect(fetchViaAgent).toHaveBeenCalledWith(
      "https://whirlpoolstats.xyz/api/summary",
      expect.any(Object),
    );
    expect(res.body()).toBe(SUMMARY_JSON);
  });

  it("passes through /api/charts JSON on /observatory/whirlpool/charts", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue(CHARTS_JSON);
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/observatory/whirlpool/charts" }), res);
    expect(res.status()).toBe(200);
    expect(fetchViaAgent).toHaveBeenCalledWith(
      "https://whirlpoolstats.xyz/api/charts",
      expect.any(Object),
    );
    expect(res.body()).toBe(CHARTS_JSON);
  });

  it("forwards the page query on /observatory/whirlpool/txs", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue(TXS_JSON);
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/observatory/whirlpool/txs?page=2" }), res);
    expect(res.status()).toBe(200);
    expect(fetchViaAgent).toHaveBeenCalledWith(
      "https://whirlpoolstats.xyz/api/txs?page=2",
      expect.any(Object),
    );
  });

  it("defaults txs to page 1 when the query is absent", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue(TXS_JSON);
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/observatory/whirlpool/txs" }), res);
    expect(fetchViaAgent).toHaveBeenCalledWith(
      "https://whirlpoolstats.xyz/api/txs?page=1",
      expect.any(Object),
    );
  });

  it("405s POST to a whirlpool path", async () => {
    const handler = createHandler({
      fetchViaAgent: vi.fn(),
      logger: silentLogger,
    });
    const res = makeRes();
    await handler(
      makeReq({ url: "/observatory/whirlpool/summary", method: "POST" }),
      res,
    );
    expect(res.status()).toBe(405);
  });

  it("returns 502 UPSTREAM_DOWN when whirlpool upstream fails", async () => {
    const fetchViaAgent = vi.fn().mockRejectedValue(new Error("boom"));
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/observatory/whirlpool/summary" }), res);
    expect(res.status()).toBe(502);
    const parsed = JSON.parse(res.body());
    expect(parsed.error?.code).toBe("UPSTREAM_DOWN");
  });

  it("POST /observatory/liquisabi/api with method=dashboard is forwarded", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { Coordinators: [] } }),
    );
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(
      makeReq({
        url: "/observatory/liquisabi/api",
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "dashboard", id: 1 }),
      }),
      res,
    );
    expect(res.status()).toBe(200);
    expect(fetchViaAgent).toHaveBeenCalledWith(
      "https://liquisabi.com/api",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects POST /observatory/liquisabi/api with disallowed method", async () => {
    const fetchViaAgent = vi.fn();
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(
      makeReq({
        url: "/observatory/liquisabi/api",
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "rounds", id: 1 }),
      }),
      res,
    );
    expect(res.status()).toBe(400);
    expect(fetchViaAgent).not.toHaveBeenCalled();
  });

  it("405s GET /observatory/liquisabi/api", async () => {
    const handler = createHandler({
      fetchViaAgent: vi.fn(),
      logger: silentLogger,
    });
    const res = makeRes();
    await handler(
      makeReq({ url: "/observatory/liquisabi/api", method: "GET" }),
      res,
    );
    expect(res.status()).toBe(405);
  });

  it("still forwards a valid chainalysis request", async () => {
    const fetchViaAgent = vi
      .fn()
      .mockResolvedValue("{\"sanctioned\":false}");
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    // Real Satoshi P2PKH address - matches the legacy 1... pattern in ADDR_RE.
    await handler(
      makeReq({
        url: "/chainalysis/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
      }),
      res,
    );
    expect(res.status()).toBe(200);
    expect(fetchViaAgent).toHaveBeenCalledWith(
      expect.stringContaining("/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"),
    );
  });

  it("passes an upstream 429 through instead of reporting the sidecar as down", async () => {
    const err = Object.assign(new Error("Upstream 429"), { status: 429 });
    const handler = createHandler({ fetchViaAgent: vi.fn().mockRejectedValue(err), logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/chainalysis/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }), res);
    expect(res.status()).toBe(429);
  });

  it("400s unknown paths", async () => {
    const handler = createHandler({
      fetchViaAgent: vi.fn(),
      logger: silentLogger,
    });
    const res = makeRes();
    await handler(makeReq({ url: "/unknown" }), res);
    expect(res.status()).toBe(400);
  });
});
