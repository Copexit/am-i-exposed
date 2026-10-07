/**
 * Nostr snapshot routes: a registry-fixed filter is sent to every listed
 * relay, events are collected until EOSE/CLOSED, an error or the route
 * timeout, and one JSON snapshot { events, relays, fetchedAt } is returned.
 * The client never sends a filter. Signatures are verified by the client.
 */

const MAX_EVENTS = 3000;
const MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

/** Registry filter plus since = floor(nowSec/ttl)*ttl - sinceSeconds when set (stable within a TTL). */
export function buildFilter(route, nowSec) {
  const filter = { ...route.nostr.filter };
  if (route.nostr.sinceSeconds) {
    const ttl = route.ttl || 1;
    filter.since = Math.floor(nowSec / ttl) * ttl - route.nostr.sinceSeconds;
  }
  return filter;
}

function validEvent(ev, kinds) {
  return Boolean(ev) && typeof ev === "object"
    && typeof ev.id === "string" && HEX64.test(ev.id)
    && typeof ev.pubkey === "string" && HEX64.test(ev.pubkey)
    && typeof ev.sig === "string" && HEX128.test(ev.sig)
    && Number.isInteger(ev.created_at)
    && Number.isInteger(ev.kind) && kinds.includes(ev.kind)
    && Array.isArray(ev.tags)
    && typeof ev.content === "string";
}

/** Opens every relay, REQ, collects until EOSE/CLOSED/error/timeout. Never throws. */
export async function snapshot({ relays, filter, timeoutMs = DEFAULT_TIMEOUT_MS, openSocket, nowSec }) {
  const seen = new Map();
  const collect = (url) => new Promise((resolve) => {
    let sock = null;
    let count = 0;
    let done = false;
    const finish = (status) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (sock) {
        try { sock.send(JSON.stringify(["CLOSE", "s"])); } catch { /* ignore */ }
        try { sock.close(); } catch { /* ignore */ }
      }
      resolve({ url, status, count });
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    Promise.resolve()
      .then(() => openSocket(url))
      .then((s) => {
        sock = s;
        if (done) { try { s.close(); } catch { /* ignore */ } return; }
        s.onMessage((data) => {
          let msg;
          try { msg = JSON.parse(typeof data === "string" ? data : String(data)); } catch { return; }
          if (!Array.isArray(msg)) return;
          if (msg[0] === "EOSE" || msg[0] === "CLOSED") return finish("eose");
          if (msg[0] !== "EVENT" || msg[1] !== "s" || !validEvent(msg[2], filter.kinds)) return;
          count++;
          if (!seen.has(msg[2].id) && seen.size < MAX_EVENTS) seen.set(msg[2].id, msg[2]);
        });
        s.onError(() => finish("error"));
        s.onClose(() => finish("error"));
        s.send(JSON.stringify(["REQ", "s", filter]));
      })
      .catch(() => finish("error"));
  });

  const statuses = await Promise.all(relays.map(collect));
  const events = [...seen.values()].sort((a, b) => b.created_at - a.created_at);
  return { events, relays: statuses, fetchedAt: nowSec };
}

/** Worker socket opener: outbound WebSocket through a fetch upgrade. */
export async function openWorkerSocket(url) {
  const httpUrl = url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  const resp = await fetch(httpUrl, { headers: { Upgrade: "websocket" } });
  const ws = resp.webSocket;
  if (resp.status !== 101 || !ws) throw new Error(`Upgrade failed: ${resp.status}`);
  ws.accept();
  return {
    send: (s) => ws.send(s),
    close: () => ws.close(),
    onMessage: (fn) => ws.addEventListener("message", (e) => fn(e.data)),
    onClose: (fn) => ws.addEventListener("close", () => fn()),
    onError: (fn) => ws.addEventListener("error", () => fn()),
  };
}

function json(status, body, extra) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

/** svc.js calls this for nostr routes; edge-caches like other aggregate routes. */
export async function handleNostr({ service, route, ctx, cors, openSocket = openWorkerSocket, now = Date.now }) {
  const nowSec = Math.floor(now() / 1000);
  const filter = buildFilter(route, nowSec);
  const cache = caches.default;
  const key = new Request(`https://cache.local/svc/${service.id}${route.path}?since=${filter.since ?? 0}`, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) {
    const headers = new Headers(hit.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(hit.body, { status: hit.status, headers });
  }

  const fail = (code, message) => json(502, { error: { code, message } }, { "Cache-Control": "no-store", ...cors });
  const snap = await snapshot({
    relays: service.relays ?? [],
    filter,
    timeoutMs: route.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    openSocket,
    nowSec,
  });
  if (snap.relays.every((r) => r.status === "error")) return fail("UPSTREAM_DOWN", "Every relay failed");
  const body = JSON.stringify(snap);
  if (new TextEncoder().encode(body).length > MAX_BYTES) return fail("UPSTREAM_HTTP", "Response payload too large");

  const response = json(200, body, { "Cache-Control": `public, max-age=${route.ttl}`, ...cors });
  ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}
