const http = require("http");
const https = require("https");
const { SocksProxyAgent } = require("socks-proxy-agent");

const PORT = parseInt(process.env.PORT || "3001", 10);
const TOR_PROXY_IP = process.env.TOR_PROXY_IP || "10.21.21.11";
const TOR_PROXY_PORT = parseInt(process.env.TOR_PROXY_PORT || "9050", 10);
const UPSTREAM_BASE =
  process.env.UPSTREAM_BASE ||
  "https://chainalysis-proxy.copexit.workers.dev";

// socks5h:// means the SOCKS proxy handles DNS resolution (no DNS leak)
const agent = new SocksProxyAgent(
  `socks5h://${TOR_PROXY_IP}:${TOR_PROXY_PORT}`
);

const ADDR_RE = /^\/chainalysis\/address\/([a-zA-Z0-9]+)$/;
const REQUEST_TIMEOUT_MS = 30_000;

function fetchViaAgent(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "GET",
        agent,
        headers: { Accept: "application/json" },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`Upstream ${res.statusCode}: ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Upstream request timed out"));
    });
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
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
      JSON.stringify({ error: "Invalid path. Use /chainalysis/address/{btc_address}" })
    );
    return;
  }

  const address = match[1];
  const upstreamUrl = `${UPSTREAM_BASE}/address/${address}`;

  try {
    const body = await fetchViaAgent(upstreamUrl);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
  } catch (err) {
    console.error(`Tor proxy error for ${address}: ${err.message}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Tor proxy upstream request failed" }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Tor proxy sidecar listening on port ${PORT}`);
  console.log(`Routing via socks5h://${TOR_PROXY_IP}:${TOR_PROXY_PORT}`);
});
