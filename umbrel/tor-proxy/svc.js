/**
 * Registry-driven /svc/<id>/<path> route for the tor-proxy sidecar. Mirrors
 * workers/coinjoin-stats/svc.js validation (CommonJS, no cache: every response
 * is no-store). The upstream is service.onion ?? service.base.
 */
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_PARAMS_JSON = 2048;
const DEFAULT_TIMEOUT_MS = 30000;

function validateParam(kind, value) {
  if (kind === "txid") {
    if (typeof value !== "string") return null;
    const v = value.trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(v) ? v : null;
  }
  const n = parseInt(String(value ?? "1"), 10);
  return String(!Number.isFinite(n) || n < 1 ? 1 : Math.min(n, 10000));
}

/** Resolves with the raw body text; rejects with { tooLarge: true } past 64 KB. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { tooLarge: true }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function send(res, status, body, extra = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra });
  res.end(body);
}

const fail = (res, status, code, message, extra) =>
  send(res, status, JSON.stringify({ error: { code, message } }), extra);

function createSvcHandler({ fetchViaAgent, services, logger = console }) {
  const forward = async (res, service, route, path, init) => {
    try {
      const body = await fetchViaAgent((service.onion ?? service.base) + path, {
        ...init,
        timeoutMs: route.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      send(res, 200, body);
    } catch (err) {
      if (err.status === 429) return fail(res, 429, "RATE_LIMITED", "Upstream rate limit", { "Retry-After": "60" });
      // Never log err.message: it can carry upstream text (a txid).
      logger.error(`Svc ${service.id} ${route.path} error: ${err.status ?? err.code ?? "failed"}`);
      fail(res, 502, "UPSTREAM_DOWN", "Tor proxy upstream request failed");
    }
  };
  const misconfigured = (res) => fail(res, 500, "MISCONFIGURED", "Service registry misconfigured");

  return async function handleSvc(req, res) {
    const url = new URL(req.url, "http://localhost");
    const m = url.pathname.match(/^\/svc\/([^/]+)(\/.*)$/);
    const service = m && services.find((s) => s.id === m[1]);
    const routes = service ? service.routes.filter((r) => r.path === m[2]) : [];
    if (!routes.length) return fail(res, 404, "NOT_FOUND", "Unknown service route");
    const route = routes.find((r) => r.http === req.method);
    if (!route) return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
    const path = route.path;

    if (req.method === "GET") {
      // Fail closed: only "aggregate" and "lookup" are valid classes.
      if (route.class !== "aggregate" && route.class !== "lookup") return misconfigured(res);
      const qs = new URLSearchParams();
      for (const [name, kind] of Object.entries(route.query ?? {})) {
        if (!url.searchParams.has(name)) continue;
        const v = validateParam(kind, url.searchParams.get(name));
        if (v === null) return fail(res, 400, "BAD_PARAMS", "Invalid params");
        qs.set(name, v);
      }
      const query = qs.toString();
      return forward(res, service, route, path + (query ? "?" + query : ""), { method: "GET" });
    }

    let text;
    try {
      text = await readBody(req);
    } catch (err) {
      if (err.tooLarge) return fail(res, 413, "TOO_LARGE", "Request body too large");
      return fail(res, 400, "BAD_REQUEST", "Could not read request body");
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return fail(res, 400, "BAD_JSON", "Invalid JSON body");
    }
    const rpc = body && body.jsonrpc === "2.0" && typeof body.method === "string"
      && Object.hasOwn(route.rpc ?? {}, body.method) ? route.rpc[body.method] : null;
    if (!rpc) return fail(res, 400, "DISALLOWED", "Invalid or disallowed method");
    if (rpc.class !== "aggregate" && rpc.class !== "lookup") return misconfigured(res);

    let params;
    if (rpc.class === "lookup") {
      const declared = Object.entries(rpc.params ?? {});
      const p = body.params;
      if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).length !== declared.length) {
        return fail(res, 400, "BAD_PARAMS", "Invalid params");
      }
      params = {};
      for (const [name, kind] of declared) {
        const v = Object.hasOwn(p, name) ? validateParam(kind, p[name]) : null;
        if (v === null) return fail(res, 400, "BAD_PARAMS", "Invalid params");
        params[name] = v;
      }
    } else {
      params = body.params ?? {};
      if (JSON.stringify(params).length > MAX_PARAMS_JSON) return fail(res, 400, "BAD_PARAMS", "Params too large");
    }

    return forward(res, service, route, path, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: body.method, params }),
    });
  };
}

module.exports = { createSvcHandler, validateParam, readBody };
