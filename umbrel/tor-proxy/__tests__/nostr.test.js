import { describe, it, expect, vi, afterEach } from "vitest";
import { buildFilter, snapshot, createNostrRoute } from "../nostr.js";
import { createHandler } from "../handler.js";

// Same vectors as workers/coinjoin-stats/__tests__/nostr.test.js.
const hex = (n, len = 64) => n.toString(16).padStart(len, "0");
const ev = (n, over = {}) => ({
  id: hex(n), pubkey: hex(1), sig: hex(2, 128), created_at: 1791386000 + n, kind: 38383, tags: [["d", String(n)]], content: "", ...over,
});

function fakeRelay(script) {
  const sockets = [];
  const open = async (url) => {
    const handlers = {};
    const sock = {
      url, sent: [], closed: false,
      send(s) {
        this.sent.push(JSON.parse(s));
        if (JSON.parse(s)[0] === "REQ") queueMicrotask(() => {
          const sc = script(url);
          if (sc === "error") return handlers.error?.();
          if (sc === "hang") return;
          for (const f of sc) handlers.message?.(JSON.stringify(f));
        });
      },
      close() { this.closed = true; },
      onMessage(fn) { handlers.message = fn; }, onClose(fn) { handlers.close = fn; }, onError(fn) { handlers.error = fn; },
    };
    sockets.push(sock);
    return sock;
  };
  open.sockets = sockets;
  return open;
}

function makeRes() {
  const out = { status: 0, headers: {}, body: "" };
  return {
    out,
    writeHead(code, h = {}) { out.status = code; out.headers = { ...out.headers, ...h }; },
    end(b) { if (b) out.body += b; },
  };
}

const FILTER = { kinds: [38383], limit: 10 };
const R1 = "wss://a.example";
const R2 = "wss://b.example";
const silentLogger = { error: () => {}, info: () => {} };

afterEach(() => { vi.useRealTimers(); });

