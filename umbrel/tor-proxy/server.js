const http = require("http");
const https = require("https");
const { SocksProxyAgent } = require("socks-proxy-agent");
const WebSocket = require("ws");
const { createHandler } = require("./handler");
const { createFetchViaAgent } = require("./fetch-via-agent");

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
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024; // 4 MiB cap (30-day Wabisator flow-map is ~0.9 MB)

const fetchViaAgent = createFetchViaAgent({
  http,
  https,
  agent,
  maxBytes: MAX_RESPONSE_BYTES,
  defaultTimeoutMs: REQUEST_TIMEOUT_MS,
});

/** ws through the same Tor agent, adapted to the { send, close, onMessage, onClose, onError } shape. */
function openSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { agent, handshakeTimeout: 15000 });
    ws.once("open", () =>
      resolve({
        send: (s) => ws.send(s),
        close: () => ws.close(),
        onMessage: (fn) => ws.on("message", (data) => fn(data.toString())),
        onClose: (fn) => ws.on("close", () => fn()),
        onError: (fn) => ws.on("error", () => fn()),
      }),
    );
    ws.once("error", reject);
  });
}

const handler = createHandler({ fetchViaAgent, openSocket, upstreamBase: UPSTREAM_BASE });

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
