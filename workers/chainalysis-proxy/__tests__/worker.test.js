import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../worker.js";

const ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

// Fake of the Workers rate-limit binding: `limit` allowed calls per key.
function fakeLimiter(limit) {
  const counts = new Map();
  return {
    keys: [],
    async limit({ key }) {
      this.keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
}

function req(ip, method = "GET") {
  return new Request(`https://proxy.example/address/${ADDR}`, {
    method,
    headers: { "CF-Connecting-IP": ip },
  });
}

let env;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response('{"identifications":[]}', { status: 200 }),
  );
  env = { ALLOWED_ORIGIN: "*", CHAINALYSIS_API_KEY: "k", RATE_LIMITER: fakeLimiter(30) };
});

describe("chainalysis-proxy rate limit", () => {
  it("allows 30 requests per IP, then returns 429 JSON with Retry-After and CORS", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await handler.fetch(req("1.2.3.4"), env)).status).toBe(200);
    }
    const res = await handler.fetch(req("1.2.3.4"), env);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({ error: "Rate limit exceeded" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(30);
  });

  it("keys the limit on CF-Connecting-IP", async () => {
    for (let i = 0; i < 31; i++) await handler.fetch(req("1.2.3.4"), env);
    expect((await handler.fetch(req("5.6.7.8"), env)).status).toBe(200);
    expect(env.RATE_LIMITER.keys.at(-1)).toBe("5.6.7.8");
  });

  it("does not count CORS preflight", async () => {
    const res = await handler.fetch(req("1.2.3.4", "OPTIONS"), env);
    expect(res.status).toBe(204);
    expect(env.RATE_LIMITER.keys).toHaveLength(0);
  });

  it("returns a clean 500 JSON (not an uncaught throw) when the binding is missing", async () => {
    delete env.RATE_LIMITER;
    const res = await handler.fetch(req("1.2.3.4"), env);
    expect(res.status).toBe(500);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({ error: "Rate limiter not configured" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
