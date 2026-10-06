# Service Layer and CoinJoin Services Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a registry-driven service layer, proxied through the existing Cloudflare worker and the Umbrel tor-proxy sidecar, plus an opt-in "CoinJoin services" check on tx, address and wallet results, backed by Wabisator.

**Architecture:**
- **Registry:** one JSON registry (`src/lib/services/registry.json`, copied to `umbrel/tor-proxy/services.json`) lists each service, its routes, RPC methods, their class (`aggregate` / `lookup`), TTLs and param validators.
- **Proxy route:** the worker and the sidecar each gain one generic `/svc/<id><path>` route that enforces the registry.
- **App client:** `src/lib/services/client.ts` refuses lookup methods without a `LookupConsent`.
- **Attribution:** a pure attribution module maps Wabisator `search` / `coinjoin` responses into typed results.
- **UI:** a `ServiceCheck` card renders them, with the consent step first.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript strict, Tailwind 4, react-i18next (6 locales), motion/react, Vitest, Playwright, Cloudflare Worker (plain JS, wrangler), Node 22 sidecar (CommonJS).

**Spec:** `docs/spec-service-attribution.md` (read it first; it is the authority).

## Global Constraints

- **Package manager:** pnpm only.
- **Required gates before a task is done:**
  - `pnpm type-check`
  - `pnpm lint` (0 warnings)
  - the touched test files pass (`pnpm vitest run <files>`)
- **TypeScript:** strict, no `any`.
- **No em dashes** (U+2014, its \u escape, the HTML entity) anywhere: code, comments, copy, JSON, docs. Use ` - ` or a comma.
- **UI copy:**
  - Never "we", "us", "our". Use passive voice or the tool name ("am-i.exposed").
  - Spanish uses Castilian tuteo.
- **Locales:** every new t() key gets a `defaultValue` in code AND an entry in all 6 locales (`public/locales/{en,es,pt,de,pl,fr}/common.json`, flat keys). `src/lib/__tests__/locale-parity.test.ts` enforces this.
- **Commits:**
  - Conventional messages, NO `Co-Authored-By` or any AI attribution line.
  - Never pass `-c user.email` / `-c user.name`.
  - Never `git stash`.
  - Work only in `/home/user/aie-services`.
- **Lookups:**
  - Lookup requests (any request carrying a user txid) are never sent without a `LookupConsent`.
  - They are never cached (client IndexedDB, worker edge cache).
  - They are never retried automatically.
- **Results:** service results never change a score or grade, and are never written to the scan cache, history, URL hash, share card or exports.
- **Routing:** the browser never calls a third-party service directly. Public site: `https://coinjoin-stats.copexit.workers.dev/svc/...`. Self-hosted (`isUmbrel`): `/tor-proxy/svc/...`.
- **Caps:**
  - Wabisator `txid` params must match `^[0-9a-f]{64}$` after lowercasing.
  - 10 txids per address check, 50 per wallet check.
  - Concurrency 2 with a 250 ms gap.
- **Legacy routes:** the worker keeps its legacy routes (`/whirlpool/*`, `/liquisabi/api`). The sidecar drops its legacy `/observatory/*` routes. `/chainalysis/address/*` is untouched.

## Review Focus

1. **An unrecorded CoinJoin with many `OutOf` coins** (fixture `wabisator-search-feeder.json`: 205 OutOf, 130 Into, no Matches) must NOT be reported as a post-mix merge: `summarize` excludes txids our own `isCoinJoinTx` recognizes. Test in Task 5.
2. **A Wabisator JSON-RPC error envelope** (e.g. `{"error":{"code":-32602,...}}`) or an HTTP 502 from the proxy must become a per-txid `error` result, not a thrown crash, and the rest of the batch continues. Test in Task 5 (lookupTx) and Task 6 (hook).
3. **An uppercase or whitespace-padded txid** must be normalized before the consent check and the proxy validator, so it is neither rejected nor double-counted. Tests in Task 1 (validator) and Task 4 (consent).
4. **A new scan while a check is running** must abort in-flight lookups and discard their results, so the new result never shows stale cards. Test in Task 6.
5. **A wallet or address with 0 eligible txids** (fresh address, empty wallet) must not render the card at all. Test in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/services/registry.json` | Canonical service registry (data only) |
| `src/lib/services/registry.ts` | Types, `findRpc`, `findGetRoute`, `validateParam` |
| `umbrel/tor-proxy/services.json` | Committed copy of the registry for the sidecar image |
| `src/lib/services/__tests__/registry.test.ts` | Registry shape + parity with the sidecar copy |
| `workers/coinjoin-stats/svc.js` | Pure `/svc` request handling for the worker (imports registry) |
| `workers/coinjoin-stats/worker.js` | Routes `/svc/*` to `svc.js`, legacy routes unchanged |
| `umbrel/tor-proxy/svc.js` | Pure `/svc` handling for the sidecar (reads services.json) |
| `umbrel/tor-proxy/handler.js` | Routes `/svc/*`, drops `/observatory/*` |
| `src/lib/services/route.ts` | `serviceUrl()` |
| `src/lib/services/consent.ts` | `LookupConsent`, `grantLookupConsent`, `ConsentRequiredError` |
| `src/lib/services/client.ts` | `serviceGet`, `serviceRpc` |
| `src/lib/observatory/endpoints.ts` | Now built on `serviceUrl` |
| `src/lib/services/wabisabi-attribution.ts` | Wabisator response types, `lookupTx`, `summarize`, txid selection |
| `src/hooks/useServiceCheck.ts` | Consent, batching, pacing, abort, retry state machine |
| `src/components/services/ServiceCheck.tsx` | The card (consent, progress, tx view, summary view) |
| `src/components/results/Results.tsx` | Mounts ServiceCheck for tx/address |
| `src/components/flows/WalletResults.tsx` | Mounts ServiceCheck for wallets |

---

### Task 1: Service registry

**Files:**
- Create: `src/lib/services/registry.json`, `src/lib/services/registry.ts`, `umbrel/tor-proxy/services.json`
- Test: `src/lib/services/__tests__/registry.test.ts`

**Interfaces:**
- Produces:
  - `type ServiceClass = "aggregate" | "lookup"`
  - `interface RpcSpec { class: ServiceClass; ttl?: number; params?: Record<string, ParamValidator> }`
  - `type ParamValidator = "txid" | "page"`
  - `interface ServiceRoute { path: string; http: "GET" | "POST"; class?: ServiceClass; ttl?: number; timeoutMs?: number; query?: Record<string, ParamValidator>; rpc?: Record<string, RpcSpec> }`
  - `interface ServiceDef { id: string; name: string; kind: "data-provider" | "wabisabi-coordinator" | "p2p-exchange" | "nostr-relay"; homepage: string; base: string; onion?: string; routes: ServiceRoute[] }`
  - `const SERVICES: ServiceDef[]`
  - `function getService(id: string): ServiceDef | undefined`
  - `function findRpc(serviceId: string, path: string, method: string): RpcSpec | undefined`
  - `function findGetRoute(serviceId: string, path: string): ServiceRoute | undefined`
  - `function validateParam(kind: ParamValidator, value: unknown): string | null` (normalized string, or null when invalid)

- [ ] **Step 1: Write the registry JSON** exactly as in spec section 1. Path `src/lib/services/registry.json`:

```json
{
  "services": [
    {
      "id": "wabisator",
      "name": "Wabisator",
      "kind": "data-provider",
      "homepage": "https://wabisator.com",
      "base": "https://wabisator.com",
      "routes": [
        {
          "path": "/api.php",
          "http": "POST",
          "rpc": {
            "dashboard": { "class": "aggregate", "ttl": 60 },
            "coordinators-status": { "class": "aggregate", "ttl": 15 },
            "flow-map": { "class": "aggregate", "ttl": 60 },
            "volume-history": { "class": "aggregate", "ttl": 600 },
            "rounds-paginated": { "class": "aggregate", "ttl": 60 },
            "coinjoin": { "class": "lookup", "params": { "txId": "txid" } },
            "search": { "class": "lookup", "params": { "query": "txid" } }
          }
        }
      ]
    },
    {
      "id": "liquisabi",
      "name": "LiquiSabi",
      "kind": "data-provider",
      "homepage": "https://liquisabi.com",
      "base": "https://liquisabi.com",
      "routes": [
        { "path": "/api", "http": "POST", "rpc": { "dashboard": { "class": "aggregate", "ttl": 60 } } }
      ]
    },
    {
      "id": "whirlpoolstats",
      "name": "whirlpoolstats.xyz",
      "kind": "data-provider",
      "homepage": "https://whirlpoolstats.xyz",
      "base": "https://whirlpoolstats.xyz/api",
      "routes": [
        { "path": "/summary", "http": "GET", "class": "aggregate", "ttl": 60, "timeoutMs": 20000 },
        { "path": "/charts", "http": "GET", "class": "aggregate", "ttl": 120, "timeoutMs": 60000 },
        { "path": "/txs", "http": "GET", "class": "aggregate", "ttl": 60, "timeoutMs": 30000, "query": { "page": "page" } }
      ]
    }
  ]
}
```

Then copy it byte for byte: `cp src/lib/services/registry.json umbrel/tor-proxy/services.json`.

- [ ] **Step 2: Write the failing test** `src/lib/services/__tests__/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVICES, getService, findRpc, findGetRoute, validateParam } from "../registry";

describe("service registry", () => {
  it("sidecar copy is identical to the canonical registry", () => {
    const root = join(__dirname, "../../../..");
    expect(readFileSync(join(root, "umbrel/tor-proxy/services.json"), "utf8"))
      .toBe(readFileSync(join(root, "src/lib/services/registry.json"), "utf8"));
  });

  it("every service is well formed and every lookup declares param validators", () => {
    const ids = new Set<string>();
    for (const s of SERVICES) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.base).toMatch(/^https:\/\//);
      for (const r of s.routes) {
        expect(r.path.startsWith("/")).toBe(true);
        if (r.http === "POST") expect(r.rpc).toBeDefined();
        for (const spec of Object.values(r.rpc ?? {})) {
          if (spec.class === "lookup") {
            expect(spec.params && Object.keys(spec.params).length).toBeGreaterThan(0);
            expect(spec.ttl).toBeUndefined();
          }
        }
      }
    }
  });

  it("finds RPC methods and GET routes", () => {
    expect(getService("wabisator")?.name).toBe("Wabisator");
    expect(findRpc("wabisator", "/api.php", "search")?.class).toBe("lookup");
    expect(findRpc("wabisator", "/api.php", "dashboard")?.class).toBe("aggregate");
    expect(findRpc("wabisator", "/api.php", "graph")).toBeUndefined();
    expect(findRpc("nope", "/api.php", "search")).toBeUndefined();
    expect(findGetRoute("whirlpoolstats", "/txs")?.query).toEqual({ page: "page" });
    expect(findGetRoute("whirlpoolstats", "/admin")).toBeUndefined();
  });

  it("validates and normalizes params", () => {
    const tx = "AB".repeat(32);
    expect(validateParam("txid", ` ${tx} `)).toBe("ab".repeat(32));
    expect(validateParam("txid", "ab".repeat(31))).toBeNull();
    expect(validateParam("txid", 42)).toBeNull();
    expect(validateParam("page", "3")).toBe("3");
    expect(validateParam("page", "0")).toBe("1");
    expect(validateParam("page", "99999")).toBe("10000");
    expect(validateParam("page", "x")).toBe("1");
  });
});
```

- [ ] **Step 3: Run it, expect FAIL** (module not found): `pnpm vitest run src/lib/services/__tests__/registry.test.ts`

- [ ] **Step 4: Implement** `src/lib/services/registry.ts`:

```ts
/**
 * External services reachable through am-i.exposed's own hops (the
 * coinjoin-stats worker on the public site, the tor-proxy sidecar when
 * self-hosted). registry.json is the single source of truth; the worker
 * bundles it and the sidecar ships a committed copy (services.json).
 */