describe("sidecar nostr snapshot", () => {
  it("dedupes across relays with per-relay counts and closes sockets", async () => {
    const open = fakeRelay(() => [["EVENT", "s", ev(1)], ["EOSE", "s"]]);
    const snap = await snapshot({ relays: [R1, R2], filter: FILTER, timeoutMs: 1000, openSocket: open, nowSec: 5 });
    expect(snap.events).toHaveLength(1);
    expect(snap.relays).toEqual([{ url: R1, status: "eose", count: 1 }, { url: R2, status: "eose", count: 1 }]);
    expect(snap.fetchedAt).toBe(5);
    expect(open.sockets.every((s) => s.closed)).toBe(true);
  });

  it("times out a hanging relay", async () => {
    vi.useFakeTimers();
    const p = snapshot({ relays: [R1, R2], filter: FILTER, timeoutMs: 8000, openSocket: fakeRelay((u) => (u === R1 ? [["EOSE", "s"]] : "hang")), nowSec: 1 });
    await vi.advanceTimersByTimeAsync(8000);
    expect((await p).relays.map((r) => r.status)).toEqual(["eose", "timeout"]);
  });

  it("drops bad kinds and malformed events, caps at 3,000", async () => {
    const frames = [["EVENT", "s", ev(1, { kind: 1 })], ["EVENT", "s", ev(2, { id: "x" })], ...Array.from({ length: 3200 }, (_, i) => ["EVENT", "s", ev(i + 10)]), ["EOSE", "s"]];
    const snap = await snapshot({ relays: [R1], filter: FILTER, timeoutMs: 1000, openSocket: fakeRelay(() => frames), nowSec: 1 });
    expect(snap.events).toHaveLength(3000);
    expect(snap.events.some((e) => e.kind !== 38383)).toBe(false);
  });

  it("all relays timing out is a 502; oversized events are dropped; CLOSED is an error", async () => {
    vi.useFakeTimers();
    const route = { path: "/orders", ttl: 30, timeoutMs: 1000, nostr: { filter: FILTER } };
    const res = makeRes();
    const p = createNostrRoute({ openSocket: fakeRelay(() => "hang") })(res, { relays: [R1, R2] }, route);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(res.out.status).toBe(502);
    expect(res.out.headers["Cache-Control"]).toBe("no-store");
    vi.useRealTimers();
    const frames = [["EVENT", "s", ev(1, { content: "x".repeat(17 * 1024) })], ["EVENT", "s", ev(2)], ["EOSE", "s"]];
    const snap = await snapshot({ relays: [R1, R2], filter: FILTER, timeoutMs: 1000, openSocket: fakeRelay((u) => (u === R1 ? frames : [["CLOSED", "s", "no"]])), nowSec: 1 });
    expect(snap.events.map((e) => e.id)).toEqual([hex(2)]);
    expect(snap.relays.map((r) => r.status)).toEqual(["eose", "error"]);
  });

  it("plain ws:// is used only for .onion relays", async () => {
    const open = fakeRelay(() => [["EOSE", "s"]]);
    const res = makeRes();
    await createNostrRoute({ openSocket: open })(res, { onionRelays: ["ws://clear.example/relay/", "ws://x.onion/relay/"] }, { path: "/o", ttl: 30, nostr: { filter: FILTER } });
    expect(open.sockets.map((s) => s.url)).toEqual(["ws://x.onion/relay/"]);
  });

  it("buildFilter rounds since to the TTL", () => {
    const route = { ttl: 600, nostr: { filter: FILTER, sinceSeconds: 604800 } };
    expect(buildFilter(route, 1791386100).since).toBe(1791385800 - 604800);
  });

  it("all relays erroring gives 502; onionRelays are preferred over relays", async () => {
    const route = { path: "/orders", ttl: 30, nostr: { filter: FILTER } };
    const down = makeRes();
    await createNostrRoute({ openSocket: fakeRelay(() => "error") })(down, { relays: [R1] }, route);
    expect(down.out.status).toBe(502);
    expect(JSON.parse(down.out.body).error.code).toBe("UPSTREAM_DOWN");

    const open = fakeRelay(() => [["EOSE", "s"]]);
    const res = makeRes();
    await createNostrRoute({ openSocket: open })(res, { relays: [R1], onionRelays: ["ws://x.onion/relay/"] }, route);
    expect(res.out.status).toBe(200);
    expect(open.sockets.map((s) => s.url)).toEqual(["ws://x.onion/relay/"]);
  });
});

describe("handler /svc nostr routes", () => {
  const req = (url, method = "GET") => ({ url, method, on() {} });

  it("GET /svc/mostro-nostr/orders returns the snapshot, no-store, with the registry filter", async () => {
    const open = fakeRelay(() => [["EVENT", "s", ev(1)], ["EOSE", "s"]]);
    const handler = createHandler({ fetchViaAgent: vi.fn(), openSocket: open, logger: silentLogger });
    const res = makeRes();
    await handler(req("/svc/mostro-nostr/orders?filter=evil"), res);
    expect(res.out.status).toBe(200);
    expect(res.out.headers["Cache-Control"]).toBe("no-store");
    expect(JSON.parse(res.out.body).events).toHaveLength(1);
    expect(open.sockets).toHaveLength(3);
    for (const s of open.sockets) expect(s.sent[0]).toEqual(["REQ", "s", { kinds: [38383], "#y": ["mostro"], "#s": ["pending"], limit: 1000 }]);
  });

  it("a nostr route declared lookup or POST is MISCONFIGURED and opens nothing", async () => {
    const open = fakeRelay(() => [["EOSE", "s"]]);
    const services = [
      { id: "n", relays: [R1], routes: [{ path: "/o", http: "GET", class: "lookup", nostr: { filter: FILTER } }] },
      { id: "p", relays: [R1], routes: [{ path: "/o", http: "POST", class: "aggregate", nostr: { filter: FILTER } }] },
    ];
    const handler = createHandler({ fetchViaAgent: vi.fn(), openSocket: open, services, logger: silentLogger });
    for (const [url, method] of [["/svc/n/o", "GET"], ["/svc/p/o", "POST"]]) {
      const res = makeRes();
      await handler(req(url, method), res);
      expect(res.out.status).toBe(500);
    }
    expect(open.sockets).toHaveLength(0);
  });
});
