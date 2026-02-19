# Tor Exit Node Check Proxy

Cloudflare Worker that detects whether the connecting client is using the Tor network by checking `CF-Connecting-IP` against the official Tor bulk exit node list.

## Why a proxy?

The Tor Project's check API (`check.torproject.org/api/ip`) does not send CORS headers, so browser `fetch()` calls fail. This worker runs server-side on Cloudflare's edge, checks the client IP against the exit node list, and returns a simple `{"isTor": true/false}` response with proper CORS headers.

**Privacy**: The client IP is never included in the response - only a boolean is returned.

## How it works

1. Client makes `GET /` to the worker
2. Worker reads `CF-Connecting-IP` header (set by Cloudflare)
3. Worker fetches/caches the Tor exit node list from `check.torproject.org/torbulkexitlist` (refreshed hourly)
4. Returns `{"isTor": true}` or `{"isTor": false}`

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A Cloudflare account (free tier works)

### Deploy

```bash
# 1. Install Wrangler (Cloudflare's CLI)
npm install -g wrangler

# 2. Authenticate with your Cloudflare account
wrangler login

# 3. Navigate to the worker directory
cd workers/tor-check

# 4. Deploy
wrangler deploy
```

After deployment, Wrangler will print the worker URL (e.g., `https://tor-check.<your-subdomain>.workers.dev`).

### Configure the frontend

Set the worker URL in the frontend environment:

```bash
# In the am-i-exposed root .env or .env.local:
NEXT_PUBLIC_TOR_CHECK_URL=https://tor-check.<your-subdomain>.workers.dev
```

Or the hardcoded default in `src/hooks/useTorDetection.ts` will be used.

## Security

- **Privacy**: Only `{"isTor": boolean}` is returned - no IP addresses are leaked to the client.
- **CORS**: Restricted to `https://am-i.exposed` via `ALLOWED_ORIGIN` in `wrangler.toml`.
- **Caching**: Exit node list is cached in the Worker isolate for 1 hour and via Cloudflare edge cache. Browser responses are cached for 5 minutes.
- **No logging**: The worker does not log client IPs or any request data.

## Local development

```bash
wrangler dev
```

The local dev server runs at `http://localhost:8787`. You may need to temporarily set `ALLOWED_ORIGIN = "*"` in wrangler.toml for local testing (don't commit this).