import registry from "./registry.json";

export type ServiceClass = "aggregate" | "lookup";
export type ParamValidator = "txid" | "page";
export interface RpcSpec { class: ServiceClass; ttl?: number; params?: Record<string, ParamValidator> }
export interface ServiceRoute {
  path: string;
  http: "GET" | "POST";
  class?: ServiceClass;
  ttl?: number;
  timeoutMs?: number;
  query?: Record<string, ParamValidator>;
  rpc?: Record<string, RpcSpec>;
}
export interface ServiceDef {
  id: string;
  name: string;
  kind: "data-provider" | "wabisabi-coordinator" | "p2p-exchange" | "nostr-relay";
  homepage: string;
  base: string;
  onion?: string;
  routes: ServiceRoute[];
}

export const SERVICES = (registry as { services: ServiceDef[] }).services;

export const getService = (id: string) => SERVICES.find((s) => s.id === id);

export function findRpc(serviceId: string, path: string, method: string): RpcSpec | undefined {
  const route = getService(serviceId)?.routes.find((r) => r.http === "POST" && r.path === path);
  return route?.rpc && Object.hasOwn(route.rpc, method) ? route.rpc[method] : undefined;
}

export function findGetRoute(serviceId: string, path: string): ServiceRoute | undefined {
  return getService(serviceId)?.routes.find((r) => r.http === "GET" && r.path === path);
}

/** Normalized value, or null when the value is not acceptable. */
export function validateParam(kind: ParamValidator, value: unknown): string | null {
  if (kind === "txid") {
    if (typeof value !== "string") return null;
    const v = value.trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(v) ? v : null;
  }
  const n = parseInt(String(value ?? "1"), 10);
  return String(!Number.isFinite(n) || n < 1 ? 1 : Math.min(n, 10_000));
}
```

If `resolveJsonModule` is off, check `tsconfig.json`; it is on in this repo (other modules import JSON). If the JSON import types as a wide literal type, the `as` cast above is the only cast allowed.

- [ ] **Step 5: Run the test, expect PASS.** Then `pnpm type-check && pnpm lint`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/registry.json src/lib/services/registry.ts umbrel/tor-proxy/services.json src/lib/services/__tests__/registry.test.ts
git commit -m "feat(services): registry of external services shared by app, worker and sidecar"
```

---

### Task 2: Worker `/svc` route

**Files:**
- Create: `workers/coinjoin-stats/svc.js`
- Modify: `workers/coinjoin-stats/worker.js` (route `/svc/` before the legacy routes), `workers/coinjoin-stats/README.md` (document `/svc`)
- Test: `workers/coinjoin-stats/__tests__/svc.test.js`

**Interfaces:**
- Consumes: `src/lib/services/registry.json` (Task 1), imported as `import registry from "../../src/lib/services/registry.json";`. wrangler/esbuild bundles JSON imports. Vitest resolves the same.
- Produces: `export async function handleSvc(request, url, ctx, cors)` returning a `Response`.

Behaviour, all in `svc.js` (plain JS, ES module):
- **Routing:** parse `url.pathname` as `/svc/<id><rest>`. An unknown id, or a path not in the service's routes, gives 404 `{"error":{"code":"NOT_FOUND",...}}`.
- **GET:**
  - The route must be `http: "GET"`.
  - Only query params listed in `route.query` are forwarded, each through the validator (page clamp). Other params are dropped.
  - Upstream URL: `service.base + route.path + (query ? "?" + query : "")`.
  - Edge cache: key `https://cache.local/svc/<id><path>?<query>`, `Cache-Control: public, max-age=<ttl>`.
