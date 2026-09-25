import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../worker.js";

const env = { ALLOWED_ORIGIN: "*" };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response("# exit list\n185.220.101.1\n", { status: 200 }),
  );
});

function req(ip) {
  const headers = ip ? { "CF-Connecting-IP": ip } : {};
  return new Request("https://tor-check.example/", { headers });
}

describe("tor-check caching", () => {
  // The verdict depends on the caller's IP, so no cache may reuse it.
  it.each([
    ["Tor exit IP", "185.220.101.1", true],
    ["non-Tor IP", "1.2.3.4", false],
    ["missing IP", undefined, false],
  ])("%s response is no-store", async (_label, ip, isTor) => {
    const res = await handler.fetch(req(ip), env);
    expect(await res.json()).toEqual({ isTor });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
