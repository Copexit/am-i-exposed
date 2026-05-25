/**
 * coinjoin-stats Cloudflare Worker
 *
 * Reverse proxy + CORS + edge cache for:
 *   - whirlpool.observer/api/(summary|charts) (GET)
 *   - liquisabi.com/api (POST JSON-RPC, method "dashboard")
 *
 * No secrets, no logging.
 */

const WHIRLPOOL_BASE = "https://whirlpool.observer/api";
const LIQUISABI_URL = "https://liquisabi.com/api";

const WHIRLPOOL_PATH_RE = /^\/whirlpool\/(summary|charts)$/;
const LIQUISABI_PATH = "/liquisabi/api";

const ALLOWED_LIQUISABI_METHODS = new Set(["dashboard"]);

const TTL_SUMMARY = 60;
const TTL_CHARTS = 120;
const TTL_LIQUISABI = 60;

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

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
        return handleWhirlpool(ctx, wpMatch[1], cors);
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

async function handleWhirlpool(ctx, segment, cors) {
  const ttl = segment === "charts" ? TTL_CHARTS : TTL_SUMMARY;
  const cacheKey = new Request(`https://cache.local/whirlpool/${segment}`, {
    method: "GET",
  });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    return withCors(cached, cors);
  }

  let upstream;
  try {
    upstream = await fetch(`${WHIRLPOOL_BASE}/${segment}`, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: ttl, cacheEverything: true },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Upstream request failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: `Upstream HTTP ${upstream.status}` }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", ...cors },
      },
    );
  }

  const body = await readLimited(upstream);
  if (body === null) {
    return new Response(JSON.stringify({ error: "Upstream response too large" }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  const response = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${ttl}`,
      ...cors,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

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

  const cacheKey = new Request(
    `https://cache.local/liquisabi/${body.method}`,
    { method: "GET" },
  );
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    return withCors(cached, cors);
  }

  let upstream;
  try {
    upstream = await fetch(LIQUISABI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: body.method,
        params: body.params ?? {},
        id: 1,
      }),
      cf: { cacheTtl: TTL_LIQUISABI, cacheEverything: false },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Upstream request failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: `Upstream HTTP ${upstream.status}` }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", ...cors },
      },
    );
  }

  const text = await readLimited(upstream);
  if (text === null) {
    return new Response(JSON.stringify({ error: "Upstream response too large" }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors },
    });
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

async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
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
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function notFound(cors) {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain", ...cors },
  });
}

function withCors(response, cors) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
