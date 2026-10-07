import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../worker.js";
import { buildFilter, snapshot, openWorkerSocket, handleNostr } from "../nostr.js";

const cacheStore = new Map();
globalThis.caches = { default: {
  async match(req) { return cacheStore.get(req.url) ?? null; },
  async put(req, res) { cacheStore.set(req.url, res); },
} };
const ctx = { waitUntil: (p) => p };
const env = { ALLOWED_ORIGIN: "https://am-i.exposed" };

const hex = (n, len = 64) => n.toString(16).padStart(len, "0");
const ev = (n, over = {}) => ({
  id: hex(n), pubkey: hex(1), sig: hex(2, 128), created_at: 1791386000 + n, kind: 38383, tags: [["d", String(n)]], content: "", ...over,
});

/** script(url): frames to emit after REQ, or "error" / "hang". */
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

const FILTER = { kinds: [38383], limit: 10 };
const R1 = "wss://a.example";
const R2 = "wss://b.example";

beforeEach(() => { cacheStore.clear(); vi.restoreAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe("nostr snapshot", () => {
  it("dedupes across relays, reports eose with per-relay counts, closes every socket", async () => {
    const open = fakeRelay(() => [["EVENT", "s", ev(1)], ["EOSE", "s"]]);
    const snap = await snapshot({ relays: [R1, R2], filter: FILTER, timeoutMs: 1000, openSocket: open, nowSec: 1791386100 });
    expect(snap.events).toHaveLength(1);
    expect(snap.relays).toEqual([{ url: R1, status: "eose", count: 1 }, { url: R2, status: "eose", count: 1 }]);
    expect(snap.fetchedAt).toBe(1791386100);
    for (const s of open.sockets) {
      expect(s.closed).toBe(true);
      expect(s.sent[0]).toEqual(["REQ", "s", FILTER]);
      expect(s.sent.at(-1)).toEqual(["CLOSE", "s"]);
    }
  });

  it("a hanging relay times out; the snapshot still answers", async () => {
    vi.useFakeTimers();
    const open = fakeRelay((url) => (url === R1 ? [["EVENT", "s", ev(1)], ["EOSE", "s"]] : "hang"));
    const p = snapshot({ relays: [R1, R2], filter: FILTER, timeoutMs: 8000, openSocket: open, nowSec: 1 });
    await vi.advanceTimersByTimeAsync(8000);
    const snap = await p;
    expect(snap.relays.map((r) => r.status)).toEqual(["eose", "timeout"]);
    expect(snap.events).toHaveLength(1);
  });

  it("drops wrong kinds, short ids, missing sigs and non-EVENT frames; sorts newest first", async () => {
    const frames = [
      ["EVENT", "s", ev(1)], ["EVENT", "s", ev(3)],
      ["EVENT", "s", ev(4, { kind: 1 })],
      ["EVENT", "s", ev(5, { id: "abc" })],
      ["EVENT", "s", { ...ev(6), sig: undefined }],
      ["EVENT", "x", ev(7)], ["NOTICE", "hi"], "garbage",
      ["EOSE", "s"],
    ];
    const snap = await snapshot({ relays: [R1], filter: FILTER, timeoutMs: 1000, openSocket: fakeRelay(() => frames), nowSec: 1 });
    expect(snap.events.map((e) => e.id)).toEqual([hex(3), hex(1)]);
    expect(snap.relays[0].count).toBe(2);
  });

  it("drops events over 16 KiB", async () => {
    const frames = [["EVENT", "s", ev(1, { content: "x".repeat(17 * 1024) })], ["EVENT", "s", ev(2, { tags: [["pm", "y".repeat(17 * 1024)]] })], ["EVENT", "s", ev(3)], ["EOSE", "s"]];
    const snap = await snapshot({ relays: [R1], filter: FILTER, timeoutMs: 1000, openSocket: fakeRelay(() => frames), nowSec: 1 });
    expect(snap.events.map((e) => e.id)).toEqual([hex(3)]);
  });

  it("a refusal (CLOSED, or NOTICE before EOSE) is an error, not a healthy relay", async () => {
    const open = fakeRelay((u) => (u === R1 ? [["CLOSED", "s", "auth-required: x"]] : [["NOTICE", "rate limited"], ["EOSE", "s"]]));
    const snap = await snapshot({ relays: [R1, R2], filter: FILTER, timeoutMs: 1000, openSocket: open, nowSec: 1 });
    expect(snap.relays.map((r) => r.status)).toEqual(["error", "error"]);
  });

  it("caps at 3,000 events", async () => {
    const frames = Array.from({ length: 3500 }, (_, i) => ["EVENT", "s", ev(i + 1)]);
    frames.push(["EOSE", "s"]);
    const snap = await snapshot({ relays: [R1], filter: FILTER, timeoutMs: 1000, openSocket: fakeRelay(() => frames), nowSec: 1 });
    expect(snap.events).toHaveLength(3000);
  });

  it("a relay that fails to open or errors is reported as error", async () => {
    const open = async (url) => { if (url === R1) throw new Error("nope"); return fakeRelay(() => "error")(url); };
    const snap = await snapshot({ relays: [R1, R2], filter: FILTER, timeoutMs: 1000, openSocket: open, nowSec: 1 });
    expect(snap.relays.map((r) => r.status)).toEqual(["error", "error"]);
  });

  it("buildFilter rounds since to the TTL", () => {
    const route = { ttl: 600, nostr: { filter: { kinds: [38383], limit: 2000 }, sinceSeconds: 604800 } };
    expect(buildFilter(route, 1791386100).since).toBe(1791385800 - 604800);
    expect(buildFilter({ ttl: 30, nostr: { filter: FILTER } }, 1791386100)).toEqual(FILTER);
  });
});

describe("handleNostr", () => {
  const service = { id: "mostro-nostr", relays: [R1, R2] };
  const route = { path: "/orders", ttl: 30, timeoutMs: 1000, nostr: { filter: FILTER } };

  it("answers 200 with the snapshot and edge-caches it for the TTL", async () => {
    const open = fakeRelay(() => [["EVENT", "s", ev(1)], ["EOSE", "s"]]);
    const now = () => 1791386100_000;
    const res = await handleNostr({ service, route, ctx, cors: { "X-C": "1" }, openSocket: open, now });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30");
    expect(res.headers.get("X-C")).toBe("1");
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.fetchedAt).toBe(1791386100);
    expect([...cacheStore.keys()]).toEqual(["https://cache.local/svc/mostro-nostr/orders?since=0"]);
    const again = await handleNostr({ service, route, ctx, cors: {}, openSocket: open, now });
    expect(again.status).toBe(200);
    expect(open.sockets).toHaveLength(2);
  });

  it("502 UPSTREAM_DOWN when every relay errors, not cached", async () => {
    const res = await handleNostr({ service, route, ctx, cors: {}, openSocket: fakeRelay(() => "error") });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("UPSTREAM_DOWN");
    expect(cacheStore.size).toBe(0);
  });

  it("stops collecting at the byte cap, so the body stays under 4 MiB", async () => {
    const big = "x".repeat(2000);
    const frames = Array.from({ length: 2500 }, (_, i) => ["EVENT", "s", ev(i + 1, { content: big })]);
    frames.push(["EOSE", "s"]);
    const res = await handleNostr({ service, route, ctx, cors: {}, openSocket: fakeRelay(() => frames) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.length).toBeLessThan(4 * 1024 * 1024);
    const n = JSON.parse(text).events.length;
    expect(n).toBeGreaterThan(1000);
    expect(n).toBeLessThan(2500);
  });

  it("every relay timing out is a 502, never an empty cached book", async () => {
    vi.useFakeTimers();
    const p = handleNostr({ service, route, ctx, cors: {}, openSocket: fakeRelay(() => "hang") });
    await vi.advanceTimersByTimeAsync(1000);
    const res = await p;
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(cacheStore.size).toBe(0);
  });

  it("one relay completing is enough; the others' timeouts are reported", async () => {
    vi.useFakeTimers();
    const p = handleNostr({ service, route, ctx, cors: {}, openSocket: fakeRelay((u) => (u === R1 ? [["EVENT", "s", ev(1)], ["EOSE", "s"]] : "hang")) });
    await vi.advanceTimersByTimeAsync(1000);
    const res = await p;
    expect(res.status).toBe(200);
    expect((await res.json()).relays.map((r) => r.status)).toEqual(["eose", "timeout"]);
  });
});

describe("openWorkerSocket and the /svc dispatch", () => {
  function fakeWs(onSend) {
    const listeners = {};
    const ws = {
      accepted: false,
      accept() { this.accepted = true; },
      addEventListener(t, fn) { (listeners[t] ??= []).push(fn); },
      send(s) { onSend(JSON.parse(s), (frame) => listeners.message?.forEach((fn) => fn({ data: JSON.stringify(frame) }))); },
      close() {},
    };
    return ws;
  }

  it("upgrades over fetch with wss mapped to https", async () => {
    const ws = fakeWs(() => {});
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue({ status: 101, webSocket: ws });
    const sock = await openWorkerSocket("wss://relay.example/relay/");
    expect(f.mock.calls[0][0]).toBe("https://relay.example/relay/");
    expect(f.mock.calls[0][1].headers.Upgrade).toBe("websocket");
    expect(ws.accepted).toBe(true);
    expect(typeof sock.onMessage).toBe("function");
  });

  it("a non-101 upgrade is an error status in the snapshot", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ status: 200, webSocket: null });
    const snap = await snapshot({ relays: [R1], filter: FILTER, timeoutMs: 1000, openSocket: openWorkerSocket, nowSec: 1 });
    expect(snap.relays[0].status).toBe("error");
  });

  it("sends only the registry filter; client query params never reach the relay", async () => {
    const reqs = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      status: 101,
      webSocket: fakeWs((frame, emit) => {
        if (frame[0] !== "REQ") return;
        reqs.push(frame);
        queueMicrotask(() => emit(["EOSE", "s"]));
      }),
    }));
    const res = await handler.fetch(new Request(`https://w.dev/svc/mostro-nostr/orders?filter=${encodeURIComponent('{"kinds":[1]}')}&authors=evil`), env, ctx);
    expect(res.status).toBe(200);
    expect(reqs).toHaveLength(3);
    for (const r of reqs) expect(r).toEqual(["REQ", "s", { kinds: [38383], "#y": ["mostro"], "#s": ["pending"], limit: 1000 }]);
  });
});
