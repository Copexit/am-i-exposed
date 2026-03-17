const APP_CACHE = "ami-exposed-v3";
const DATA_CACHE = "ami-exposed-data";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

// Purge old APP caches on version bump, but KEEP the data cache
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Skip cross-origin requests (API calls, custom endpoints, etc.)
  if (url.origin !== self.location.origin) return;

  // Never cache API or proxy responses - they contain blockchain data (privacy)
  // and caching stale probe responses causes false-positive local API detection
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/tor-proxy/")) return;

  // Core entity index: ETag-revalidation (small, ~5.7 MB, ok to check each visit)
  if (url.pathname === "/data/entity-index.bin") {
    event.respondWith(revalidateData(event.request));
    return;
  }

  // Full entity data: cache-forever (large, ~93 MB, only updated by explicit user action)
  if (url.pathname.startsWith("/data/entity-") && url.pathname.endsWith(".bin")) {
    event.respondWith(cacheForeverOrFetch(event.request));
    return;
  }

  // Content-hashed assets (_next/static/*) are immutable - cache-first is safe
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(APP_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  // HTML and everything else: network-first, fall back to cache.
  // cache: "no-cache" forces revalidation with the server (304 if unchanged),
  // ensuring users get fresh HTML after deployments instead of stale cached pages.
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === "navigate") {
            return caches.match(OFFLINE_URL);
          }
          return new Response("Offline", { status: 503 });
        });
      }),
  );
});

// ───────────────── Data cache strategies ─────────────────

// ETag-revalidation: conditional fetch, 304 = use cache (0 bytes transferred)
async function revalidateData(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);

  const headers = {};
  if (cached) {
    const etag = cached.headers.get("etag");
    const lastMod = cached.headers.get("last-modified");
    if (etag) headers["If-None-Match"] = etag;
    if (lastMod) headers["If-Modified-Since"] = lastMod;
  }

  try {
    const response = await fetch(request, { headers });
    if (response.status === 304 && cached) return cached;
    if (response.ok) {
      cache.put(request, response.clone());
      return response;
    }
    return cached || response;
  } catch {
    return cached || new Response("Offline", { status: 503 });
  }
}

// Cache-forever: serve from cache if available, only fetch on first miss
async function cacheForeverOrFetch(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

// ───────────────── Message handler: ETag check ─────────────────

// Allows the app to check if cached data is stale without downloading.
// Used by "Update available" UI in settings.
self.addEventListener("message", (event) => {
  if (event.data?.type === "CHECK_DATA_ETAGS") {
    checkDataEtags(event.data.paths).then((result) => {
      event.ports[0].postMessage(result);
    });
  }
});

async function checkDataEtags(paths) {
  const cache = await caches.open(DATA_CACHE);
  const results = {};

  for (const path of paths) {
    const cached = await cache.match(path);
    const cachedEtag = cached?.headers.get("etag") || null;

    let serverEtag = null;
    try {
      const head = await fetch(path, { method: "HEAD" });
      serverEtag = head.headers.get("etag") || null;
    } catch {
      // offline - no update info available
    }

    results[path] = {
      cached: !!cached,
      updateAvailable: !!(cachedEtag && serverEtag && cachedEtag !== serverEtag),
    };
  }

  return results;
}
