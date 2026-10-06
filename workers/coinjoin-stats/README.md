# CoinJoin Stats CORS Proxy

Cloudflare Worker that reverse-proxies two upstream CoinJoin data sources so the am-i.exposed frontend (a static site) can query them from the browser:

- `https://whirlpoolstats.xyz/api/(summary|charts|txs)` (REST JSON)
- `https://liquisabi.com/api` (JSON-RPC 2.0, method `dashboard` only)

Both upstreams omit CORS headers, so the worker forwards the request server-side and adds `Access-Control-Allow-Origin`. The Whirlpool JSON is passed through verbatim. Responses are edge-cached for 60-120s to absorb load.

## Routes

| Method | Path                  | Upstream                                     | Cache |
|--------|-----------------------|----------------------------------------------|-------|
| GET    | `/whirlpool/summary`  | `whirlpoolstats.xyz/api/summary`             | 60s   |
| GET    | `/whirlpool/charts`   | `whirlpoolstats.xyz/api/charts`              | 120s  |
| GET    | `/whirlpool/txs`      | `whirlpoolstats.xyz/api/txs?page=N`          | 60s   |
| POST   | `/liquisabi/api`      | `liquisabi.com/api` (method=`dashboard`)     | 60s   |
| any    | other                 | -                                            | 404   |

The `?page=` query on `/whirlpool/txs` is forwarded (clamped to a positive integer) and folded into the edge-cache key.

The JSON-RPC method is allowlisted server-side. The legacy `/liquisabi/api` route uses `ALLOWED_LIQUISABI_METHODS` in `worker.js`; new methods go in `src/lib/services/registry.json` and are served via `/svc` (see below).

## /svc route

`/svc/<id>/<path>` is a registry-driven proxy. Services, routes, JSON-RPC methods, classes and TTLs are read from `src/lib/services/registry.json` (shared with the frontend), so adding a service needs no worker code change.

- `aggregate` calls are edge-cached for the registry `ttl`.
- `lookup` calls (carrying a user txid) are validated, forwarded with a rebuilt JSON-RPC body, and answered with `Cache-Control: no-store`. They never touch the edge cache.
- Unknown services/routes give 404, bodies over 64 KB give 413, bad params 400, upstream failures 502.

The legacy `/whirlpool/*` and `/liquisabi/api` routes are kept for one release.

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
- **Method allowlist** for JSON-RPC: the legacy `/liquisabi/api` route allows `dashboard` only; `/svc` allows only the methods each route declares in `src/lib/services/registry.json`, and `lookup` params are validated (txid shape) before forwarding.
- **Body cap** of 4 MB rejects oversized upstream responses.
- **No logging.** The worker does not log request bodies, IPs, or responses.

## Self-hosted alternative

On Umbrel / StartOS the app does **not** hit this worker. Instead it uses the local `umbrel/tor-proxy/` sidecar, which serves the legacy paths plus the same registry-driven `/svc/<id>/<path>` route (identical validation, no cache, every response `no-store`) and forwards through Tor SOCKS5h to each service's onion address when the registry lists one, otherwise its clearnet base. The worker only serves the public GitHub Pages deployment.
