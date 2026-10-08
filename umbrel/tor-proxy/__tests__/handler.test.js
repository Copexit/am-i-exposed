import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { createHandler } from "../handler.js";

const TX = "c575fb58fc4221882a281ceebe051131b2cc397f738156a93877c93639909cea";

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

  it("forwards a Wabisator lookup through Tor with a rebuilt body, no-store", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{}}');
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/svc/wabisator/api.php", method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "coinjoin", params: { txId: TX.toUpperCase() } }) }), res);
    expect(res.status()).toBe(200);
    expect(res.headers()["Cache-Control"]).toBe("no-store");
    const [url, opts] = fetchViaAgent.mock.calls[0];
    expect(url).toBe("https://wabisator.com/api.php");
    expect(JSON.parse(opts.body)).toEqual({ jsonrpc: "2.0", id: 1, method: "coinjoin", params: { txId: TX } });
  });

  it("rejects disallowed methods and bad params without calling upstream", async () => {
    const fetchViaAgent = vi.fn();
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    for (const [body, code] of [
      [{ jsonrpc: "2.0", method: "graph", params: {} }, "DISALLOWED"],
      [{ jsonrpc: "2.0", method: "search", params: { query: "x" } }, "BAD_PARAMS"],
    ]) {
      const res = makeRes();
      await handler(makeReq({ url: "/svc/wabisator/api.php", method: "POST", body: JSON.stringify(body) }), res);
      expect(res.status()).toBe(400);
      expect(JSON.parse(res.body()).error.code).toBe(code);
      expect(res.headers()["Cache-Control"]).toBe("no-store");
    }
    expect(fetchViaAgent).not.toHaveBeenCalled();
  });

  it("checks body size, then JSON, before the method allowlist", async () => {
    const fetchViaAgent = vi.fn();
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const big = makeRes();
    await handler(makeReq({ url: "/svc/wabisator/api.php", method: "POST", body: "x".repeat(65 * 1024) }), big);
    expect(big.status()).toBe(413);
    expect(JSON.parse(big.body()).error.code).toBe("TOO_LARGE");
    const bad = makeRes();
    await handler(makeReq({ url: "/svc/wabisator/api.php", method: "POST", body: "{nope" }), bad);
    expect(bad.status()).toBe(400);
    expect(JSON.parse(bad.body()).error.code).toBe("BAD_JSON");
    expect(fetchViaAgent).not.toHaveBeenCalled();
  });

  it("GET whirlpoolstats txs clamps page and drops unknown params", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue("{}");
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/svc/whirlpoolstats/txs?page=-4&x=1" }), res);
    expect(fetchViaAgent.mock.calls[0][0]).toBe("https://whirlpoolstats.xyz/api/txs?page=1");
    expect(fetchViaAgent.mock.calls[0][1].timeoutMs).toBe(30000);
  });

  it("GET hodlhodl forwards a floored offset plus the fixed limit", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue("{}");
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    await handler(makeReq({ url: "/svc/hodlhodl/api/v1/offers?pagination%5Boffset%5D=230&pagination%5Blimit%5D=9999&x=1" }), makeRes());
    const u = new URL(fetchViaAgent.mock.calls[0][0]);
    expect(u.origin + u.pathname).toBe("https://hodlhodl.com/api/v1/offers");
    expect(u.searchParams.get("pagination[offset]")).toBe("200");
    expect(u.searchParams.get("pagination[limit]")).toBe("100");
    expect(u.searchParams.has("x")).toBe(false);
  });

  it("onion-only coordinators go to their http onion; a service with no upstream 404s", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue("{}");
    const services = [{ id: "r", relays: ["wss://r"], routes: [{ path: "/g", http: "GET", class: "aggregate" }] }];
    const handler = createHandler({ fetchViaAgent, logger: silentLogger });
    await handler(makeReq({ url: "/svc/robosats-bazaar/api/info/" }), makeRes());
    expect(fetchViaAgent.mock.calls[0][0]).toBe("http://librebazovfmmkyi2jekraxsuso3mh622avuuzqpejixdl5dhuhb4tid.onion/api/info/");
    const res = makeRes();
    await createHandler({ fetchViaAgent, services, logger: silentLogger })(makeReq({ url: "/svc/r/g" }), res);
    expect(res.status()).toBe(404);
    expect(fetchViaAgent).toHaveBeenCalledTimes(1);
  });

  it("404s unknown services, 405s the wrong method, and drops the /observatory routes", async () => {
    const handler = createHandler({ fetchViaAgent: vi.fn(), logger: silentLogger });
    for (const [url, method, status] of [
      ["/svc/nope/api", "GET", 404],
      ["/svc/whirlpoolstats/nope", "GET", 404],
      ["/svc/whirlpoolstats/summary", "POST", 405],
      ["/observatory/whirlpool/summary", "GET", 400],
    ]) {
      const res = makeRes();
      await handler(makeReq({ url, method }), res);
      expect(res.status()).toBe(status);
      expect(res.headers()["Cache-Control"]).toBe("no-store");
    }
  });

  it("maps upstream failure to 502 and 429 to 429 with Retry-After", async () => {
    const down = createHandler({ fetchViaAgent: vi.fn().mockRejectedValue(new Error("x")), logger: silentLogger });
    const r1 = makeRes();
    await down(makeReq({ url: "/svc/whirlpoolstats/summary" }), r1);
    expect(r1.status()).toBe(502);
    expect(JSON.parse(r1.body()).error.code).toBe("UPSTREAM_DOWN");
    const limited = createHandler({ fetchViaAgent: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { status: 429 })), logger: silentLogger });
    const r2 = makeRes();
    await limited(makeReq({ url: "/svc/whirlpoolstats/summary" }), r2);
    expect(r2.status()).toBe(429);
    expect(r2.headers()["Retry-After"]).toBe("60");
  });

  it("never logs upstream response text (it can carry a txid)", async () => {
    const logger = { error: vi.fn(), info: () => {} };
    const fetchViaAgent = vi.fn().mockRejectedValue(Object.assign(new Error(`Upstream 500: {"query":"${TX}"}`), { status: 500 }));
    const handler = createHandler({ fetchViaAgent, logger });
    await handler(makeReq({ url: "/svc/wabisator/api.php", method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "search", params: { query: TX } }) }), makeRes());
    expect(logger.error).toHaveBeenCalledTimes(1);
    const line = logger.error.mock.calls[0][0];
    expect(line).toContain("wabisator");
    expect(line).toContain("500");
    expect(line).not.toContain(TX);
  });

  it("fails closed on a missing or unknown class (GET and POST) without calling upstream", async () => {
    const services = [{ id: "bad", base: "https://bad.example", onion: "http://bad.onion", routes: [
      { path: "/g", http: "GET" },
      { path: "/g2", http: "GET", class: "Aggregate" },
      { path: "/p", http: "POST", rpc: { m: { class: "weird" }, n: {} } },
    ] }];
    const fetchViaAgent = vi.fn();
    const handler = createHandler({ fetchViaAgent, services, logger: silentLogger });
    for (const [url, method, body] of [
      ["/svc/bad/g", "GET"], ["/svc/bad/g2", "GET"],
      ["/svc/bad/p", "POST", JSON.stringify({ jsonrpc: "2.0", method: "m" })],
      ["/svc/bad/p", "POST", JSON.stringify({ jsonrpc: "2.0", method: "n" })],
    ]) {
      const res = makeRes();
      await handler(makeReq({ url, method, body }), res);
      expect(res.status()).toBe(500);
      expect(JSON.parse(res.body()).error.code).toBe("MISCONFIGURED");
      expect(res.headers()["Cache-Control"]).toBe("no-store");
    }
    expect(fetchViaAgent).not.toHaveBeenCalled();
  });

  it("400s an invalid txid GET query value without calling upstream", async () => {
    const services = [{ id: "q", base: "https://q.example", routes: [{ path: "/g", http: "GET", class: "lookup", query: { tx: "txid" } }] }];
    const fetchViaAgent = vi.fn();
    const handler = createHandler({ fetchViaAgent, services, logger: silentLogger });
    const res = makeRes();
    await handler(makeReq({ url: "/svc/q/g?tx=zz" }), res);
    expect(res.status()).toBe(400);
    expect(JSON.parse(res.body()).error.code).toBe("BAD_PARAMS");
    expect(fetchViaAgent).not.toHaveBeenCalled();
  });

  it("answers 400 BAD_REQUEST when the request stream errors, without throwing", async () => {
    const handler = createHandler({ fetchViaAgent: vi.fn(), logger: silentLogger });
    const req = new Readable({ read() { this.destroy(new Error("aborted")); } });
    req.url = "/svc/wabisator/api.php";
    req.method = "POST";
    const res = makeRes();
    await expect(handler(req, res)).resolves.toBeUndefined();
    expect(res.status()).toBe(400);
    expect(JSON.parse(res.body()).error.code).toBe("BAD_REQUEST");
    expect(res.headers()["Cache-Control"]).toBe("no-store");
  });

  it("never rejects: an internal failure becomes 500 INTERNAL", async () => {
    const services = [{ id: "z", base: "https://z.example", routes: null }];
    const handler = createHandler({ fetchViaAgent: vi.fn(), services, logger: silentLogger });
    const res = makeRes();
    await expect(handler(makeReq({ url: "/svc/z/g" }), res)).resolves.toBeUndefined();
    expect(res.status()).toBe(500);
  });

  it("prefers the onion upstream when the service declares one", async () => {
    const services = [{ id: "o", base: "https://o.example", onion: "http://o.onion", routes: [{ path: "/g", http: "GET", class: "aggregate" }] }];
    const fetchViaAgent = vi.fn().mockResolvedValue("{}");
    const handler = createHandler({ fetchViaAgent, services, logger: silentLogger });
    await handler(makeReq({ url: "/svc/o/g" }), makeRes());
    expect(fetchViaAgent.mock.calls[0][0]).toBe("http://o.onion/g");
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
