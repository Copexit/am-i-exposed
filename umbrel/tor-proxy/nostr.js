/**
 * Nostr snapshot for the tor-proxy sidecar (CommonJS port of
 * workers/coinjoin-stats/nostr.js, same contract and test vectors). Relays are
 * opened through Tor via the injected openSocket; onionRelays win when listed.
 * No cache: every response is no-store.
 */

const MAX_EVENTS = 3000;
const MAX_BYTES = 4 * 1024 * 1024;
/** Real orders are under 2 KiB; anything near this is junk or an attack. */
const MAX_EVENT_BYTES = 16 * 1024;
/** Collection stops here so the snapshot body stays under MAX_BYTES with its envelope. */
const COLLECT_BYTES = MAX_BYTES - 64 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

/** Registry filter plus since = floor(nowSec/ttl)*ttl - sinceSeconds when set (stable within a TTL). */
function buildFilter(route, nowSec) {
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
    && typeof ev.content === "string"
    && ev.content.length + JSON.stringify(ev.tags).length <= MAX_EVENT_BYTES;
}

/** Opens every relay, REQ, collects until EOSE/CLOSED/error/timeout. Never throws. */
async function snapshot({ relays, filter, timeoutMs = DEFAULT_TIMEOUT_MS, openSocket, nowSec }) {
  const seen = new Map();
  let bytes = 0;
  const collect = (url) => new Promise((resolve) => {
    let sock = null;
    let count = 0;
    let done = false;
    let notice = false;
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
          // A refusal (CLOSED, or a NOTICE before EOSE: auth, rate limit) is not a healthy answer.
          if (msg[0] === "CLOSED") return finish("error");
          if (msg[0] === "NOTICE") { notice = true; return; }
          if (msg[0] === "EOSE") return finish(notice ? "error" : "eose");
          if (msg[0] !== "EVENT" || msg[1] !== "s" || !validEvent(msg[2], filter.kinds)) return;
          count++;
          if (seen.has(msg[2].id) || seen.size >= MAX_EVENTS) return;
          const size = JSON.stringify(msg[2]).length;
          if (bytes + size > COLLECT_BYTES) return;
          bytes += size;
          seen.set(msg[2].id, msg[2]);
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

function createNostrRoute({ openSocket, now = Date.now }) {
  return async function nostrRoute(res, service, route) {
    const nowSec = Math.floor(now() / 1000);
    const filter = buildFilter(route, nowSec);
    const listed = service.onionRelays?.length ? service.onionRelays : (service.relays ?? []);
    // Plain ws:// only for .onion relays (Tor encrypts end to end); clearnet relays must be wss://.
    const relays = listed.filter((u) => {
      try {
        const p = new URL(u);
        return p.protocol === "wss:" || (p.protocol === "ws:" && p.hostname.endsWith(".onion"));
      } catch {
        return false;
      }
    });
    const snap = await snapshot({ relays, filter, timeoutMs: route.timeoutMs ?? DEFAULT_TIMEOUT_MS, openSocket, nowSec });
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    const fail = (code, message) => {
      res.writeHead(502, headers);
      res.end(JSON.stringify({ error: { code, message } }));
    };
    // Only a snapshot that at least one relay completed is a book; timeouts alone must not replace good data.
    if (!snap.relays.some((r) => r.status === "eose")) return fail("UPSTREAM_DOWN", "No relay completed the request");
    const body = JSON.stringify(snap);
    if (Buffer.byteLength(body) > MAX_BYTES) return fail("UPSTREAM_HTTP", "Response payload too large");
    res.writeHead(200, headers);
    res.end(body);
  };
}

module.exports = { buildFilter, snapshot, createNostrRoute };
