# Umbrel App Development Guide

## Overview

am-i.exposed runs as a self-hosted Umbrel app that routes all API calls through the user's local mempool.space instance. No data leaves the local network. Chainalysis sanctions checks are routed through Tor via a sidecar container.

**Architecture:**
```
Browser -> Umbrel app_proxy (auth) -> nginx (port 8080) -> static SPA
                                          |
                                          +-> /api/*           -> local mempool:3006/api/*
                                          +-> /signet/api/*    -> local mempool:3006/api/*
                                          +-> /testnet4/api/*  -> local mempool:3006/api/*
                                          +-> /tor-proxy/*     -> tor-proxy sidecar:3001
                                                                    -> socks5h://10.21.21.11:9050
                                                                        -> chainalysis-proxy.copexit.workers.dev
```

## Repositories

| Repo | Purpose |
|------|---------|
| `github.com/Copexit/am-i-exposed` | Main app source + Dockerfile.umbrel + nginx config + tor-proxy sidecar |
| `github.com/Copexit/copexit-umbrel-app-store` | Umbrel community app store (manifest, docker-compose, icon) |

## Docker Images

The app uses **two Docker images**:

| Image | Registry | Source | Purpose |
|-------|----------|--------|---------|
| `am-i-exposed-umbrel` | `ghcr.io/copexit/am-i-exposed-umbrel` | `Dockerfile.umbrel` | nginx serving static SPA + reverse proxy |
| `am-i-exposed-tor-proxy` | `ghcr.io/copexit/am-i-exposed-tor-proxy` | `umbrel/tor-proxy/Dockerfile` | Node.js HTTP-to-SOCKS5 bridge for Tor |

- **IMPORTANT:** Both GHCR packages must be set to **public** visibility, otherwise Umbrel instances get 401 when pulling
- **Base images:** nginx-unprivileged:1.27-alpine (web), node:22-alpine (tor-proxy)
- **Do NOT set `user: "1000:1000"`** in docker-compose for the web service - it breaks nginx-unprivileged's file permissions

### Tor proxy sidecar

Located at `umbrel/tor-proxy/`. A minimal Node.js server (~90 lines) with a single dependency (`socks-proxy-agent`).

- Listens on port 3001
- Route: `GET /chainalysis/address/{address}` - forwards to the Chainalysis Cloudflare Worker via Tor
- Route: `GET /health` - returns `ok`
- Uses `socks5h://` (DNS resolution through Tor, prevents DNS leaks)
- 30s timeout per upstream request (Tor circuit latency)
- Env vars: `PORT`, `TOR_PROXY_IP`, `TOR_PROXY_PORT`

### Building locally

```bash
# Main app (requires network for pnpm install)
docker build -f Dockerfile.umbrel -t ghcr.io/copexit/am-i-exposed-umbrel:vX.Y.Z .

# Tor proxy sidecar
docker build -t ghcr.io/copexit/am-i-exposed-tor-proxy:vX.Y.Z ./umbrel/tor-proxy
```

For sandboxed environments (no network in Docker build), build the static export first then use a minimal Dockerfile:
```bash
pnpm build
# Temporarily remove "out" from .dockerignore, then:
cat > /tmp/Dockerfile.local << 'EOF'
FROM nginxinc/nginx-unprivileged:1.27-alpine
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
USER 1000
COPY umbrel/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY out/ /usr/share/nginx/html
EXPOSE 8080
EOF
docker build -f /tmp/Dockerfile.local -t ghcr.io/copexit/am-i-exposed-umbrel:vX.Y.Z .
# Restore .dockerignore
```

### CI/CD

Two GitHub Actions workflows, both triggered on `v*` tags:

| Workflow | File | Image |
|----------|------|-------|
| Build Umbrel Docker Image | `.github/workflows/docker-umbrel.yml` | `am-i-exposed-umbrel` |
| Build Tor Proxy Sidecar Image | `.github/workflows/docker-tor-proxy.yml` | `am-i-exposed-tor-proxy` |

Both build for `linux/amd64` + `linux/arm64` (Raspberry Pi). The sidecar builds fast (~1 min); the main image is slower (~5-10 min, arm64 cross-compilation via QEMU).

