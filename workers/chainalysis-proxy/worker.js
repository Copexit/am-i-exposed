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
    const match = url.pathname.match(/^\/address\/([a-zA-Z0-9]+)$/);
    if (!match) {
      return new Response("Invalid path. Use /address/{btc_address}", {
        status: 400,
        headers: corsHeaders(env),
      });
    }

    const address = match[1];

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
