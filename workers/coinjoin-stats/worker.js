/**
 * coinjoin-stats Cloudflare Worker
 *
 * Reverse proxy + parser-translator + CORS + edge cache for:
 *   - whirlpoolstats.xyz/           (HTML, scraped for headline stats)
 *   - whirlpoolstats.xyz/whirlpool_stats.csv (per-block current-capacity CSV)
 *   - liquisabi.com/api             (JSON-RPC POST, method "dashboard")
 *
 * The Whirlpool endpoints emit our own slim JSON schema by running
 * `parser.js` against the upstream payloads. See parser.js for semantics.
 */

import { parseSummaryHtml, parseStatsCsv, downsample } from "./parser.js";

const WHIRLPOOLSTATS_BASE = "https://www.whirlpoolstats.xyz";
const LIQUISABI_URL = "https://liquisabi.com/api";

const WHIRLPOOL_PATH_RE = /^\/whirlpool\/(summary|charts)$/;
const LIQUISABI_PATH = "/liquisabi/api";

const ALLOWED_LIQUISABI_METHODS = new Set(["dashboard"]);

const TTL_SUMMARY = 60;
const TTL_CHARTS = 120;
const TTL_LIQUISABI = 60;

// Body caps split between upstream ingestion (CSV can grow) and response path.
const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024; // ~10 years of CSV growth headroom
const MAX_BODY_BYTES = 1024 * 1024;          // response cap (post-parse / post-downsample)

const DEFAULT_ORIGINS = [
  "https://am-i.exposed",
  "http://localhost:3000",
  "http://localhost:8787",
];

function resolveOrigins(env) {
  const list = (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_ORIGINS;
}

function corsHeaders(env, requestOrigin) {
  const list = resolveOrigins(env);
  const echo = requestOrigin && list.includes(requestOrigin) ? requestOrigin : list[0];
  return {
    "Access-Control-Allow-Origin": echo,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

const handler = {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(env, origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === "GET") {
      const wpMatch = url.pathname.match(WHIRLPOOL_PATH_RE);
      if (wpMatch) {
        return wpMatch[1] === "summary"
          ? handleWhirlpoolSummary(ctx, cors)
          : handleWhirlpoolCharts(ctx, cors);
      }
      return notFound(cors);
    }

    if (request.method === "POST" && url.pathname === LIQUISABI_PATH) {
      return handleLiquiSabi(request, ctx, cors);
    }

    return new Response("Method not allowed", { status: 405, headers: cors });
  },
};

export default handler;

// ---------- Whirlpool: summary (HTML scrape) ----------

async function handleWhirlpoolSummary(ctx, cors) {
  const cacheKey = new Request("https://cache.local/whirlpool/summary", { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached, cors);

  let upstream;
  try {
    upstream = await fetch(`${WHIRLPOOLSTATS_BASE}/`, {
      headers: { Accept: "text/html" },
    });
  } catch {
    return errorResponse("UPSTREAM_DOWN", "whirlpoolstats.xyz unreachable", cors);
  }
  if (!upstream.ok) {
    return errorResponse("UPSTREAM_HTTP", `whirlpoolstats.xyz HTTP ${upstream.status}`, cors);
  }
  const html = await readLimited(upstream, MAX_UPSTREAM_BYTES);
  if (html === null) {
    return errorResponse("UPSTREAM_HTTP", "HTML response exceeded cap", cors);
  }

  const parsed = parseSummaryHtml(html);
  if (parsed.error) {
    return structuredErrorResponse(parsed.error, cors);
  }

  // Edge cache override: whirlpoolstats sends `max-age=0, must-revalidate`,
  // we replace with our own contract since we control freshness here.
  const response = new Response(JSON.stringify(parsed), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${TTL_SUMMARY}`,
      ...cors,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// ---------- Whirlpool: charts (CSV scrape) ----------

async function handleWhirlpoolCharts(ctx, cors) {
  const cacheKey = new Request("https://cache.local/whirlpool/charts", { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached, cors);

  let upstream;
  try {
    upstream = await fetch(`${WHIRLPOOLSTATS_BASE}/whirlpool_stats.csv`, {
      headers: { Accept: "text/csv" },
    });
  } catch {
    return errorResponse("UPSTREAM_DOWN", "whirlpoolstats.xyz unreachable", cors);
  }
  if (!upstream.ok) {
    return errorResponse("UPSTREAM_HTTP", `whirlpool_stats.csv HTTP ${upstream.status}`, cors);
  }
  const csv = await readLimited(upstream, MAX_UPSTREAM_BYTES);
  if (csv === null) {
    return errorResponse("UPSTREAM_HTTP", "CSV response exceeded cap", cors);
  }

  const charts = parseStatsCsv(csv);
  if (charts.error) {
    return structuredErrorResponse(charts.error, cors);
  }

  const downsampled = downsample(charts, 512);
  const body = JSON.stringify(downsampled);
  if (body.length > MAX_BODY_BYTES) {
    return errorResponse("UPSTREAM_HTTP", "Response payload too large", cors);
  }

  const response = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${TTL_CHARTS}`,
      ...cors,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// ---------- LiquiSabi (unchanged) ----------

async function handleLiquiSabi(request, ctx, cors) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  if (
    !body ||
    body.jsonrpc !== "2.0" ||
    typeof body.method !== "string" ||
    !ALLOWED_LIQUISABI_METHODS.has(body.method)
  ) {
    return new Response(JSON.stringify({ error: "Invalid or disallowed method" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  const cacheKey = new Request(`https://cache.local/liquisabi/${body.method}`, { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached, cors);

  let upstream;
  try {
    upstream = await fetch(LIQUISABI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: body.method,
        params: body.params ?? {},
        id: 1,
      }),
    });
  } catch {
    return errorResponse("UPSTREAM_DOWN", "liquisabi.com unreachable", cors);
  }
  if (!upstream.ok) {
    return errorResponse("UPSTREAM_HTTP", `liquisabi HTTP ${upstream.status}`, cors);
  }
  const text = await readLimited(upstream, MAX_BODY_BYTES);
  if (text === null) {
    return errorResponse("UPSTREAM_HTTP", "Response payload too large", cors);
  }

  const response = new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${TTL_LIQUISABI}`,
      ...cors,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// ---------- Plumbing ----------

async function readLimited(response, cap) {
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
  return new TextDecoder().decode(concat(chunks));
}

function concat(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function errorResponse(code, message, cors) {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors },
    },
  );
}

function structuredErrorResponse(err, cors) {
  return new Response(
    JSON.stringify({ error: err }),
    {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors },
    },
  );
}

function notFound(cors) {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain", ...cors },
  });
}

function withCors(response, cors) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}
