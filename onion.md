# Deploying a .onion Mirror of am-i.exposed

## Why a .onion mirror is needed

When users run their own mempool.space instance (Umbrel, Start9, or a custom node),
the API is typically accessible via a `.onion` Tor hidden service address. However,
the main site at `https://am-i.exposed` is served over HTTPS, and browsers enforce
**mixed content blocking** - an HTTPS page cannot make `fetch()` requests to plain
HTTP URLs (except `localhost`).

This means a user on Tor Browser visiting `https://am-i.exposed` cannot connect to
their mempool at `http://xyz.onion/api` - the browser silently blocks the request.

A `.onion` mirror of our site solves this: the mirror is served over HTTP (Tor
provides encryption and authentication at the network layer), so requests from
`http://our-mirror.onion` to `http://user-mempool.onion/api` are HTTP-to-HTTP
with no mixed content barrier.

**Note:** CORS headers are still required on the user's mempool nginx config
regardless of the connection method. See the in-app help section for the nginx
snippet.

## Why Cloudflare Onion Routing doesn't solve this

Cloudflare offers an "Onion Routing" toggle (available on all plans) that gives
Tor Browser users a `.onion` route to your site via `alt-svc` headers. However:

- The visible URL stays `https://am-i.exposed` (not a `.onion` address)
- The page is still served over HTTPS
- Mixed content restrictions still apply to outgoing `fetch()` calls
- `window.location.hostname` remains `am-i.exposed`, not `.onion`

Cloudflare's feature is useful for avoiding exit-node exposure when Tor users
access our site, but it does **not** enable HTTP-to-HTTP API calls to self-hosted
`.onion` mempool instances. A true `.onion` hidden service is required for that.

## VPS setup instructions

### Prerequisites

- A VPS (any small instance - the site is fully static, minimal resources needed)
- Root/sudo access
- The static export files (`pnpm build` produces the `out/` directory)

### 1. Install Tor

```bash
# Debian/Ubuntu
sudo apt update
sudo apt install tor

# Verify it's running
sudo systemctl status tor
```

### 2. Configure the Tor hidden service

Edit `/etc/tor/torrc`:

```
HiddenServiceDir /var/lib/tor/am-i-exposed/
HiddenServicePort 80 127.0.0.1:8080
```

Restart Tor:

```bash
sudo systemctl restart tor
```

Get your `.onion` address:

```bash
sudo cat /var/lib/tor/am-i-exposed/hostname
```

This outputs something like `abc123xyz456.onion` - this is your mirror address.

### 3. Serve the static site

Install a lightweight web server (nginx, caddy, or even Python's http.server for
testing):

**Option A: nginx**

```bash
sudo apt install nginx
```

Create `/etc/nginx/sites-available/am-i-exposed`:

```nginx
server {
    listen 127.0.0.1:8080;
    server_name _;

    root /var/www/am-i-exposed;
    index index.html;

    # Next.js static export uses trailing slashes
    location / {
        try_files $uri $uri/ $uri/index.html =404;
    }

    # Security headers
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;

    # No need for HTTPS headers - Tor provides encryption
}
```

Enable and start:

```bash
sudo ln -s /etc/nginx/sites-available/am-i-exposed /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Option B: Caddy (simpler config)**

```bash
sudo apt install caddy
```

Create `/etc/caddy/Caddyfile`:

```
:8080 {
    root * /var/www/am-i-exposed
    file_server
    try_files {path} {path}/ {path}/index.html
}
```

### 4. Deploy the static files

From your development machine:

```bash
# Build the static export
pnpm build

# Copy to VPS
rsync -avz out/ user@your-vps:/var/www/am-i-exposed/
```

Or set up a simple CI/CD pipeline that builds and deploys on push to main.

### 5. Verify

Open Tor Browser and navigate to `http://your-onion-address.onion`. The site
should load identically to the HTTPS version.

Test the privacy-optimal flow:
1. Open Tor Browser
2. Visit `http://your-onion-address.onion`
3. Open API settings (gear icon)
4. Enter your mempool's `.onion` API address (e.g., `http://mempool-onion.onion/api`)
5. The health check should succeed (no mixed content barrier)

### 6. Keep it updated

Set up a cron job or deploy hook to sync the `out/` directory whenever the site
is updated:

```bash
# Example cron job (runs every 6 hours)
0 */6 * * * rsync -avz /path/to/out/ /var/www/am-i-exposed/ && sudo systemctl reload nginx
```

Or use a GitHub Actions workflow that SSHs into the VPS after a successful build.

## Architecture overview

```
Tor Browser user
    |
    | (Tor circuit - encrypted, authenticated)
    v
[.onion hidden service on VPS]
    |
    | (localhost:8080)
    v
[nginx serving static files]
    |
    | HTTP fetch() from the page
    | (no mixed content - both HTTP)
    v
[User's mempool .onion hidden service]
    |
    | (Tor circuit)
    v
[User's Bitcoin node + mempool backend]
```

## CORS reminder

Even with the `.onion` mirror eliminating mixed content, the user's mempool
instance still needs CORS headers because the browser origins differ
(`http://our-mirror.onion` vs `http://user-mempool.onion`).

Add to the mempool nginx config on the user's node:

```nginx
location /api/ {
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Content-Type' always;

    if ($request_method = 'OPTIONS') {
        return 204;
    }

    # ... existing proxy/upstream config ...
}
```
