import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { createFetchViaAgent } from "../fetch-via-agent.js";

/** Fake http/https module: records request options and answers with status/body chunks. */
function fakeModule(name, calls, { status = 200, chunks = ["{}"] } = {}) {
  return {
    request(opts, cb) {
      calls.push({ name, opts });
      const req = new EventEmitter();
      req.write = () => {};
      req.destroy = () => {};
      req.end = () => queueMicrotask(() => {
        const res = new EventEmitter();
        res.statusCode = status;
        cb(res);
        for (const c of chunks) res.emit("data", Buffer.from(c));
        res.emit("end");
      });
      return req;
    },
  };
}

const agent = { tor: true };

describe("fetchViaAgent", () => {
  it("uses http with port 80 for onion http URLs and https with 443 otherwise, both through the agent", async () => {
    const calls = [];
    const f = createFetchViaAgent({ http: fakeModule("http", calls), https: fakeModule("https", calls), agent, maxBytes: 1024, defaultTimeoutMs: 1000 });
    await f("http://abc.onion/api/info/");
    await f("https://hodlhodl.com/api/v1/offers?pagination%5Boffset%5D=0");
    expect(calls[0].name).toBe("http");
    expect(calls[0].opts).toMatchObject({ hostname: "abc.onion", port: 80, path: "/api/info/", agent });
    expect(calls[1].name).toBe("https");
    expect(calls[1].opts).toMatchObject({ hostname: "hodlhodl.com", port: 443, agent });
    expect(calls[1].opts.path).toBe("/api/v1/offers?pagination%5Boffset%5D=0");
  });

  it("rejects past maxBytes and on non-2xx with the status", async () => {
    const big = createFetchViaAgent({ http: fakeModule("http", [], { chunks: ["x".repeat(600), "x".repeat(600)] }), https: null, agent, maxBytes: 1024, defaultTimeoutMs: 1000 });
    await expect(big("http://a.onion/")).rejects.toThrow("too large");
    const bad = createFetchViaAgent({ http: null, https: fakeModule("https", [], { status: 503, chunks: ["down"] }), agent, maxBytes: 1024, defaultTimeoutMs: 1000 });
    await expect(bad("https://a.example/")).rejects.toMatchObject({ status: 503 });
  });
});
