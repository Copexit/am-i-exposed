import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHandler } from "../handler.js";

const here = dirname(fileURLToPath(import.meta.url));
const WORKER_FIXTURE_DIR = join(here, "../../../workers/coinjoin-stats/__tests__/fixtures");
const HTML_FIXTURE = readFileSync(join(WORKER_FIXTURE_DIR, "whirlpoolstats.html"), "utf8");
const CSV_FIXTURE = readFileSync(join(WORKER_FIXTURE_DIR, "whirlpool_stats.head-tail.csv"), "utf8");

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

  it("parses whirlpoolstats HTML into a WhirlpoolSummary on /observatory/whirlpool/summary", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue(HTML_FIXTURE);
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/observatory/whirlpool/summary" }), res);
    expect(res.status()).toBe(200);
    expect(fetchViaAgent).toHaveBeenCalledWith(
      "https://www.whirlpoolstats.xyz/",
      expect.any(Object),
    );
    const parsed = JSON.parse(res.body());
    expect(parsed.pools).toHaveLength(2);
    expect(parsed.total_entered_btc).toBeGreaterThan(0);
  });

  it("parses whirlpoolstats CSV into a downsampled WhirlpoolCharts", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue(CSV_FIXTURE);
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/observatory/whirlpool/charts" }), res);
    expect(res.status()).toBe(200);
    expect(fetchViaAgent).toHaveBeenCalledWith(
      "https://www.whirlpoolstats.xyz/whirlpool_stats.csv",
      expect.any(Object),
    );
    const parsed = JSON.parse(res.body());
    expect(Array.isArray(parsed.blocks)).toBe(true);
    expect(parsed.blocks.length).toBeLessThanOrEqual(513);
  });

  it("returns 502 with PARSER_HTML code when the HTML can't be parsed", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue("<html><body>nope</body></html>");
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/observatory/whirlpool/summary" }), res);
    expect(res.status()).toBe(502);
    const parsed = JSON.parse(res.body());
    expect(parsed.error?.code).toBe("PARSER_HTML");
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

  it("returns 502 when whirlpool upstream fails", async () => {
    const fetchViaAgent = vi.fn().mockRejectedValue(new Error("boom"));
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/observatory/whirlpool/summary" }), res);
    expect(res.status()).toBe(502);
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