- **POST:**
  - The route must be `http: "POST"`.
  - Body JSON, at most 64 KB (`request.text()` length check, otherwise 413 `TOO_LARGE`).
  - It must have `jsonrpc === "2.0"` and a string `method` present in `route.rpc`, otherwise 400 `DISALLOWED`.
- **Lookup class:**
  - `params` must be an object whose keys are exactly the declared params, each passing its validator; otherwise 400 `BAD_PARAMS`.
  - The forwarded params are the normalized values.
  - Response headers: `Cache-Control: no-store`. NEVER touch `caches.default`.
- **Aggregate class:**
  - `params` defaults to `{}`, and `JSON.stringify(params).length <= 2048`, otherwise 400 `BAD_PARAMS`.
  - Edge cache key: `https://cache.local/svc/<id><path>#<method>:<JSON.stringify(params)>`, max-age `ttl`.
- **Forwarded body:** always rebuilt as `JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })`.
- **Upstream failures:**
  - A fetch error gives 502 `UPSTREAM_DOWN`.
  - A non-2xx gives 502 `UPSTREAM_HTTP`.
  - A response over 4 MiB gives 502 `UPSTREAM_HTTP` "Response payload too large". Reuse `readLimited` by moving it from worker.js into svc.js and importing it back into worker.js.
- **CORS:** every response carries `cors` (passed in from worker.js).

- [ ] **Step 1: Write failing tests** `workers/coinjoin-stats/__tests__/svc.test.js`. Reuse the cache stub and helpers pattern from `worker.test.js`, calling through the default export of `worker.js` so routing is tested end to end:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../worker.js";

