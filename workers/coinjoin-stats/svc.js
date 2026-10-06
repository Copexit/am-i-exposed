/**
 * Registry-driven /svc/<id>/<path> proxy. Routes, RPC methods, classes and
 * TTLs come from src/lib/services/registry.json (shared with the frontend).
 * aggregate: edge-cached. lookup: carries a user txid, never cached.
 */
import registry from "../../src/lib/services/registry.json";

const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_PARAMS_JSON = 2048;
const DEFAULT_TIMEOUT_MS = 20000;

export function validateParam(kind, value) {
  if (kind === "txid") {
    if (typeof value !== "string") return null;
    const v = value.trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(v) ? v : null;
  }
  const n = parseInt(String(value ?? "1"), 10);
  return String(!Number.isFinite(n) || n < 1 ? 1 : Math.min(n, 10000));
}

export const createSvc = (reg) => (request, url, ctx, cors) => handle(reg, request, url, ctx, cors);
export const handleSvc = createSvc(registry);

const misconfigured = (cors) => err(500, "MISCONFIGURED", "Service registry misconfigured", cors);

async function handle(reg, request, url, ctx, cors) {
  const m = url.pathname.match(/^\/svc\/([^/]+)(\/.*)$/);
  const service = m && reg.services.find((s) => s.id === m[1]);
  const route = service?.routes.find((r) => r.path === m[2] && r.http === request.method);
  if (!route) return err(404, "NOT_FOUND", "Unknown service route", cors);
  const id = service.id;
  const path = route.path;

  if (request.method === "GET") {
    // Fail closed: only an exact "aggregate" is cached, only "lookup" is no-store.
    if (route.class !== "aggregate" && route.class !== "lookup") return misconfigured(cors);
    const qs = new URLSearchParams();
    for (const [name, kind] of Object.entries(route.query ?? {})) {
      if (!url.searchParams.has(name)) continue;
      const v = validateParam(kind, url.searchParams.get(name));
      if (v === null) return err(400, "BAD_PARAMS", "Invalid params", cors);
      qs.set(name, v);
    }
    const query = qs.toString();
    return forward({
      ctx, cors, route,
      upstream: service.base + path + (query ? "?" + query : ""),
      init: { headers: { Accept: "application/json" } },
      cacheUrl: route.class === "aggregate" ? `https://cache.local/svc/${id}${path}?${query}` : null,
      ttl: route.ttl,
    });
  }

  // POST
  const text = await request.text();
  if (text.length > MAX_REQUEST_BYTES) return err(413, "TOO_LARGE", "Request body too large", cors);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return err(400, "BAD_JSON", "Invalid JSON body", cors);
  }
  const rpc = body && body.jsonrpc === "2.0" && typeof body.method === "string"
    && Object.hasOwn(route.rpc ?? {}, body.method) ? route.rpc[body.method] : null;
  if (!rpc) return err(400, "DISALLOWED", "Invalid or disallowed method", cors);
  if (rpc.class !== "aggregate" && rpc.class !== "lookup") return misconfigured(cors);
  const method = body.method;

  let params;
  if (rpc.class === "lookup") {
    const declared = Object.entries(rpc.params ?? {});
    const p = body.params;
    if (!p || typeof p !== "object" || Array.isArray(p)) return err(400, "BAD_PARAMS", "Invalid params", cors);
    const keys = Object.keys(p);
    if (keys.length !== declared.length) return err(400, "BAD_PARAMS", "Invalid params", cors);
    params = {};
    for (const [name, kind] of declared) {
      const v = Object.hasOwn(p, name) ? validateParam(kind, p[name]) : null;
      if (v === null) return err(400, "BAD_PARAMS", "Invalid params", cors);
      params[name] = v;
    }
  } else {
    params = body.params ?? {};
    if (JSON.stringify(params).length > MAX_PARAMS_JSON) return err(400, "BAD_PARAMS", "Params too large", cors);
  }

  const lookup = rpc.class === "lookup";
  return forward({
    ctx, cors, route,
    upstream: service.base + path,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    // Query string, not a fragment: the Cache API ignores fragments.
    cacheUrl: lookup ? null : `https://cache.local/svc/${id}${path}?m=${encodeURIComponent(method)}&p=${encodeURIComponent(JSON.stringify(params))}`,
    ttl: rpc.ttl,
  });
}

async function forward({ ctx, cors, route, upstream, init, cacheUrl, ttl }) {
  const cache = cacheUrl ? caches.default : null;
  const key = cacheUrl ? new Request(cacheUrl, { method: "GET" }) : null;
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return withCors(hit, cors);
  }

  let res;
  try {
    res = await fetch(upstream, { ...init, signal: AbortSignal.timeout(route.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  } catch {
    return err(502, "UPSTREAM_DOWN", "Upstream unreachable", cors);
  }
  if (!res.ok) return err(502, "UPSTREAM_HTTP", `Upstream HTTP ${res.status}`, cors);
  const text = await readLimited(res, MAX_UPSTREAM_BYTES);
  if (text === null) return err(502, "UPSTREAM_HTTP", "Response payload too large", cors);

  const response = new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cache ? `public, max-age=${ttl}` : "no-store",
      ...cors,
    },
  });
  if (cache) ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}

function err(status, code, message, cors) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors },
  });
}

function withCors(response, cors) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export async function readLimited(response, cap) {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    chunks.push(value);
  }
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return new TextDecoder().decode(out);
}