### Pushing manually

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
docker push ghcr.io/copexit/am-i-exposed-umbrel:vX.Y.Z
docker push ghcr.io/copexit/am-i-exposed-tor-proxy:vX.Y.Z
```

## Community App Store Structure

```
copexit-umbrel-app-store/
  umbrel-app-store.yml          # id: copexit, name: Copexit
  copexit-am-i-exposed/
    umbrel-app.yml              # App manifest (name, version, deps, icon URL)
    docker-compose.yml          # app_proxy + web + tor-proxy services
    exports.sh                  # Static IPs: web=10.21.22.50, tor-proxy=10.21.22.51
    icon.svg                    # 256x256 eye logo (square corners, no rounded rect)
```

### Key manifest fields (`umbrel-app.yml`)

```yaml
manifestVersion: 1
id: copexit-am-i-exposed
category: bitcoin
name: "am-i.exposed"
version: "0.2.0"
icon: https://raw.githubusercontent.com/Copexit/copexit-umbrel-app-store/master/copexit-am-i-exposed/icon.svg
dependencies:
  - mempool
port: 3080
```

### Icon gotcha for community stores

Umbrel's icon fallback URL points to `getumbrel.github.io/umbrel-apps-gallery/{app-id}/icon.svg` which only works for official apps. Community apps **must** set an explicit `icon:` field in `umbrel-app.yml` with a full public URL. Use raw.githubusercontent.com for the repo's icon.svg.

The same applies to `gallery:` images - they must be full URLs, not filenames.

### docker-compose.yml

```yaml
version: "3.7"
services:
  app_proxy:
    environment:
      APP_HOST: copexit-am-i-exposed_web_1
      APP_PORT: 8080
      PROXY_AUTH_ADD: "false"
  web:
    image: ghcr.io/copexit/am-i-exposed-umbrel:v0.2.0
    init: true
    restart: on-failure
    environment:
      APP_MEMPOOL_IP: ${APP_MEMPOOL_IP}        # Injected by Umbrel from mempool's exports.sh
      APP_MEMPOOL_PORT: ${APP_MEMPOOL_PORT}
      APP_TOR_PROXY_IP: ${APP_COPEXIT_AM_I_EXPOSED_TOR_PROXY_IP}   # 10.21.22.51 from our exports.sh
      APP_TOR_PROXY_PORT: "3001"
    depends_on:
      - tor-proxy
    networks:
      default:
        ipv4_address: ${APP_COPEXIT_AM_I_EXPOSED_IP}  # 10.21.22.50
  tor-proxy:
    image: ghcr.io/copexit/am-i-exposed-tor-proxy:v0.1.0
    init: true
    restart: on-failure
    environment:
      PORT: "3001"
      TOR_PROXY_IP: ${TOR_PROXY_IP}            # 10.21.21.11 - Umbrel's global Tor SOCKS5 proxy
      TOR_PROXY_PORT: ${TOR_PROXY_PORT}         # 9050
    networks:
      default:
        ipv4_address: ${APP_COPEXIT_AM_I_EXPOSED_TOR_PROXY_IP}  # 10.21.22.51
