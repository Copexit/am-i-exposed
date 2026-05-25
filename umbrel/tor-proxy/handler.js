/**
 * Pure request-handler factory for the tor-proxy sidecar.
 *
 * Split out from server.js so it can be unit-tested without pulling in the
 * socks-proxy-agent dependency (which is only installed inside the Docker image).
 */

const UPSTREAM_BASE_DEFAULT = "https://chainalysis-proxy.copexit.workers.dev";
const WHIRLPOOL_BASE_DEFAULT = "https://whirlpool.observer/api";
const LIQUISABI_URL_DEFAULT = "https://liquisabi.com/api";

const ADDR_RE = /^\/chainalysis\/address\/([13mn2][a-km-zA-HJ-NP-Z1-9]{25,34}|(bc1|tb1)[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{39,87})$/;
const OBSERVATORY_WHIRLPOOL_RE = /^\/observatory\/whirlpool\/(summary|charts)(\?.*)?$/;
const OBSERVATORY_LIQUISABI_PATH = "/observatory/liquisabi/api";
const ALLOWED_LIQUISABI_METHODS = new Set(["dashboard"]);

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 64 * 1024) {
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString();
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function createHandler({
  fetchViaAgent,
  upstreamBase = UPSTREAM_BASE_DEFAULT,
  whirlpoolBase = WHIRLPOOL_BASE_DEFAULT,
  liquiSabiUrl = LIQUISABI_URL_DEFAULT,
  logger = console,
} = {}) {
  if (typeof fetchViaAgent !== "function") {
    throw new Error("fetchViaAgent is required");
  }

  async function handleObservatoryWhirlpool(req, res, segment) {
    try {
      const body = await fetchViaAgent(`${whirlpoolBase}/${segment}`);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch (err) {
      logger.error(`Observatory whirlpool error: ${err.message}`);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Tor proxy upstream request failed" }));
    }
  }

  async function handleObservatoryLiquiSabi(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
    if (
      !body ||
      body.jsonrpc !== "2.0" ||
      typeof body.method !== "string" ||
      !ALLOWED_LIQUISABI_METHODS.has(body.method)
    ) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or disallowed method" }));
      return;
    }
    const forwardBody = JSON.stringify({
      jsonrpc: "2.0",
      method: body.method,
      params: body.params || {},
      id: 1,
    });
    try {
      const upstream = await fetchViaAgent(liquiSabiUrl, {
        method: "POST",
        body: forwardBody,
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(upstream);
    } catch (err) {
      logger.error(`Observatory liquisabi error: ${err.message}`);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Tor proxy upstream request failed" }));
    }
  }

  return async function handler(req, res) {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (req.url === OBSERVATORY_LIQUISABI_PATH) {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }
      await handleObservatoryLiquiSabi(req, res);
      return;
    }

    const wpMatch = req.url.match(OBSERVATORY_WHIRLPOOL_RE);
    if (wpMatch) {
      if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }
      await handleObservatoryWhirlpool(req, res, wpMatch[1]);
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const match = req.url.match(ADDR_RE);
    if (!match) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "Invalid path. Use /chainalysis/address/{btc_address} or /observatory/...",
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
      logger.error(`Tor proxy error: ${err.message}`);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Tor proxy upstream request failed" }));
    }
  };
}

module.exports = {
  createHandler,
  ALLOWED_LIQUISABI_METHODS,
  ADDR_RE,
  OBSERVATORY_WHIRLPOOL_RE,
  OBSERVATORY_LIQUISABI_PATH,
};
