const TOR_EXIT_LIST_URL = "https://check.torproject.org/torbulkexitlist";
const LIST_CACHE_TTL = 3600; // Re-fetch exit node list every hour

// In-memory cache (persists within a single Worker isolate)
let exitNodes = null;
let lastFetch = 0;

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

    const clientIp = request.headers.get("CF-Connecting-IP");
    if (!clientIp) {
      return jsonResponse({ isTor: false }, env);
    }

    // Refresh exit node list if stale or missing
    const now = Date.now();
    if (!exitNodes || now - lastFetch > LIST_CACHE_TTL * 1000) {
      try {
        const res = await fetch(TOR_EXIT_LIST_URL, {
          cf: { cacheTtl: LIST_CACHE_TTL },
        });
        if (res.ok) {
          const text = await res.text();
          exitNodes = new Set(
            text
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line && !line.startsWith("#")),
          );
          lastFetch = now;
        }
      } catch {
        // If list unavailable and no cached copy, we cannot determine
        if (!exitNodes) {
          return jsonResponse({ isTor: false, error: "exit list unavailable" }, env);
        }
      }
    }

    const isTor = exitNodes.has(clientIp);
    return jsonResponse({ isTor }, env);
  },
};

export default handler;

function jsonResponse(data, env) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      ...corsHeaders(env),
    },
  });
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "https://am-i.exposed",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
