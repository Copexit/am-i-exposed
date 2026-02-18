# Chainalysis CORS Proxy

Cloudflare Worker that proxies requests to the Chainalysis public sanctions API, adding CORS headers so the am-i.exposed frontend (a static site) can query it from the browser.

## Why a proxy?

The Chainalysis public API (`public.chainalysis.com`) does not send CORS headers, so browser-based `fetch()` calls fail. This worker sits between the frontend and Chainalysis, forwarding the request server-side and adding the necessary `Access-Control-Allow-Origin` header.

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A Cloudflare account (free tier works)

### Steps

```bash
# 1. Install Wrangler (Cloudflare's CLI)
npm install -g wrangler

# 2. Authenticate with your Cloudflare account
wrangler login

# 3. Navigate to the worker directory
cd workers/chainalysis-proxy

# 4. Store the API key as an encrypted secret (NEVER in config files)
wrangler secret put CHAINALYSIS_API_KEY
# Paste your Chainalysis API key when prompted

# 5. Deploy
wrangler deploy
```

After deployment, Wrangler will print the worker URL (e.g., `https://chainalysis-proxy.<your-subdomain>.workers.dev`).

### Configure the frontend

Set the worker URL in the frontend environment:

```bash
# In the am-i-exposed root .env or .env.local:
NEXT_PUBLIC_CHAINALYSIS_PROXY_URL=https://chainalysis-proxy.<your-subdomain>.workers.dev/address
```

Or modify `src/lib/analysis/cex-risk/chainalysis-check.ts` directly.

## Security

- **API key**: Stored as a Cloudflare secret (`wrangler secret put`), encrypted at rest, never visible in the dashboard or source code.
- **CORS**: Restricted to `https://am-i.exposed` via the `ALLOWED_ORIGIN` env var in `wrangler.toml`. Change this if deploying to a different domain.
- **Endpoint**: Only `GET /address/{btc_address}` is proxied. All other paths return 400.
- **No logging**: The worker does not log request data or API responses.

## Local development

```bash
# Run locally (uses vars from wrangler.toml, secrets from .dev.vars)
echo "CHAINALYSIS_API_KEY=your_key_here" > .dev.vars
wrangler dev
```

The local dev server runs at `http://localhost:8787`. You may need to temporarily set `ALLOWED_ORIGIN = "*"` in wrangler.toml for local testing (don't commit this).
