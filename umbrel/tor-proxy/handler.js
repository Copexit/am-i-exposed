/**
 * Pure request-handler factory for the tor-proxy sidecar.
 *
 * Split out from server.js so it can be unit-tested without pulling in the
 * socks-proxy-agent dependency.
 */

const { createSvcHandler } = require("./svc");

const UPSTREAM_BASE_DEFAULT = "https://chainalysis-proxy.copexit.workers.dev";

const ADDR_RE = /^\/chainalysis\/address\/([13mn2][a-km-zA-HJ-NP-Z1-9]{25,34}|(bc1|tb1)[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{39,87})$/;

function createHandler({
  fetchViaAgent,
  upstreamBase = UPSTREAM_BASE_DEFAULT,
  logger = console,
  services = require("./services.json").services,
} = {}) {
  if (typeof fetchViaAgent !== "function") {
    throw new Error("fetchViaAgent is required");
  }

  const handleSvc = createSvcHandler({ fetchViaAgent, services, logger });

  return async function handler(req, res) {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end("ok");
      return;
    }

    if (req.url.startsWith("/svc/")) return handleSvc(req, res);

    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const match = req.url.match(ADDR_RE);
    if (!match) {
      res.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(
        JSON.stringify({
          error:
            "Invalid path. Use /chainalysis/address/{btc_address} or /svc/...",
        }),
      );
      return;
    }

    const address = match[1];
    const upstreamUrl = `${upstreamBase}/address/${address}`;
    try {
      const body = await fetchViaAgent(upstreamUrl);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch (err) {
      // The upstream worker's per-IP quota is shared per Tor exit: pass the
      // 429 through so the UI can say "retry shortly" instead of "sidecar down".
      if (err.status === 429) {
        res.writeHead(429, { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "60" });
        res.end(JSON.stringify({ error: "Rate limit exceeded" }));
        return;
      }
      logger.error(`Tor proxy error: ${err.message}`);
      res.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Tor proxy upstream request failed" }));
    }
  };
}

module.exports = { createHandler, ADDR_RE };