```

**Environment variables injected by Umbrel** into every app container:
- `TOR_PROXY_IP` = `10.21.21.11` (Umbrel's global Tor SOCKS5 proxy)
- `TOR_PROXY_PORT` = `9050`
- `APP_MEMPOOL_IP` / `APP_MEMPOOL_PORT` (from mempool app's exports.sh)

**Do NOT add `user: "1000:1000"`** to the web service - nginx-unprivileged runs as UID 101.

## Nginx Config Template

Located at `umbrel/nginx.conf.template`. Uses `nginxinc/nginx-unprivileged` auto-envsubst: files in `/etc/nginx/templates/*.template` are processed at startup, substituting `${VAR}` from environment.

Key proxy rules:
- `/api/*` -> `http://${APP_MEMPOOL_IP}:${APP_MEMPOOL_PORT}/api/*` (direct proxy to local mempool)
- `/(signet|testnet4)/api/*` -> rewritten to `/api/*` then proxied (network-prefix stripping)
- `/tor-proxy/*` -> `http://${APP_TOR_PROXY_IP}:${APP_TOR_PROXY_PORT}/` (Tor proxy sidecar, 60s read timeout)

The network-prefix stripping is necessary because the app constructs URLs like `/signet/api/tx/{txid}` for non-mainnet networks, but the local mempool already runs on the correct network, so `/api/tx/{txid}` suffices.

The `/tor-proxy/` route has a 60s read timeout (vs 30s for API) because Tor circuits can be slow on first use.

## Privacy Architecture on Umbrel

When running on Umbrel (local API detected), two privacy improvements activate:

### 1. Tor detection is skipped

`useTorDetection(skip)` accepts a `skip` parameter. `NetworkContext` passes `localApiStatus === "available"`, so on Umbrel no requests go to `tor-check.copexit.workers.dev` or the `.onion` probe. This eliminates IP leakage on every page load.

### 2. Chainalysis checks route through Tor

`CexRiskPanel` detects Umbrel mode via `useNetwork().localApiStatus`. When the user clicks "Run Chainalysis Check":

1. First tries `/tor-proxy/chainalysis/address/{addr}` (goes through sidecar -> Tor -> Cloudflare Worker -> Chainalysis API)
2. If Tor fails (502, timeout, blocked): shows amber warning dialog "Tor proxy is unavailable. Proceeding will expose your IP."
3. User can click "Proceed without Tor" (direct clearnet call) or "Cancel"
4. A route badge ("via Tor" green / "direct" amber) shows next to the result

On non-Umbrel (GitHub Pages), behavior is unchanged - direct call to the Cloudflare Worker.

## How Local API Detection Works

`src/hooks/useLocalApi.ts` probes `/api/blocks/tip/height` on the same origin at page load:
- On Umbrel: nginx proxies this to the local mempool, returns a block height integer -> "available"
- On GitHub Pages: no `/api/` route, returns 404 -> "unavailable"
- Result is cached per page load (module-level singleton)

When "available", the app's `NetworkContext` sets `mempoolBaseUrl` to `/api` (relative) instead of `https://mempool.space/api`. The `ConnectionBadge` component shows a green shield with "Local".

### ResultsPanel relative URL fix

`ResultsPanel.tsx` constructs a "View on mempool.space" link. When `mempoolBaseUrl` is `/api` (relative), `new URL("/api")` throws. The fix checks `startsWith("/")` first and displays "local API" as hostname.

## Local Testing

### Tier 1: Docker Compose mock (quick, no Umbrel needed)

```bash
pnpm build   # Must build first - test stack mounts out/ directory
docker compose -f docker-compose.test.yml up --build
# App at http://localhost:3080
# ConnectionBadge shows "Local"
# curl http://localhost:3080/api/blocks/tip/height -> mainnet height
# Chainalysis check: Tor will 502 (no real Tor) -> fallback dialog appears
```

The test stack includes the tor-proxy sidecar, but without a real Tor daemon it returns 502 on Chainalysis requests. This validates the fallback dialog flow.

### Tier 2: Full Umbrel dev environment

#### Prerequisites
- Linux with Docker (native, container IPs exposed)
- macOS: OrbStack required (Docker Desktop won't work - container IPs not exposed)
- ~15 GB disk

#### Setup

```bash
# Clone Umbrel monorepo
git clone https://github.com/getumbrel/umbrel.git
cd umbrel
npm run dev start
# First run builds the OS image (~10 min)
# Access at http://umbrel-dev.local or container IP (docker inspect umbrel-dev)
```

#### DNS issues in sandboxed environments

The Umbrel dev environment builds a Debian image that needs DNS. If Docker DNS is broken:

1. Find a working DNS: `resolvectl status` -> look for "DNS Servers" on a working interface
2. For build phase: create a buildx builder with `--driver-opt network=host`
3. For runtime: add `--dns <IP>` to the docker run command in `scripts/umbrel-dev`
4. The overlay mount may fail in Docker-in-Docker - the dev script handles this gracefully with a fallback

#### Install stack

```bash
# Register user (via tRPC API - raw JSON, no {"json":...} wrapper)
curl http://<IP>/trpc/user.register -X POST -H 'Content-Type: application/json' \
  -d '{"name":"dev","password":"devdevdev"}'

# Login
curl http://<IP>/trpc/user.login -X POST -H 'Content-Type: application/json' \
  -d '{"password":"devdevdev"}'
# -> returns {"result":{"data":"<JWT>"}}

# Install Bitcoin Core
curl http://<IP>/trpc/apps.install -X POST \
  -H 'Authorization: Bearer <JWT>' -H 'Content-Type: application/json' \
  -d '{"appId":"bitcoin"}'

# Switch to signet (edit settings, restart app)
# File: /home/umbrel/umbrel/app-data/bitcoin/data/app/settings.json
# Change "chain": "main" to "chain": "signet"
# Signet syncs in ~30 min vs days for mainnet

# Install Electrs + Mempool
curl ... -d '{"appId":"electrs"}'
curl ... -d '{"appId":"mempool"}'

# Add community app store
curl http://<IP>/trpc/appStore.addRepository -X POST \
  -H 'Authorization: Bearer <JWT>' -H 'Content-Type: application/json' \
  -d '{"url":"https://github.com/Copexit/copexit-umbrel-app-store.git"}'

# Install our app
curl ... -d '{"appId":"copexit-am-i-exposed"}'
```

#### tRPC API notes

- Mutations use **POST** with raw JSON body (NOT `{"json": {...}}` - that's the superjson format which Umbrel doesn't use)
- Queries use **GET**
- Auth header: `Authorization: Bearer <JWT>`
- The CLI client (`npm run client`) uses WebSocket for most calls and may hang - prefer curl for automation

#### Loading private Docker images

If the GHCR packages aren't public yet, load images manually:

```bash
# Save from host Docker, pipe into container Docker
docker save ghcr.io/copexit/am-i-exposed-umbrel:vX.Y.Z | \
  docker exec -i umbrel-dev docker load
docker save ghcr.io/copexit/am-i-exposed-tor-proxy:vX.Y.Z | \
  docker exec -i umbrel-dev docker load

# WARNING: Umbrel's uninstall nukes app images. Reload after each uninstall.
```

Umbrel's install process calls `docker.pull()` via Dockerode before running `docker compose up`. If the image exists locally but the registry returns 401/404, the install fails. To work around this during development, patch `/opt/umbreld/source/modules/utilities/docker-pull.ts` (inside the container) to check local images first:

```typescript
// At the top of the pull() function, add:
try {
  await docker.getImage(image).inspect()
  handleAlreadyDownloaded()
  updateProgress(1)
  return true
} catch {}
// Then proceed with normal pull
```

Also patch `/opt/umbreld/source/modules/apps/legacy-compat/app-script` to make pulls non-fatal:
```bash
# Change:  compose "${app}" pull
# To:      compose "${app}" pull --ignore-pull-failures || true

# One-liner:
docker exec umbrel-dev sed -i 's@compose "${app}" pull@compose "${app}" pull --ignore-pull-failures || true@g' \
  /opt/umbreld/source/modules/apps/legacy-compat/app-script
```

After patching, restart the service: `docker exec umbrel-dev systemctl restart umbrel`

These patches survive container restarts but are lost if the container is recreated (`npm run dev destroy`). They are NOT needed once both GHCR packages are public.

## Releasing a New Version

### Overview: two-repo, two-image workflow

A release touches **two repositories** and builds **two Docker images**:

| Step | Repo | What changes |
|------|------|-------------|
| 1. Code changes | `am-i-exposed` | App source, nginx config, Dockerfile, tor-proxy sidecar |
| 2. Docker images | `am-i-exposed` | Both images built by CI from git tag, pushed to GHCR |
| 3. App store update | `copexit-umbrel-app-store` | Image tags, version, release notes |

Users receive updates when they refresh the app store in the Umbrel UI.

### Step-by-step release checklist

#### 1. Prepare the code (am-i-exposed repo)

```bash
cd ~/am-i-exposed

# Ensure quality
pnpm lint          # Must be 0 errors
pnpm build         # Verify static export works

# Optional: test with Docker Compose mock
docker compose -f docker-compose.test.yml up --build
# Verify at http://localhost:3080, then Ctrl+C
```

#### 2. Tag and push (triggers CI)

```bash
# Tag format: vMAJOR.MINOR.PATCH (e.g. v0.3.0)
git tag v0.3.0
git push origin main --tags
```

This triggers **both** CI workflows:
- `docker-umbrel.yml` -> builds main app image (5-10 min for arm64)
- `docker-tor-proxy.yml` -> builds sidecar image (~1 min)

**Wait for both CI jobs to finish** before proceeding. Check at: `github.com/Copexit/am-i-exposed/actions`

#### 3. Ensure GHCR packages are public

**First release only** - new GHCR packages default to private. Both must be public:
- `ghcr.io/copexit/am-i-exposed-umbrel`
- `ghcr.io/copexit/am-i-exposed-tor-proxy`

Go to: GitHub > Packages > each package > Package Settings > Danger Zone > Change Visibility > Public

After the first time, subsequent pushes to the same packages remain public.

#### 4. Update the app store (copexit-umbrel-app-store repo)

```bash
cd ~/copexit-umbrel-app-store
```

Edit `copexit-am-i-exposed/docker-compose.yml` - bump image tags:
```yaml
web:
  image: ghcr.io/copexit/am-i-exposed-umbrel:v0.3.0       # <-- new tag
tor-proxy:
  image: ghcr.io/copexit/am-i-exposed-tor-proxy:v0.3.0    # <-- new tag (if sidecar changed)
```

Edit `copexit-am-i-exposed/umbrel-app.yml` - bump version and update release notes:
```yaml
version: "0.3.0"                    # <-- must match (without "v" prefix)
releaseNotes: >-
  Describe what changed in this release.
```

Push to the app store:
```bash
git add -A
git commit -m "release: am-i.exposed v0.3.0"
git push origin master
```

#### 5. Verify

- Users see the update in Umbrel UI when they refresh the app store
- On a dev instance: uninstall and reinstall, or wait for the update prompt

### Manual Docker build (no CI)

```bash
cd ~/am-i-exposed

# Main app - multi-platform
docker buildx build -f Dockerfile.umbrel \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/copexit/am-i-exposed-umbrel:v0.3.0 \
  -t ghcr.io/copexit/am-i-exposed-umbrel:latest \
  --push .

# Tor proxy sidecar - multi-platform
docker buildx build -f umbrel/tor-proxy/Dockerfile \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/copexit/am-i-exposed-tor-proxy:v0.3.0 \
  -t ghcr.io/copexit/am-i-exposed-tor-proxy:latest \
  --push ./umbrel/tor-proxy

# Or single-platform (faster, for testing)
docker build -f Dockerfile.umbrel -t ghcr.io/copexit/am-i-exposed-umbrel:v0.3.0 .
docker build -t ghcr.io/copexit/am-i-exposed-tor-proxy:v0.3.0 ./umbrel/tor-proxy
```

Requires prior auth: `echo "$GHCR_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin`

### Version numbering

- Docker image tags use `v` prefix: `v0.1.0`, `v0.2.0`
- `umbrel-app.yml` `version` field has no prefix: `0.1.0`, `0.2.0`
- Keep them in sync (e.g. tag `v0.2.0` -> docker-compose `v0.2.0` -> manifest `0.2.0`)
- The tor-proxy sidecar tag can stay at a lower version if it didn't change, but for simplicity you can bump both together

### What files typically change per release

| File | When to change |
|------|---------------|
| `umbrel/nginx.conf.template` | Proxy routing changes (new endpoints, headers) |
| `umbrel/tor-proxy/server.js` | Tor proxy logic changes (new routes, upstream URLs) |
| `umbrel/tor-proxy/Dockerfile` | Sidecar build changes (base image, deps) |
| `Dockerfile.umbrel` | Main build process changes (base image, build steps) |
| `.github/workflows/docker-umbrel.yml` | CI changes (platforms, caching) |
| `.github/workflows/docker-tor-proxy.yml` | Sidecar CI changes |
| `src/hooks/useLocalApi.ts` | Local API detection logic |
| `src/hooks/useTorDetection.ts` | Tor detection (skip logic on Umbrel) |
| `src/context/NetworkContext.tsx` | How mempoolBaseUrl is set in local mode |
| `src/lib/analysis/cex-risk/chainalysis-check.ts` | Chainalysis routing logic |
| `src/components/CexRiskPanel.tsx` | Chainalysis UI (fallback dialog, route badges) |
| App store `docker-compose.yml` | Every release (image tag bumps) |
| App store `umbrel-app.yml` | Every release (version + releaseNotes) |
| App store `exports.sh` | When adding/removing containers (static IPs) |

## Verified Test Results

| Test | Network | Result |
|------|---------|--------|
| Health check `/health` | - | `ok` |
| API proxy `/api/blocks/tip/height` | signet | Block height (e.g. 292382) |
| Network-prefix `/signet/api/tx/{txid}` | signet | JSON tx data |
| ConnectionBadge | - | Green "Local" shield |
| Whirlpool CoinJoin (Tier 1, mainnet) | mainnet | A+ 100/100 |
| Satoshi address (Tier 1, mainnet) | mainnet | F 0/100 |
| Signet tx analysis (Tier 2) | signet | C 53/100 |
| App install/uninstall | - | Clean both ways |
| Tor detection skipped on Umbrel | - | No requests to tor-check.copexit.workers.dev |
| Chainalysis via Tor (Tier 2) | - | Pending verification |
| Chainalysis fallback dialog | Tier 1 | Shows when Tor unavailable |
