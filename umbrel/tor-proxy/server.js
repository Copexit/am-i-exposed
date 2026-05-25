const http = require("http");
const https = require("https");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { createHandler } = require("./handler");

const PORT = parseInt(process.env.PORT || "3001", 10);
const TOR_PROXY_IP = process.env.TOR_PROXY_IP || "10.21.21.11";
const TOR_PROXY_PORT = parseInt(process.env.TOR_PROXY_PORT || "9050", 10);
const UPSTREAM_BASE =
  process.env.UPSTREAM_BASE ||
  "https://chainalysis-proxy.copexit.workers.dev";

// socks5h:// means the SOCKS proxy handles DNS resolution (no DNS leak)
const agent = new SocksProxyAgent(
  `socks5h://${TOR_PROXY_IP}:${TOR_PROXY_PORT}`,
);

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MB limit to prevent memory exhaustion

function fetchViaAgent(url, { method = "GET", body, contentType } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = { Accept: "application/json" };
    if (body) {
      headers["Content-Type"] = contentType || "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        agent,
        headers,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        let totalBytes = 0;
        res.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            req.destroy();
            reject(new Error("Upstream response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const out = Buffer.concat(chunks).toString();
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(out);
          } else {
            reject(new Error(`Upstream ${res.statusCode}: ${out.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Upstream request timed out"));
    });
    if (body) req.write(body);
    req.end();
  });
}

const handler = createHandler({ fetchViaAgent, upstreamBase: UPSTREAM_BASE });

const server = http.createServer(handler);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Tor proxy sidecar listening on port ${PORT}`);
  console.log(`Routing via socks5h://${TOR_PROXY_IP}:${TOR_PROXY_PORT}`);
});

// Graceful shutdown
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