const env = { ALLOWED_ORIGIN: "https://am-i.exposed" };
const cacheStore = new Map();
globalThis.caches = { default: {
  async match(req) { return cacheStore.get(req.url) ?? null; },
  async put(req, res) { cacheStore.set(req.url, res); },
} };
const ctx = { waitUntil: (p) => p };
const TX = "c575fb58fc4221882a281ceebe051131b2cc397f738156a93877c93639909cea";
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const post = (path, body) => handler.fetch(new Request(`https://w.dev${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://am-i.exposed" }, body: JSON.stringify(body),
}), env, ctx);

beforeEach(() => { cacheStore.clear(); vi.restoreAllMocks(); });

describe("/svc route", () => {
  it("forwards a lookup with normalized params, rebuilt body, no-store, no cache", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ jsonrpc: "2.0", id: 1, result: { Matches: [] } }));
    const res = await post("/svc/wabisator/api.php", { jsonrpc: "2.0", id: 7, method: "search", params: { query: TX.toUpperCase() }, extra: "x" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://am-i.exposed");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://wabisator.com/api.php");
    expect(JSON.parse(init.body)).toEqual({ jsonrpc: "2.0", id: 1, method: "search", params: { query: TX } });
    expect(cacheStore.size).toBe(0);
  });

  it("rejects lookups with bad or extra params", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    for (const params of [{ query: "nope" }, { query: TX, more: 1 }, {}, null]) {
      const res = await post("/svc/wabisator/api.php", { jsonrpc: "2.0", method: "search", params });
      expect(res.status).toBe(400);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects methods not in the registry", async () => {
    const res = await post("/svc/wabisator/api.php", { jsonrpc: "2.0", method: "graph", params: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("DISALLOWED");
  });

  it("caches aggregate RPC per method and params", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ jsonrpc: "2.0", id: 1, result: { a: 1 } }));
    await post("/svc/wabisator/api.php", { jsonrpc: "2.0", method: "dashboard", params: {} });
    const res = await post("/svc/wabisator/api.php", { jsonrpc: "2.0", method: "dashboard", params: {} });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("GET forwards only declared, validated query params", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ items: [] }));
    const res = await handler.fetch(new Request("https://w.dev/svc/whirlpoolstats/txs?page=0&evil=1"), env, ctx);
    expect(res.status).toBe(200);
    expect(f.mock.calls[0][0]).toBe("https://whirlpoolstats.xyz/api/txs?page=1");
  });

  it("404s unknown services and routes; 413 on huge bodies; 502 on upstream errors", async () => {
    expect((await handler.fetch(new Request("https://w.dev/svc/nope/x"), env, ctx)).status).toBe(404);
    expect((await handler.fetch(new Request("https://w.dev/svc/whirlpoolstats/admin"), env, ctx)).status).toBe(404);
    const big = await post("/svc/wabisator/api.php", { jsonrpc: "2.0", method: "dashboard", params: { pad: "x".repeat(70_000) } });
    expect(big.status).toBe(413);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));
    const bad = await post("/svc/wabisator/api.php", { jsonrpc: "2.0", method: "search", params: { query: TX } });
    expect(bad.status).toBe(502);
  });

  it("legacy routes still answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ pools: [] }));
    expect((await handler.fetch(new Request("https://w.dev/whirlpool/summary"), env, ctx)).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run, expect FAIL:** `pnpm vitest run workers/coinjoin-stats/__tests__/svc.test.js`

- [ ] **Step 3: Implement `svc.js`** following the behaviour list above. Validators are mirrored in plain JS:

```js
export function validateParam(kind, value) {
  if (kind === "txid") {
    if (typeof value !== "string") return null;
    const v = value.trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(v) ? v : null;
  }
  const n = parseInt(String(value ?? "1"), 10);
  return String(!Number.isFinite(n) || n < 1 ? 1 : Math.min(n, 10000));
}
```

In `worker.js`, at the top of `fetch` after OPTIONS: `if (url.pathname.startsWith("/svc/")) return handleSvc(request, url, ctx, cors);`. Update `Access-Control-Allow-Methods` if needed (GET, POST, OPTIONS already).

- [ ] **Step 4: Run the new tests and `worker.test.js`, expect PASS.** Also `pnpm exec wrangler deploy --config workers/coinjoin-stats/wrangler.toml --dry-run --outdir /tmp/claude-1000/wrangler-dry` must bundle successfully (JSON import resolved).

- [ ] **Step 5: README** `workers/coinjoin-stats/README.md`: add a "/svc route" section (registry-driven, aggregate cached, lookup no-store, legacy routes kept for one release).

- [ ] **Step 6: Commit**

```bash
git add workers/coinjoin-stats/svc.js workers/coinjoin-stats/worker.js workers/coinjoin-stats/README.md workers/coinjoin-stats/__tests__/svc.test.js
git commit -m "feat(worker): registry-driven /svc route with lookup no-store and aggregate edge cache"
```

---

### Task 3: Sidecar `/svc` route

**Files:**
- Create: `umbrel/tor-proxy/svc.js` (CommonJS)
- Modify:
  - `umbrel/tor-proxy/handler.js`: add the `/svc/` route; delete the `/observatory/*` routes and their constants, the LiquiSabi/whirlpool handlers and their exports.
  - `umbrel/tor-proxy/server.js`: pass the `method`, `body`, `contentType` and `timeoutMs` options through.
  - `umbrel/tor-proxy/Dockerfile`: `COPY server.js handler.js svc.js services.json ./`.
- Test: `umbrel/tor-proxy/__tests__/handler.test.js` (replace the observatory cases with `/svc` cases)

**Interfaces:**
- Consumes: `umbrel/tor-proxy/services.json` (Task 1), loaded with `require("./services.json")`.
- Produces:
  - `createSvcHandler({ fetchViaAgent, services, logger })`, returning `async (req, res) => void` for URLs starting with `/svc/`;
  - `createHandler({ fetchViaAgent, upstreamBase, logger, services })` (services defaults to `require("./services.json").services`).

Behaviour:
- Same validation rules as Task 2, except:
  - every response is `Cache-Control: no-store` (no cache in the sidecar);
  - the upstream base is `service.onion ?? service.base`, fetched through `fetchViaAgent(url, { method, body, timeoutMs })` with `route.timeoutMs ?? 30000`;
  - request body cap 64 KB via the existing `readJsonBody` (move it into svc.js and import it in handler.js if still needed there).
- Errors:
  - 400 `{"error":{"code":"DISALLOWED"|"BAD_PARAMS",...}}`
  - 404 `NOT_FOUND`
  - 405 for the wrong HTTP method
  - 502 `UPSTREAM_DOWN`
  - If `err.status === 429`, pass through 429 with `Retry-After: 60`.
- `server.js` `fetchViaAgent` already supports `method`/`body`. Add `timeoutMs` (default `REQUEST_TIMEOUT_MS`) and keep the 1 MB response cap.

- [ ] **Step 1: Write failing tests** in `handler.test.js`, replacing the existing `/observatory/*` tests and keeping the chainalysis and health tests. Use the existing `makeReq` / `makeRes` helpers:

```js
const TX = "c575fb58fc4221882a281ceebe051131b2cc397f738156a93877c93639909cea";

describe("/svc route", () => {
  it("forwards a Wabisator lookup through Tor with a rebuilt body, no-store", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{}}');
    const handler = createHandler({ fetchViaAgent, logger: { error() {} } });
    const res = makeRes();
    await handler(makeReq({ url: "/svc/wabisator/api.php", method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "coinjoin", params: { txId: TX.toUpperCase() } }) }), res);
    expect(res.statusCode()).toBe(200);
    expect(res.headers()["Cache-Control"]).toBe("no-store");
    const [url, opts] = fetchViaAgent.mock.calls[0];
    expect(url).toBe("https://wabisator.com/api.php");
    expect(JSON.parse(opts.body)).toEqual({ jsonrpc: "2.0", id: 1, method: "coinjoin", params: { txId: TX } });
  });

  it("rejects disallowed methods and bad params without calling upstream", async () => {
    const fetchViaAgent = vi.fn();
    const handler = createHandler({ fetchViaAgent, logger: { error() {} } });
    for (const body of [
      { jsonrpc: "2.0", method: "graph", params: {} },
      { jsonrpc: "2.0", method: "search", params: { query: "x" } },
    ]) {
      const res = makeRes();
      await handler(makeReq({ url: "/svc/wabisator/api.php", method: "POST", body: JSON.stringify(body) }), res);
      expect(res.statusCode()).toBe(400);
    }
    expect(fetchViaAgent).not.toHaveBeenCalled();
  });

  it("GET whirlpoolstats txs clamps page and drops unknown params", async () => {
    const fetchViaAgent = vi.fn().mockResolvedValue("{}");
    const handler = createHandler({ fetchViaAgent, logger: { error() {} } });
    const res = makeRes();
    await handler(makeReq({ url: "/svc/whirlpoolstats/txs?page=-4&x=1" }), res);
    expect(fetchViaAgent.mock.calls[0][0]).toBe("https://whirlpoolstats.xyz/api/txs?page=1");
    expect(fetchViaAgent.mock.calls[0][1].timeoutMs).toBe(30000);
  });

  it("404s unknown services and the removed /observatory routes", async () => {
    const handler = createHandler({ fetchViaAgent: vi.fn(), logger: { error() {} } });
    for (const url of ["/svc/nope/api", "/observatory/whirlpool/summary"]) {
      const res = makeRes();
      await handler(makeReq({ url }), res);
      expect([400, 404]).toContain(res.statusCode());
    }
  });

  it("maps upstream failure to 502 and 429 to 429", async () => {
    const down = createHandler({ fetchViaAgent: vi.fn().mockRejectedValue(new Error("x")), logger: { error() {} } });
    const r1 = makeRes();
    await down(makeReq({ url: "/svc/whirlpoolstats/summary" }), r1);
    expect(r1.statusCode()).toBe(502);
    const limited = createHandler({ fetchViaAgent: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { status: 429 })), logger: { error() {} } });
    const r2 = makeRes();
    await limited(makeReq({ url: "/svc/whirlpoolstats/summary" }), r2);
    expect(r2.statusCode()).toBe(429);
  });
});
```

(If the existing `makeRes` exposes `statusCode`/`headers` differently, adapt the accessors to it. Do not change the helper's semantics.)

- [ ] **Step 2: Run, expect FAIL:** `pnpm vitest run umbrel/tor-proxy/__tests__/handler.test.js`
- [ ] **Step 3: Implement** `svc.js`, the handler.js routing and removals, the server.js `timeoutMs` and the Dockerfile COPY.
- [ ] **Step 4: Run the tests, expect PASS.** Build the image locally to prove the COPY works: `docker build -q -t aie-torproxy-test umbrel/tor-proxy && docker run --rm --entrypoint node aie-torproxy-test -e "require('./svc.js'); console.log(require('./services.json').services.length)"`, expecting `3`.
- [ ] **Step 5: Commit**

```bash
git add umbrel/tor-proxy/svc.js umbrel/tor-proxy/handler.js umbrel/tor-proxy/server.js umbrel/tor-proxy/Dockerfile umbrel/tor-proxy/__tests__/handler.test.js
git commit -m "feat(tor-proxy): registry-driven /svc route replaces the observatory routes"
```

---

### Task 4: App client, consent, Observatory migration

**Files:**
- Create:
  - `src/lib/services/route.ts`
  - `src/lib/services/consent.ts`
  - `src/lib/services/client.ts`
  - `src/lib/services/__tests__/client.test.ts`
- Modify:
  - `src/lib/observatory/endpoints.ts`
  - `src/lib/observatory/__tests__/endpoints.test.ts`
  - `e2e/helpers/mock-api.ts` (`mockObservatoryApi` serves the new `/svc/...` paths)

**Interfaces:**
- Consumes: `findRpc`, `getService` (Task 1); `getJson`, `postJsonRpc` from `@/lib/observatory/transport`.
- Produces:
  - `serviceUrl(serviceId: string, path: string, opts: { isUmbrel: boolean }): string`. Returns `https://coinjoin-stats.copexit.workers.dev/svc/<id><path>`, or `/tor-proxy/svc/<id><path>`.
  - `class ConsentRequiredError extends Error`
  - `interface LookupConsent { readonly serviceId: string; readonly txids: ReadonlySet<string> }`, created only by `grantLookupConsent(serviceId: string, txids: string[]): LookupConsent`. It normalizes txids with `validateParam("txid", …)`, drops invalid ones, freezes the object, and stores it in a module-level `WeakSet` of granted consents.
  - `serviceRpc<T>(serviceId: string, path: string, method: string, params: Record<string, unknown>, opts: { isUmbrel: boolean; signal?: AbortSignal; consent?: LookupConsent }): Promise<T>`. It throws `ConsentRequiredError` for a `lookup` method unless all of these hold:
    - `opts.consent` is in the WeakSet;
    - `consent.serviceId === serviceId`;
    - every `txid`-validated param, normalized, is in `consent.txids`.

    It throws `Error("Unknown service method")` when `findRpc` misses.
  - `serviceGet<T>(serviceId: string, path: string, opts: { isUmbrel: boolean; signal?: AbortSignal; query?: Record<string, string | number> }): Promise<T>`.
  - `getObservatoryEndpoints({ isUmbrel })` keeps its signature. It now returns `whirlpoolBase = serviceUrl("whirlpoolstats", "", …)` and `liquiSabiUrl = serviceUrl("liquisabi", "/api", …)`. The existing whirlpool/liquisabi clients stay unchanged; their URL shape `${base}/summary` still matches `/svc/whirlpoolstats/summary`.

- [ ] **Step 1: Write failing tests** `src/lib/services/__tests__/client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { serviceUrl } from "../route";
import { grantLookupConsent, ConsentRequiredError } from "../consent";
import { serviceRpc, serviceGet } from "../client";

const TX = "c575fb58fc4221882a281ceebe051131b2cc397f738156a93877c93639909cea";
const rpcOk = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
afterEach(() => vi.restoreAllMocks());

describe("serviceUrl", () => {
  it("worker on public, tor-proxy on Umbrel", () => {
    expect(serviceUrl("wabisator", "/api.php", { isUmbrel: false })).toBe("https://coinjoin-stats.copexit.workers.dev/svc/wabisator/api.php");
    expect(serviceUrl("wabisator", "/api.php", { isUmbrel: true })).toBe("/tor-proxy/svc/wabisator/api.php");
  });
});

describe("serviceRpc consent", () => {
  it("refuses a lookup without consent and sends nothing", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    await expect(serviceRpc("wabisator", "/api.php", "search", { query: TX }, { isUmbrel: false })).rejects.toBeInstanceOf(ConsentRequiredError);
    expect(f).not.toHaveBeenCalled();
  });
  it("refuses a forged consent object and a txid outside the consent", async () => {
    const forged = { serviceId: "wabisator", txids: new Set([TX]) };
    await expect(serviceRpc("wabisator", "/api.php", "search", { query: TX }, { isUmbrel: false, consent: forged })).rejects.toBeInstanceOf(ConsentRequiredError);
    const c = grantLookupConsent("wabisator", ["ab".repeat(32)]);
    await expect(serviceRpc("wabisator", "/api.php", "search", { query: TX }, { isUmbrel: false, consent: c })).rejects.toBeInstanceOf(ConsentRequiredError);
  });
  it("sends a consented lookup (normalizing case) to the proxied URL", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(rpcOk({ Matches: [] }));
    const c = grantLookupConsent("wabisator", [` ${TX.toUpperCase()} `]);
    await serviceRpc("wabisator", "/api.php", "search", { query: TX.toUpperCase() }, { isUmbrel: false, consent: c });
    expect(f.mock.calls[0]![0]).toBe("https://coinjoin-stats.copexit.workers.dev/svc/wabisator/api.php");
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body)).params).toEqual({ query: TX });
  });
  it("aggregate methods need no consent; unknown methods throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(rpcOk({ ok: 1 }));
    await expect(serviceRpc("wabisator", "/api.php", "dashboard", {}, { isUmbrel: true })).resolves.toEqual({ ok: 1 });
    await expect(serviceRpc("wabisator", "/api.php", "graph", {}, { isUmbrel: true })).rejects.toThrow("Unknown service method");
  });
  it("serviceGet builds the query", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await serviceGet("whirlpoolstats", "/txs", { isUmbrel: true, query: { page: 2 } });
    expect(f.mock.calls[0]![0]).toBe("/tor-proxy/svc/whirlpoolstats/txs?page=2");
  });
});
```

Update `endpoints.test.ts` expectations to `https://coinjoin-stats.copexit.workers.dev/svc/whirlpoolstats`, `.../svc/liquisabi/api`, `/tor-proxy/svc/whirlpoolstats` and `/tor-proxy/svc/liquisabi/api`.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the three modules and the endpoints change. `client.ts` normalizes txid params via `validateParam` before both the consent check and the send. `postJsonRpc` returns the unwrapped `result` and throws `ApiError` on an error envelope.
- [ ] **Step 4: Update `mockObservatoryApi`** in `e2e/helpers/mock-api.ts`: match `/svc/whirlpoolstats/(summary|charts|txs)` and `/svc/liquisabi/api` instead of the legacy paths.
- [ ] **Step 5: Run the unit tests plus** `src/lib/observatory/__tests__` **and the observatory component tests, expect PASS.** Then `pnpm build` and `CI=1 pnpm exec playwright test e2e/observatory* --workers=1` (if no file matches, `grep -l observatory e2e/*.ts` and run those). First make sure nothing stale listens on :3333 (`ss -ltnp | grep :3333`). After the build, `git checkout -- public/sitemap.xml` if it changed.
- [ ] **Step 6: Commit**

```bash
git add src/lib/services/route.ts src/lib/services/consent.ts src/lib/services/client.ts src/lib/services/__tests__/client.test.ts src/lib/observatory/endpoints.ts src/lib/observatory/__tests__/endpoints.test.ts e2e/helpers/mock-api.ts
git commit -m "feat(services): consent-gated service client; observatory uses the /svc route"
```

---

### Task 5: Wabisator attribution

**Files:**
- Create:
  - `src/lib/services/wabisabi-attribution.ts`
  - `src/lib/services/__tests__/wabisabi-attribution.test.ts`
- Fixtures (already recorded, real responses, full JSON-RPC envelopes) in `src/lib/services/__tests__/fixtures/`:
  - `wabisator-coinjoin.json`: `coinjoin` for Kruw round `c575fb58…9cea`, with 214 inputs (199 remix, 13 fresh, 2 other), 305 outputs (5 non-standard), RemixedFrom 80, RemixedInto 41.
  - `wabisator-search-coinjoin.json`: `search` for that txid, with one `Matches` entry, `Kind: "coinjoin"`.
  - `wabisator-search-postmix.json`: `search` for `36aa0434…3adf`, a 45-input, 1-output consolidation. `Transaction.OutOf` has 45 coins from 13 Kruw rounds and `Into` is empty.
  - `wabisator-search-feeder.json`: `search` for `49249142…59ac`, an unrecorded CoinJoin with 205 `OutOf`, 130 `Into` and no Matches.
  - `wabisator-search-unknown.json`: `search` for `abab…ab`, with `Transaction.Known: false`.

**Interfaces:**
- Consumes: `serviceRpc` and `LookupConsent` (Task 4).
- Produces (export all):

```ts
export interface RoundRef { txid: string; coordinator: string; name: string; time: number; btc: number }
export interface CoinRef { roundTxid: string; coordinator: string; name: string; time: number; index: number; sats: number }
export type TxAttribution =
  | { kind: "coinjoin"; txid: string; coordinator: { key: string; name: string }; roundId: string; time: number;
      isBlame: boolean; feeRate: number; inputs: number; outputs: number; anonsetIn: number; anonsetOut: number;
      freshBtc: number; inputOrigins: { fresh: number; remix: number; other: number };
      remixFrom: { coordinator: string; name: string; btc: number; coins: number }[];
      remixedFromRounds: RoundRef[]; remixedIntoRounds: RoundRef[]; nonStandardOutputs: number }
  | { kind: "linked"; txid: string; outOf: CoinRef[]; into: CoinRef[] }
  | { kind: "none"; txid: string }
  | { kind: "error"; txid: string; message: string };

export interface AttributionCtx { isUmbrel: boolean; signal?: AbortSignal; consent: LookupConsent }
export async function lookupTx(txid: string, ctx: AttributionCtx): Promise<TxAttribution>;

export interface AttributionSummary {
  checked: number; failed: number;
  rounds: Extract<TxAttribution, { kind: "coinjoin" }>[];
  outOf: { coordinator: string; name: string; sats: number; coins: number }[];   // sorted by sats desc
  into: { coordinator: string; name: string; sats: number; coins: number }[];
  postMixMerges: { txid: string; coins: number; rounds: number }[];
  linked: Extract<TxAttribution, { kind: "linked" }>[];
}
/** isLocalCoinJoin: txids our own engine classifies as CoinJoins (excluded from postMixMerges). */
export function summarize(results: TxAttribution[], isLocalCoinJoin: (txid: string) => boolean): AttributionSummary;

/** Newest first, deduplicated, capped. */
export function selectTxids(txs: { txid: string; status?: { block_time?: number } }[], cap: number): string[];
export const ADDRESS_CAP = 10;
export const WALLET_CAP = 50;
```

Mapping rules:
- **`lookupTx`:**
  - Call `serviceRpc("wabisator", "/api.php", "search", { query: txid }, …)`.
  - If `Matches` has an entry with `Kind === "coinjoin"` and `TxId === txid`, also call `coinjoin { txId: txid }` and map it to `kind: "coinjoin"`.
  - Otherwise, if `Transaction?.OutOf?.length || Transaction?.Into?.length`, return `kind: "linked"`.
  - Otherwise return `kind: "none"`.
  - Catch any thrown error (`ApiError`, network, abort) into `kind: "error"`, with the message `err.message`. An `AbortError` must be rethrown instead of being mapped, so callers can discard.
- **`coinjoin` mapping:**
  - `coordinator: { key: Coinjoin.Coordinator, name: Coinjoin.CoordinatorName }`
  - `roundId: Coinjoin.RoundId`
  - `time`: from `Coinjoin.RoundEndTime` (ISO string) as unix seconds; fall back to `Transaction.BlockTime`.
  - `isBlame: Coinjoin.IsBlame`, `feeRate: Coinjoin.FinalMiningFeeRate`
  - `inputs: Coinjoin.InputCount`, `outputs: Coinjoin.OutputCount`
  - `anonsetIn: Coinjoin.AverageStandardInputsAnonSet`, `anonsetOut: Coinjoin.AverageStandardOutputsAnonSet`
  - `freshBtc: Coinjoin.FreshInputsEstimateBtc`
  - `inputOrigins`: counts of `Transaction.Inputs[].Origin`. Anything other than `fresh` / `remix` counts as `other`.
  - `remixFrom`: `RemixedFrom` grouped by `Coordinator`, summing `Btc` and `Coins`, sorted by btc desc.
  - `remixedFromRounds` and `remixedIntoRounds`: `{ txid: TxId, coordinator: Coordinator, name: Name, time: Time, btc: Btc }`.
  - `nonStandardOutputs`: the count of `Transaction.Outputs` with `Standard === false`.
- **`linked` mapping:**
  - `OutOf` maps to `{ roundTxid: CoinjoinTxId, coordinator, name: Name, time: Time, index: Vin, sats: Value }`.
  - `Into` maps to the same shape with `index: Vout`.
- **`summarize`:**
  - `checked` = number of results not `error`; `failed` = number of `error` results.
  - `outOf` and `into`: grouped by coordinator over all `linked` results.
  - `postMixMerges`: `linked` results with `outOf.length >= 2` whose txid is not a local CoinJoin. Here `coins` = outOf.length and `rounds` = the number of distinct `roundTxid`.

- [ ] **Step 1: Write failing tests:**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { grantLookupConsent } from "../consent";
import { lookupTx, summarize, selectTxids, type TxAttribution } from "../wabisabi-attribution";

const fx = (n: string) => readFileSync(join(__dirname, "fixtures", `${n}.json`), "utf8");
const CJ = "c575fb58fc4221882a281ceebe051131b2cc397f738156a93877c93639909cea";
const POST = "36aa04341be28abc8f6dab05d16a1e26d37446d72af4a22f4e0a09babba03adf";
const FEED = "49249142e386ba3740e90a9b358251c6af7007395b5cfc6dd066cbaf965f59ac";
const UNK = "ab".repeat(32);

/** fetch mock answering search/coinjoin from fixtures by method + param. */
function mockWabisator(map: Record<string, string>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
    const { method, params } = JSON.parse(String(init?.body));
    const key = `${method}:${params.query ?? params.txId}`;
    const body = map[key];
    return body ? new Response(body, { status: 200 }) : new Response("{}", { status: 502 });
  });
}
const ctx = (txids: string[]) => ({ isUmbrel: false, consent: grantLookupConsent("wabisator", txids) });
afterEach(() => vi.restoreAllMocks());

describe("lookupTx", () => {
  it("maps a recorded Kruw round", async () => {
    mockWabisator({ [`search:${CJ}`]: fx("wabisator-search-coinjoin"), [`coinjoin:${CJ}`]: fx("wabisator-coinjoin") });
    const r = await lookupTx(CJ, ctx([CJ]));
    expect(r.kind).toBe("coinjoin");
    if (r.kind !== "coinjoin") return;
    expect(r.coordinator).toEqual({ key: "kruw", name: "Kruw" });
    expect(r.inputs).toBe(214);
    expect(r.outputs).toBe(305);
    expect(r.inputOrigins).toEqual({ fresh: 13, remix: 199, other: 2 });
    expect(r.nonStandardOutputs).toBe(5);
    expect(r.remixedFromRounds).toHaveLength(80);
    expect(r.remixedIntoRounds).toHaveLength(41);
    expect(r.anonsetOut).toBeCloseTo(11.54);
  });
  it("maps a post-mix consolidation as linked", async () => {
    mockWabisator({ [`search:${POST}`]: fx("wabisator-search-postmix") });
    const r = await lookupTx(POST, ctx([POST]));
    expect(r.kind).toBe("linked");
    if (r.kind === "linked") { expect(r.outOf).toHaveLength(45); expect(r.into).toHaveLength(0); }
  });
  it("maps unknown txids to none, and errors (HTTP or JSON-RPC) to error", async () => {
    mockWabisator({ [`search:${UNK}`]: fx("wabisator-search-unknown") });
    expect((await lookupTx(UNK, ctx([UNK]))).kind).toBe("none");
    expect((await lookupTx(CJ, ctx([CJ]))).kind).toBe("error");          // 502 from the mock
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"bad"}}', { status: 200 }));
    expect((await lookupTx(CJ, ctx([CJ]))).kind).toBe("error");
  });
  it("rethrows aborts", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("x", "AbortError"));
    await expect(lookupTx(CJ, ctx([CJ]))).rejects.toThrow();
  });
});

describe("summarize", () => {
  it("counts post-mix merges but not CoinJoins our engine recognizes", async () => {
    mockWabisator({ [`search:${POST}`]: fx("wabisator-search-postmix"), [`search:${FEED}`]: fx("wabisator-search-feeder") });
    const results: TxAttribution[] = [await lookupTx(POST, ctx([POST])), await lookupTx(FEED, ctx([FEED])), { kind: "error", txid: UNK, message: "x" }];
    const s = summarize(results, (t) => t === FEED);
    expect(s.checked).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.postMixMerges).toEqual([{ txid: POST, coins: 45, rounds: 13 }]);
    expect(s.outOf[0]!.coordinator).toBe("kruw");
    expect(s.into.length).toBeGreaterThan(0);
  });
});

describe("selectTxids", () => {
  it("newest first, deduplicated, unconfirmed first, capped", () => {
    const txs = [{ txid: "a", status: { block_time: 1 } }, { txid: "b", status: { block_time: 3 } }, { txid: "a", status: { block_time: 1 } }, { txid: "c", status: {} }];
    expect(selectTxids(txs, 2)).toEqual(["c", "b"]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Declare minimal response interfaces for the Wabisator shapes used (`WabiSearchResult`, `WabiCoinjoinResult`) inside the module, typing only the fields read. Unconfirmed txs (no `block_time`) sort first in `selectTxids`.
- [ ] **Step 4: Run, expect PASS.** Then `pnpm type-check && pnpm lint`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/services/wabisabi-attribution.ts src/lib/services/__tests__/wabisabi-attribution.test.ts src/lib/services/__tests__/fixtures
git commit -m "feat(services): Wabisator CoinJoin attribution (search, coinjoin, summary)"
```

---

### Task 6: `useServiceCheck` hook and the ServiceCheck card

**Files:**
- Create:
  - `src/hooks/useServiceCheck.ts`
  - `src/hooks/__tests__/useServiceCheck.test.ts`
  - `src/components/services/ServiceCheck.tsx`
  - `src/components/services/__tests__/ServiceCheck.test.tsx`
- Modify: `public/locales/{en,es,pt,de,pl,fr}/common.json` (new `services.*` keys)

**Interfaces:**
- Consumes: `grantLookupConsent` (Task 4); `lookupTx`, `summarize`, `TxAttribution`, `AttributionSummary` (Task 5); `useNetwork()` from `@/context/NetworkContext` (`isUmbrel`).
- Produces:
  - `useServiceCheck(txids: string[], isLocalCoinJoin: (txid: string) => boolean)`, returning
    `{ phase: "idle" | "running" | "done"; done: number; total: number; results: TxAttribution[]; summary: AttributionSummary | null; start(): void; retryFailed(): void }`.
  - `ServiceCheck` props:
    `{ txids: string[]; mode: "tx" | "wallet-like"; totalAvailable?: number; isLocalCoinJoin: (txid: string) => boolean; onScan: (txid: string) => void }`.

Hook behaviour:
- **`start()`:**
  - Grants one consent for all `txids` and runs `lookupTx` with concurrency 2 and a 250 ms gap between starts.
  - `done` increments per result. `phase` goes to `done` when all have settled.
  - `summary = summarize(results, isLocalCoinJoin)`.
- **`retryFailed()`:** grants a new consent for the error txids only, re-runs them, and replaces those entries.
- **Abort:** when `txids` changes (joined string key) or on unmount, it aborts with an `AbortController`, resets to `idle` and drops late results. `lookupTx` rethrows aborts; the hook swallows them silently.

Card (Tailwind, semantic tokens, matching the existing results sections):
- **Wrapper:** `<section id="services" className="rounded-xl border border-hairline p-5 sm:p-6 space-y-4">` with `<p className="eyebrow">` "CoinJoin services".
- **idle:**
  - Description (`services.desc`).
  - Privacy line: `services.privacyPublic` or `services.privacyTor`, with `{{count}}`.
  - Coverage line (`services.coverage`).
  - Button "Check CoinJoin services" (`services.check`).
  - `mode === "wallet-like"` with `totalAvailable > txids.length` adds `services.capped` ("Checks the {{count}} most recent of {{total}} transactions.").
- **running:** `services.progress` "Checked {{done}} of {{total}}", with a progress bar.
- **done, mode "tx":** render `results[0]` by kind.
  - **coinjoin:**
    - coordinator name badge, round time (`toLocaleString`), and a blame tag (`services.blame`) when isBlame;
    - stat row: fee rate (sat/vB), inputs, outputs, anonset in, anonset out;
    - an input-origins bar (fresh / remixed / other, with `services.fresh`, `services.remixed`, `services.other`);
    - "Remixed from" chips per coordinator (btc, coins);
    - `services.nonStandard` "{{count}} non-standard outputs: change outputs like these are the linkable ones";
    - two collapsible lists, `services.remixedFromRounds` / `services.remixedIntoRounds`. Each row has a short txid (first 8 + "…" + last 8), the coordinator, the time and the btc, plus a button calling `onScan(txid)`.
  - **linked:** `services.outOf` "{{count}} coins came out of recorded CoinJoins" and `services.into` "{{count}} coins went into recorded CoinJoins". Each lists its rows the same way, with sats via the existing `fmtN` from `@/lib/format`.
  - **none:** `services.none` plus the coverage line.
  - **error:** `services.error` "Wabisator could not be reached. Local results are unaffected." plus a Retry button (`services.retry`) calling `retryFailed`.
- **done, mode "wallet-like":** tiles for:
  - rounds (`services.tileRounds`);
  - sats out of CoinJoins (`services.tileOutOf`), split by coordinator;
  - sats into CoinJoins (`services.tileInto`);
  - post-mix merges (`services.tilePostMix`).

  Plus:
  - an amber call-out (`border-severity-medium/40 bg-severity-medium/10`) with `services.postMixWarning` "{{count}} transactions spent coins from different CoinJoin outputs together, which links them again.", when `postMixMerges.length > 0`, listing each txid with a scan button;
  - `services.failedCount` "{{count}} could not be checked." plus Retry, when `failed > 0`.

Locale keys and English text (translate into es, pt, de, pl and fr; Castilian tuteo; no em dashes; no "we"):

| key | en |
|---|---|
| services.eyebrow | CoinJoin services |
| services.desc | See whether this was part of a WabiSabi CoinJoin, which coordinator ran it, and where the coins came from or went. |
| services.privacyPublic | Sends {{count}} transaction ID(s) to Wabisator (wabisator.com) through the am-i.exposed relay. Your IP address is not shared with Wabisator. Nothing is stored. |
| services.privacyTor | Sends {{count}} transaction ID(s) to Wabisator (wabisator.com) through Tor from your node. Nothing is stored. |
| services.coverage | Covers the WabiSabi coordinators Wabisator monitors (Kruw, OpenCoordinator, GingerWallet and others). No record does not rule out Whirlpool, JoinMarket or unmonitored coordinators. |
| services.check | Check CoinJoin services |
| services.capped | Checks the {{count}} most recent of {{total}} transactions. |
| services.progress | Checked {{done}} of {{total}} |
| services.blame | Blame round |
| services.feeRate | Fee rate |
| services.inputs | Inputs |
| services.outputs | Outputs |
| services.anonsetIn | Avg. input anonset |
| services.anonsetOut | Avg. output anonset |
| services.fresh | Fresh |
| services.remixed | Remixed |
| services.other | Other |
| services.remixFrom | Remixed from |
| services.nonStandard | {{count}} non-standard outputs: change outputs like these are the linkable ones. |
| services.remixedFromRounds | Rounds its coins came from |
| services.remixedIntoRounds | Rounds its coins went into |
| services.outOf | {{count}} coins came out of recorded CoinJoins |
| services.into | {{count}} coins went into recorded CoinJoins |
| services.none | No recorded WabiSabi CoinJoin activity for this transaction. |
| services.error | Wabisator could not be reached. Local results are unaffected. |
| services.retry | Retry |
| services.tileRounds | CoinJoin rounds |
| services.tileOutOf | Out of CoinJoins |
| services.tileInto | Into CoinJoins |
| services.tilePostMix | Post-mix merges |
| services.postMixWarning | {{count}} transactions spent coins from different CoinJoin outputs together, which links them again. |
| services.failedCount | {{count}} could not be checked. |
| services.scan | Scan |

- [ ] **Step 1: Write failing hook tests** `src/hooks/__tests__/useServiceCheck.test.ts` (jsdom; mock `@/context/NetworkContext` to `{ isUmbrel: false }`; mock `@/lib/services/wabisabi-attribution`'s `lookupTx` with `vi.mock`, keeping the real `summarize`):

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ isUmbrel: false }) }));
const lookupTx = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/wabisabi-attribution", async (orig) => ({ ...(await orig<object>()), lookupTx }));
import { useServiceCheck } from "../useServiceCheck";

