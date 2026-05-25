# CoinJoin Stats CORS Proxy

Cloudflare Worker that reverse-proxies two upstream CoinJoin data sources so the am-i.exposed frontend (a static site) can query them from the browser:

- `https://whirlpool.observer/api/(summary|charts)` (REST)
- `https://liquisabi.com/api` (JSON-RPC 2.0, method `dashboard` only)

Both upstreams omit CORS headers, so the worker forwards the request server-side and adds `Access-Control-Allow-Origin`. Responses are edge-cached for 60-120s to absorb load.

## Routes

| Method | Path                  | Upstream                                  | Cache |
|--------|-----------------------|-------------------------------------------|-------|
| GET    | `/whirlpool/summary`  | `whirlpool.observer/api/summary`          | 60s   |
| GET    | `/whirlpool/charts`   | `whirlpool.observer/api/charts`           | 120s  |
| POST   | `/liquisabi/api`      | `liquisabi.com/api` (method=`dashboard`)  | 60s   |
| any    | other                 | -                                         | 404   |

The JSON-RPC method is allowlisted server-side. Any future method (e.g. `coords`, `rounds-paginated`) must be added to `ALLOWED_LIQUISABI_METHODS` in `worker.js` and reviewed.

## Setup

```bash
# 1. Install Wrangler
npm install -g wrangler

# 2. Authenticate
wrangler login

# 3. Deploy
cd workers/coinjoin-stats
wrangler deploy
```

No API keys or secrets - both upstreams are public.

## Local development

```bash
cd workers/coinjoin-stats
wrangler dev
```

Local dev server runs at `http://localhost:8787`. Set `ALLOWED_ORIGIN = "*"` in `.dev.vars` if you need to test from arbitrary origins (don't commit).

## Security & privacy

- **No secrets.** Both upstreams are unauthenticated.
- **CORS** restricted to `https://am-i.exposed` via `wrangler.toml`. Change `ALLOWED_ORIGIN` if deploying to a different domain.
- **Method allowlist** for JSON-RPC enforces `dashboard` only.
- **Body cap** of 1 MB rejects oversized upstream responses.
- **No logging.** The worker does not log request bodies, IPs, or responses.

## Self-hosted alternative

On Umbrel / StartOS the app does **not** hit this worker. Instead it uses the local `umbrel/tor-proxy/` sidecar, which forwards the same paths through Tor SOCKS5h directly to the upstreams. The worker only serves the public GitHub Pages deployment.
