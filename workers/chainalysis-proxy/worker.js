const CHAINALYSIS_BASE = "https://public.chainalysis.com/api/v1/address";

const handler = {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    // Only allow GET
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders(env) });
    }

    // Extract address from path: /address/{address}
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/address\/([13mn2][a-km-zA-HJ-NP-Z1-9]{25,34}|(bc1|tb1)[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{39,87})$/);
    if (!match) {
      return new Response("Invalid path. Use /address/{btc_address}", {
        status: 400,
        headers: corsHeaders(env),
      });
    }

    const address = match[1];

    // Per-IP quota (RATE_LIMITER binding in wrangler.toml) so the shared API
    // key cannot be exhausted by a single caller. CORS does not stop curl.
    // Fail closed if the binding is missing (stale deploy or local run
    // without wrangler.toml): never hit the upstream unmetered.
    if (!env.RATE_LIMITER) {
      return new Response(JSON.stringify({ error: "Rate limiter not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(env) },
      });
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "60", ...corsHeaders(env) },
      });
    }

    try {
      const res = await fetch(`${CHAINALYSIS_BASE}/${address}`, {
        headers: {
          Accept: "application/json",
          "X-API-KEY": env.CHAINALYSIS_API_KEY,
        },
      });

      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(env),
        },
      });
    } catch {
      return new Response(JSON.stringify({ error: "Upstream request failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(env) },
      });
    }
  },
};

export default handler;

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