const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
afterEach(() => { cleanup(); lookupTx.mockReset(); });

describe("useServiceCheck", () => {
  it("does nothing until start, then checks all txids and summarizes", async () => {
    lookupTx.mockImplementation(async (txid: string) => ({ kind: "none", txid }));
    const { result } = renderHook(() => useServiceCheck([A, B, C], () => false));
    expect(lookupTx).not.toHaveBeenCalled();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.done).toBe(3);
    expect(result.current.summary?.checked).toBe(3);
  });
  it("one failure does not stop the batch; retryFailed re-runs only failures", async () => {
    lookupTx.mockImplementation(async (txid: string) => (txid === B ? { kind: "error", txid, message: "x" } : { kind: "none", txid }));
    const { result } = renderHook(() => useServiceCheck([A, B, C], () => false));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.summary?.failed).toBe(1);
    lookupTx.mockClear();
    lookupTx.mockImplementation(async (txid: string) => ({ kind: "none", txid }));
    act(() => result.current.retryFailed());
    await waitFor(() => expect(result.current.summary?.failed).toBe(0));
    expect(lookupTx).toHaveBeenCalledTimes(1);
    expect(lookupTx.mock.calls[0]![0]).toBe(B);
  });
  it("a new txid set aborts and resets, dropping late results", async () => {
    let resolveLate: (v: unknown) => void = () => {};
    lookupTx.mockImplementation((txid: string) => new Promise((r) => { if (txid === A) resolveLate = r; else r({ kind: "none", txid }); }));
    const { result, rerender } = renderHook(({ ids }) => useServiceCheck(ids, () => false), { initialProps: { ids: [A] } });
    act(() => result.current.start());
    rerender({ ids: [B] });
    expect(result.current.phase).toBe("idle");
    resolveLate({ kind: "none", txid: A });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the hook.**
- [ ] **Step 4: Write card tests** `src/components/services/__tests__/ServiceCheck.test.tsx`:
  - mock `useServiceCheck` to return fixed states;
  - mock react-i18next with `t: (k, o) => o?.defaultValue ?? k` so English defaults render (follow how other component tests in `src/components/**/__tests__` mock i18n; copy their pattern);
  - assert: idle shows the button and the privacy line with the count; tx coinjoin shows "Kruw" and "Blame round" only when isBlame; the linked view lists rows and clicking a row's scan button calls `onScan` with that txid; wallet-like done with postMixMerges shows the warning; error shows Retry.
- [ ] **Step 5: Implement the card** and add all locale keys in the 6 files (insert alphabetically near other `s*` keys or at the end; flat keys).
- [ ] **Step 6: Run** the hook and card tests, `src/lib/__tests__/locale-parity.test.ts`, `pnpm type-check` and `pnpm lint`. Expect PASS.
- [ ] **Step 7: Commit**

```bash
git add src/hooks/useServiceCheck.ts src/hooks/__tests__/useServiceCheck.test.ts src/components/services public/locales
git commit -m "feat(services): CoinJoin services card with consent, progress, round and summary views"
```

---

### Task 7: Wire into results, docs, e2e

**Files:**
- Modify:
  - `src/components/results/Results.tsx`
  - `src/components/flows/WalletResults.tsx`
  - `public/locales/*/common.json` (`faq.a_data`)
  - `src/components/pages/FaqPage.tsx` (its default for `faq.a_data`, if it holds a copy)
  - `docs/development-guide.md`
  - `e2e/helpers/mock-api.ts`
- Create: `e2e/services.spec.ts`

**Interfaces:**
- Consumes: `ServiceCheck` (Task 6), `selectTxids`, `ADDRESS_CAP`, `WALLET_CAP` (Task 5), and `isCoinJoinTx` from `@/lib/analysis/heuristics/coinjoin`.

Wiring:
- **`Results.tsx`:**
  - Before `<ContextSection …/>` add `{!local && serviceTxids.length > 0 && <ServiceCheck … />}`.
  - `serviceTxids` (useMemo):
    - for `inputType === "txid"`: `txData ? [txData.txid] : []`;
    - for an address: `selectTxids(addressTxs ?? [], ADDRESS_CAP)`.
  - `mode` is `"tx"` for txid and `"wallet-like"` for address.
  - `totalAvailable` for an address: `addressData ? addressData.chain_stats.tx_count + addressData.mempool_stats.tx_count : undefined`.
  - `isLocalCoinJoin`:
    - tx: `() => !!txData && isCoinJoinTx(txData)`;
    - address: build a Set from `addressTxs.filter(isCoinJoinTx)`.
  - `onScan` = the existing `onScan`.
- **`WalletResults.tsx`:**
  - Below `<FindingGroups …/>` in the left column, render the card when txids is non-empty.
  - The txids are `selectTxids(addressInfos.flatMap((i) => i.txs), WALLET_CAP)`, with `mode="wallet-like"`.
  - `totalAvailable` = the unique tx count.
  - `isLocalCoinJoin` from a Set of `isCoinJoinTx` over those txs; `onScan`.
- **`faq.a_data`, all 6 locales:** after the broadcast sentence, add (English): "Two optional checks run only when clicked: Chainalysis screening and the CoinJoin services check (Wabisator), both through a relay or Tor so your IP address is not shared." Translate the same sentence into the other 5.
- **`docs/development-guide.md`:** a short "Services" section covering the registry, `/svc` on the worker and sidecar, the aggregate vs lookup classes, `LookupConsent`, and where the card is mounted.

e2e (`e2e/services.spec.ts`, offline mocks as in other specs):
- Add `mockWabisator(page)` to `e2e/helpers/mock-api.ts`:
  - route `https://coinjoin-stats.copexit.workers.dev/svc/wabisator/api.php`;
  - answer `search` / `coinjoin` from the Task 5 fixtures (read with `fs` from `src/lib/services/__tests__/fixtures`);
  - unknown txids get `wabisator-search-unknown.json` with the query rewritten;
  - record every request's method in an array the test can inspect.
- Tests:
  1. **Tx scan of a fixture tx already used by other e2e specs** (look in `e2e/scan-tx.spec.ts` for a mocked txid), with the Wabisator mock returning the coinjoin fixtures for that txid. The card shows the consent button and NO request has reached `/svc/wabisator` (Review Focus 5 and Goal 3). Click "Check CoinJoin services", then "Kruw" and "Remixed" are visible.
  2. **Address scan:** the card shows the privacy line with a count no larger than 10. Click, then a result view appears ("No recorded" or tiles).
  3. **Wallet scan** (reuse `e2e/wallet-scan.spec.ts` setup with its funding tx): the mock maps that funding txid to `wabisator-search-postmix.json` with the query rewritten. After the click, the post-mix warning is NOT shown for a single-coin tx; adapt the fixture so `OutOf` has 2+ coins and assert the warning IS shown.
  4. **A fresh address with no txs** renders no card (Review Focus 5).

- [ ] **Step 1: Write the e2e spec and mock helper** (failing: there is no card yet).
- [ ] **Step 2: Wire the components.**
- [ ] **Step 3: Gates:**
  - `pnpm type-check`
  - `pnpm lint`
  - `pnpm test` (the full suite; coverage thresholds in `vitest.config.ts` must still hold via `pnpm test:coverage` if the script exists)
  - `pnpm build`
  - `CI=1 pnpm exec playwright test --workers=1` (the full e2e)

  After the build, `git checkout -- public/sitemap.xml` if changed.
- [ ] **Step 4: Commit**

```bash
git add src/components/results/Results.tsx src/components/flows/WalletResults.tsx public/locales src/components/pages/FaqPage.tsx docs/development-guide.md e2e/services.spec.ts e2e/helpers/mock-api.ts
git commit -m "feat(services): CoinJoin services check on tx, address and wallet results"
```

---

### Task 8 (controller, not a subagent): Rollout

1. **Deploy the worker:**
   - From `/home/user/aie-services`: `pnpm exec wrangler deploy --config workers/coinjoin-stats/wrangler.toml`.
   - Verify live with curl, sending `-H "Origin: https://am-i.exposed"`:
     - `POST /svc/wabisator/api.php` `dashboard` gives 200 with `Cache-Control: public, max-age=60`;
     - `search` with a valid txid gives 200 with `no-store`;
     - `graph` gives 400;
     - `/svc/whirlpoolstats/summary` gives 200;
     - legacy `/whirlpool/summary` gives 200.
2. **PR, CI, merge:** push the branch, open the PR (no AI attribution), wait for CI, merge (squash).
3. **Release 0.39.0:**
   - Bump `package.json` and `cli/package.json`; commit `chore: bump version to 0.39.0`; tag `v0.39.0`; push main and the tag.
   - Watch the deploy, docker-umbrel and docker-tor-proxy workflows.
   - `docker buildx imagetools inspect` both images (amd64 + arm64).
   - Run `scratchpad/umbrel-test/run.sh` with the new digests, and curl `/tor-proxy/svc/whirlpoolstats/summary` through it (expect 502 offline Tor; the route must exist, not 404).
4. **Community store:** update `~/copexit-umbrel-app-store/copexit-am-i-exposed/` (digests, version 0.39.0, releaseNotes) and push master.
5. **Memory:** update the release memory file.
