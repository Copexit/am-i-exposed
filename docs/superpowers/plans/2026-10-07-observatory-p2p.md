# Observatory v2: P2P Markets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "P2P markets" tab to `/observatory` that shows live KYC-free bitcoin liquidity from RoboSats (whole federation), Mostro and HodlHodl, normalized to one offer schema: headline, per-currency depth ("the wall"), offer list, premium board, venue and coordinator health, volume history.

**Architecture:**
- **Proxies:** the existing `/svc/<id><path>` route on the CF worker and the Umbrel sidecar gains (a) HodlHodl pagination plumbing (`offset` validator, `fixedQuery`), (b) onion-only services, (c) Nostr snapshot routes (fixed registry filters, one-shot REQ to listed relays, JSON snapshot back). The sidecar also learns `http://` for onion hosts.
- **Pure TypeScript modules** in `src/lib/observatory/p2p/`: Nostr signature verification, one normalizer per venue, sanitizer, market builder, hash state. Unit-tested against fixtures recorded live on 2026-10-07.
- **Data layer:** `p2p-client.ts` plus `useP2p`, built on the existing `serviceGet`, `withObservatoryCache` and `usePolled`.
- **UI:** React components under `src/components/observatory/p2p/`, mounted as the third Observatory tab.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript strict, Tailwind 4 (tokens in `src/app/globals.css`), motion/react, visx (installed), `@noble/curves` + `@noble/hashes` v2 (installed; see `reference_noble_scure_gotchas` in memory: import paths end in `.js`), react-i18next (6 locales), Vitest + Testing Library (jsdom), Playwright. Sidecar: Node CommonJS, `socks-proxy-agent`, new `ws`.

**Spec:** `docs/spec-observatory-p2p.md`. Read it fully, especially "Providers", "Registry entries", "Nostr snapshot", "Data model", "Page" and "Rulings". The plan argues from it; where they disagree, the spec wins and the disagreement is reported.

## Global Constraints

- **Workflow:**
  - pnpm only for the app. The sidecar (`umbrel/tor-proxy/`) has its own `package-lock.json`: use `npm install` there only.
  - Work only in `/home/user/aie-p2p` (branch `feat/observatory-p2p`). Never touch `/home/user/am-i-exposed` or other worktrees. Never `git stash`. Never push or deploy.
  - Commits: conventional, NO `Co-Authored-By` or any AI attribution; never `-c user.email/name`.
- **Gates for every task:** `pnpm type-check`; `pnpm lint` (0 warnings); the task's tests; `src/lib/__tests__/locale-parity.test.ts` when locales change. Worker and sidecar tests run from the root (`vitest.config.ts` includes `workers/**/*.test.js` and `umbrel/**/*.test.js`), for example `pnpm test workers umbrel`.
- **Code:** TypeScript strict, no `any`. Worker and sidecar are plain JS, mirroring the existing style.
- **Copy:**
  - No em dashes (U+2014, its `\u` escape, the HTML entity) anywhere, including fixtures you write.
  - No "we/us/our"; passive or tool-named voice. Spanish is Castilian tuteo.
  - Every `t()` key has a `defaultValue` and exists in all 6 locales (`public/locales/{en,es,pt,de,pl,fr}/common.json`), under `observatory.p2p.*`.
- **Privacy (hard):**
  - The browser only calls the worker (public) or `/tor-proxy` (self-hosted). Never a relay, coordinator or HodlHodl directly.
  - Every P2P route is `aggregate`. No visitor data in any request.
  - Never render trader identities: Nostr `name` tags, `content`, HodlHodl `title`, `description`, `trader.*`, RoboSats `maker_nick`. Payment methods always go through `sanitizeMethods`.
  - Fixtures are redacted (see "Fixtures"); never re-record unredacted ones into the repo.
- **Refresh:** poll only while visible (`usePolled`), keep last good data, intervals and TTLs as in the spec's table.
- **Visual quality bar:** the spec's section and the WabiSabi spec's bar. Tokens only (new `--p2p-*` tokens in `globals.css`, both themes). No horizontal page scroll at 390 px. Touch targets >= 40 px. `prefers-reduced-motion` honoured.
- **Existing behaviour:** WabiSabi and Whirlpool tabs keep working; existing worker, sidecar and Observatory tests keep passing.
- **e2e:** run `pnpm build` first; `ss -ltnp | grep :3333` must be empty; then `CI=1 pnpm exec playwright test <files> --workers=1`; afterwards `git checkout -- public/sitemap.xml` if changed.

## Review Focus

1. **Signature verification is real:** `verifyEvent` must reject a tampered `tags` array and a wrong `sig`, and normalizers must only see verified events in production code paths (`useP2p`). Tests in Task 4 and Task 7.
2. **No identity leaks:** a DOM test renders the full offer list from the fixtures and asserts that no robot nick (`"Robot"` placeholder plus the original sample nicks from `signed-sample.json`), no `trader-` login and no `@user`/`[number]` placeholder reaches the DOM. Tests in Task 5 (normalizer output) and Task 9 (DOM).
3. **Units:** RoboSats `historical.volume` and `info.last_day_volume` are BTC; `book_liquidity`, `min_order_size`, Nostr `amt` and HodlHodl `*_sats` are sats; `maker_fee`/`taker_fee` are fractions (0.00025 = 0.025%); `bond_size` and `premium` are percent. A unit mistake here is the most likely bug. Tests in Task 5 pin each.
4. **Proxy fail-closed:** a `nostr` route on POST, a `nostr` route classed `lookup`, an unknown validator, or a client-sent filter must never reach a relay. Tests in Tasks 1 to 3.
5. **Partial outages:** one relay timing out, one coordinator down, the index down: the page renders with what it has, the source strip says what is missing, nothing shows a misleading zero. Tests in Task 6 (market without index), Task 8 (source strip), Task 12 (e2e with one route failing).
6. **Onion-only on the public site:** the client must never request `robosats-bazaar` etc. from the worker. Test in Task 7.

---

## Fixtures (already committed with this plan)

Recorded live on 2026-10-07 (`fetchedAt` 1791386100 = 2026-10-07 16:35 UTC) in `src/lib/observatory/__tests__/fixtures/p2p/`. Nostr files use the snapshot envelope the proxies return (`{ events, relays, fetchedAt }`).

| File | Content | Notes |
|---|---|---|
| `nostr/robosats-orders.json` | 131 kind-38383 pending orders, all 7-federation pubkeys (5 coordinators active) | Redacted: robot `name` replaced by `"Robot"`; signatures no longer verify (ids too) |
| `nostr/mostro-orders.json` | 115 kind-38383 `y=mostro` pending events from 3 relays (103 live mainnet at `fetchedAt`, some regtest, some expired) | 8 events redacted (`pm` handles/links/numbers); the rest still verify |
| `nostr/mostro-info.json` | 106 kind-38385 info events, 97 instance pubkeys | Unredacted (no free text) |
| `nostr/mostro-trades.json` | 314 `s=success` events, last 30 days (dense for the last 9) | 22 redacted |
| `nostr/signed-sample.json` | 12 untouched events (6 RoboSats, 6 Mostro) with no free text | The only file for signature tests |
| `robosats/temple-info.json`, `lake-info.json`, `bazaar-info.json` | `/api/info/` (bazaar recorded via its onion) | |
| `robosats/temple-limits.json` | `/api/limits/`, 80 currencies | Index source |
| `robosats/temple-historical.json`, `lake-historical.json` | `/api/historical/`, 1,076 and 1,022 days | volume in BTC |
| `hodlhodl/offers-0.json` | page offset 0, 100 offers (`payment_methods` shape) | title/description null, `trader.login` = `trader-N`, `trader.url` null |
| `hodlhodl/offers-500.json` | page offset 500, 70 offers (last page; one offer uses `payment_method_instructions`) | same redaction |

Redaction rules used (for anyone re-recording): in `pm` and `content`, URLs and `t.me`/`wa.me` links become `[link]`, `@handle` becomes `@user`, runs of 7+ digits become `[number]`; Nostr `name` tag values become `Robot`; HodlHodl as above. Re-recording is never needed for the tests.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/services/registry.json` (+ `umbrel/tor-proxy/services.json` byte copy) | 7 `robosats-*` services, `robosats-nostr`, `mostro-nostr`, `hodlhodl` |
| `src/lib/services/registry.ts` | Types: optional `base`, `relays`, `onionRelays`, `fixedQuery`, `nostr`, `offset` validator; `isReachable(service, isUmbrel)` |
| `workers/coinjoin-stats/svc.js` | `offset`, `fixedQuery`, onion-only 404, nostr dispatch |
| `workers/coinjoin-stats/nostr.js` | Worker Nostr snapshot via `fetch` WebSocket upgrade |
| `umbrel/tor-proxy/fetch-via-agent.js` | Extracted from `server.js`; http/https by protocol |
| `umbrel/tor-proxy/nostr.js` | Sidecar Nostr snapshot with injected `openSocket` |
| `umbrel/tor-proxy/{svc.js,handler.js,server.js,Dockerfile,package.json}` | Wiring, `ws` dependency |
| `src/lib/observatory/p2p/types.ts` | `P2pOffer`, `VenueHost`, `DailyVolume`, `IndexPrices`, `Market`, raw response types |
| `src/lib/observatory/p2p/nostr-verify.ts` | `verifyEvent`, `verifySnapshot`, `latestReplaceable`, `tag` helpers |
| `src/lib/observatory/p2p/sanitize.ts` | `sanitizeMethods`, `sanitizeNotice` |
| `src/lib/observatory/p2p/normalize-robosats.ts` | orders, info, historical, limits |
| `src/lib/observatory/p2p/normalize-mostro.ts` | orders, info, trades |
| `src/lib/observatory/p2p/normalize-hodlhodl.ts` | offers, host |
| `src/lib/observatory/p2p/market.ts` | index lookup, premium, markets, depth, board, headline, default currency |
| `src/lib/observatory/obs-hash.ts` | adds `cur`, `side`, `venue` |
| `src/lib/observatory/p2p/p2p-client.ts` | one fetcher per source, refresh table |
| `src/hooks/usePolled.ts` | moved from `useWabisator.ts` (re-exported there) |
| `src/hooks/useP2p.ts` | composes sources into offers, hosts, markets, source statuses |
| `src/components/observatory/p2p/*` | `P2pTab`, `P2pHeadline`, `SourceStrip`, `MarketSelector`, `DepthWall`, `OfferList`, `PremiumBoard`, `VenueSection`, `P2pVolume`, `P2pFooter` |
| `src/hooks/useObsState.ts`, `src/components/observatory/ObservatoryPage.tsx` | third tab |

---

### Task 1: Registry and worker GET plumbing

**Files:**
- Modify: `src/lib/services/registry.json`, `umbrel/tor-proxy/services.json` (byte copy), `src/lib/services/registry.ts`, `src/lib/services/__tests__/registry.test.ts`, `workers/coinjoin-stats/svc.js`, `workers/coinjoin-stats/__tests__/svc.test.js`, `umbrel/tor-proxy/svc.js` (validator and `fixedQuery` only), `umbrel/tor-proxy/__tests__/handler.test.js`

**Interfaces:**

```ts
// registry.ts additions
export type ParamValidator = "txid" | "page" | "offset";
export interface NostrFilter { kinds: number[]; authors?: string[]; limit: number; [tag: `#${string}`]: string[] | undefined }
export interface ServiceRoute { /* existing */ fixedQuery?: Record<string, string>; nostr?: { filter: NostrFilter; sinceSeconds?: number } }
export interface ServiceDef { /* existing, but */ base?: string; relays?: string[]; onionRelays?: string[] }
/** Public site: needs base (or relays for nostr services). Self-hosted: base, onion or relays. */
export function isReachable(s: ServiceDef, isUmbrel: boolean): boolean;
// validateParam("offset", v): integer, NaN/negative -> "0", clamp 5000, floor to multiple of 100
```

Registry content: exactly the spec's "Registry entries" block, expanded:
- `robosats-temple`, `robosats-lake` (base + onion), `robosats-bazaar`, `robosats-alice`, `robosats-eleuteria`, `robosats-freeport`, `robosats-ammanaya` (onion only), onions and pubkeys from the spec table / `federation.json` (full values: temple `ngdk7ocdzmz5kzsysa3om6du7ycj2evxp2f2olfkyq37htx3gllwp2yd`, lake `4t4jxmivv6uqej6xzx2jx3fxh75gtt65v3szjoqmc4ugdlhipzdat6yd`, bazaar `librebazovfmmkyi2jekraxsuso3mh622avuuzqpejixdl5dhuhb4tid`, alice `alice7bqexhtnkiqhtgkuwgtzzfkishw23ac4sfwpznrwlmnipxlomyd`, eleuteria `ixiiqsuzt7hh5qxshiqwyewyh3gyygltbygqlvlyitg3gl3u2cemk3ad`, freeport `2enoseg66hme76khjjn2qvrhipnzwgwa44mewgrdphrxbhzcxd2vdiqd`, ammanaya `ammannjgzybw4qm2odmci7xgolh5grzijidacjxose5tthm375dcopad`, each `.onion` with `http://`).
- `robosats-nostr` `/orders` filter `authors`: `74001620297035daa61475c069f90b6950087fea0d0134b795fac758c34e7191`, `f2d4855df39a7db6196666e8469a07a131cddc08dcaa744a344343ffcf54a10c`, `95521a33ba34f5924464f425e81b896b1aa9069796a778368ed053e3612c509b`, `40d33962fdf26e0910805f36a3a96b239cf93b95d4a3e6dd779f1ea3ff9b0866`, `0f243ba69b7c7ffa73934bc7f5fa6586b8013afdc310d808b1ec2c2c98f1c219`, `e489cdb0b24fa416a49b524625e0edab0f7235f3a0261a3cdfc64c4efdc14afd`, `91820b0fc7e52873a574208c7b4e9b8ae848ee25e5c03bac655c45d060995548`.
- `mostro-nostr`, `hodlhodl` as in the spec.
- Add a top-level-per-service optional `"p2p"` block for UI metadata the client needs and nothing else reads: `{ "venue": "robosats", "key": "temple", "pubkey": "...", "color": "#000" }` for coordinators. (Keeps `federation.json` facts in one place.) Type it as `p2p?: { venue: "robosats" | "mostro" | "hodlhodl"; key: string; pubkey?: string }` and drop `color` (colours are tokens, Task 8).

Worker `svc.js` behaviour:
- `validateParam("offset", ...)` as above.
- GET: after validated params, append every `fixedQuery` entry (overwriting any same-named client param, which was never forwarded anyway since only declared names are).
- `service.base` missing: `404 ONION_ONLY` (before any fetch).
- `route.nostr`: if `request.method !== "GET"` or `route.class !== "aggregate"` answer `500 MISCONFIGURED`; else delegate to `handleNostr` (Task 2). In this task, stub the import so it answers `501 NOT_IMPLEMENTED`, and Task 2 replaces it.

Sidecar `svc.js`: same `offset` and `fixedQuery`; a service with neither `onion` nor `base` (pure nostr services hitting a non-nostr path) answers 404.

- [ ] **Step 1: Write failing tests.**
  - registry.test.ts:
    ```ts
    it("every service has a base, an onion or relays; nostr routes are GET aggregate", () => {
      for (const s of SERVICES) {
        expect(Boolean(s.base || s.onion || s.relays?.length)).toBe(true);
        if (s.base) expect(s.base).toMatch(/^https:\/\//);
        if (s.onion) expect(s.onion).toMatch(/^http:\/\/[a-z2-7]{56}\.onion$/);
        for (const r of s.routes) if (r.nostr) { expect(r.http).toBe("GET"); expect(r.class).toBe("aggregate"); expect(s.relays?.length).toBeGreaterThan(0); }
      }
    });
    it("offset validator floors and clamps", () => {
      expect(validateParam("offset", "250")).toBe("200");
      expect(validateParam("offset", "-5")).toBe("0");
      expect(validateParam("offset", "x")).toBe("0");
      expect(validateParam("offset", "999999")).toBe("5000");
    });
    it("reachability", () => {
      expect(isReachable(getService("robosats-bazaar")!, false)).toBe(false);
      expect(isReachable(getService("robosats-bazaar")!, true)).toBe(true);
      expect(isReachable(getService("robosats-temple")!, false)).toBe(true);
      expect(isReachable(getService("mostro-nostr")!, false)).toBe(true);
    });
    ```
    Replace the old `expect(s.base).toMatch(/^https:\/\//)` line (now conditional).
  - svc.test.js:
    ```js
    it("hodlhodl: forwards validated offset plus fixed limit", async () => {
      const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ status: "success", offers: [] }));
      const res = await handler.fetch(new Request("https://w.dev/svc/hodlhodl/api/v1/offers?pagination%5Boffset%5D=230&pagination%5Blimit%5D=9999&x=1"), env, ctx);
      expect(res.status).toBe(200);
      const u = new URL(f.mock.calls[0][0]);
      expect(u.origin + u.pathname).toBe("https://hodlhodl.com/api/v1/offers");
      expect(u.searchParams.get("pagination[offset]")).toBe("200");
      expect(u.searchParams.get("pagination[limit]")).toBe("100");
      expect(u.searchParams.has("x")).toBe(false);
    });
    it("onion-only service answers 404 ONION_ONLY without fetching", async () => {
      const f = vi.spyOn(globalThis, "fetch");
      const res = await handler.fetch(new Request("https://w.dev/svc/robosats-bazaar/api/info/"), env, ctx);
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("ONION_ONLY");
      expect(f).not.toHaveBeenCalled();
    });
    it("robosats clearnet info is edge-cached with its ttl", async () => { /* two GETs, one fetch, Cache-Control public, max-age=60, upstream https://unsafe.templeofsats.org/api/info/ */ });
    it("a nostr route declared as POST or lookup is MISCONFIGURED", async () => {
      const svc = createSvc({ services: [{ id: "n", relays: ["wss://r"], routes: [{ path: "/o", http: "GET", class: "lookup", nostr: { filter: { kinds: [1], limit: 1 } } }] }] });
      const res = await svc(new Request("https://w.dev/svc/n/o"), new URL("https://w.dev/svc/n/o"), ctx, {});
      expect(res.status).toBe(500);
    });
    ```
  - handler.test.js: the hodlhodl offset/fixed-limit case through `createHandler` with a fake `fetchViaAgent` (assert the URL it receives).
- [ ] **Step 2:** `pnpm test src/lib/services workers umbrel`; expect FAIL.
- [ ] **Step 3:** implement; `cp src/lib/services/registry.json umbrel/tor-proxy/services.json`.
- [ ] **Step 4:** tests PASS; type-check; lint. Check that existing callers of `ServiceDef.base` (grep `\.base`) still type-check with `base?`.
- [ ] **Step 5: Commit** `feat(services): P2P registry entries, offset validator, fixed query, onion-only services`

---

### Task 2: Worker Nostr snapshot

**Files:**
- Create: `workers/coinjoin-stats/nostr.js`, `workers/coinjoin-stats/__tests__/nostr.test.js`
- Modify: `workers/coinjoin-stats/svc.js` (dispatch), `workers/coinjoin-stats/README.md` (P2P routes)

**Interfaces:**

```js
// nostr.js
/** Builds the REQ filter: registry filter plus since = floor(nowSec/ttl)*ttl - sinceSeconds when set. */
export function buildFilter(route, nowSec) {}
/** Opens every relay, REQ, collects until EOSE/CLOSED/error/timeout. Never throws. */
export async function snapshot({ relays, filter, timeoutMs, openSocket, nowSec }) {} // -> { events, relays: [{url,status,count}], fetchedAt }
/** Worker socket opener: fetch(url with wss->https, ws->http, { headers: { Upgrade: "websocket" } }); resp.webSocket.accept(). */
export async function openWorkerSocket(url) {} // -> { send(str), close(), onMessage(fn), onClose(fn), onError(fn) }
/** svc.js calls this for nostr routes; edge-caches like other aggregate routes. */
export async function handleNostr({ service, route, ctx, cors, openSocket = openWorkerSocket, now = Date.now }) {}
```

Rules (spec "Nostr snapshot"):
- Validate each incoming `EVENT` frame: `["EVENT", "s", ev]` with `typeof ev.id === "string" && /^[0-9a-f]{64}$/`, same for `pubkey`, 128-hex `sig`, integer `created_at`, integer `kind` in `filter.kinds`, array `tags`, string `content`. Otherwise drop.
- Dedupe by `id`; stop collecting past 3,000 events; sort newest first.
- Relay status: `eose` (EOSE or CLOSED received), `timeout`, `error` (socket error or upgrade not 101). `count` = events accepted from that relay.
- Every relay `error` gives `502 UPSTREAM_DOWN`; otherwise `200`.
- Serialized body over 4 MiB gives `502 UPSTREAM_HTTP` (same as GET).
- Cache key `https://cache.local/svc/<id><path>?since=<since or 0>`, `Cache-Control: public, max-age=<ttl>`.
- After collecting: send `["CLOSE","s"]` and close every socket (try/catch each).

- [ ] **Step 1: Write failing tests** with a fake socket factory:
  ```js
  function fakeRelay(script) { // script: array of frames to emit after REQ, or "error" / "hang"
    return async (url) => {
      const handlers = {};
      const sock = {
        sent: [],
        send(s) { this.sent.push(JSON.parse(s)); if (JSON.parse(s)[0] === "REQ") queueMicrotask(() => {
          const sc = script(url);
          if (sc === "error") return handlers.error?.();
          if (sc === "hang") return;
          for (const f of sc) handlers.message?.(JSON.stringify(f));
        }); },
        close() { this.closed = true; },
        onMessage(fn) { handlers.message = fn; }, onClose(fn) { handlers.close = fn; }, onError(fn) { handlers.error = fn; },
      };
      return sock;
    };
  }
  ```
  Cases:
  - two relays both EOSE, an event present on both: one copy, statuses `eose`, counts 1 and 1, fetchedAt from injected clock;
  - one relay hangs: result after `timeoutMs` (use `vi.useFakeTimers()`), status `timeout`, 200;
  - all relays error: 502 `UPSTREAM_DOWN`;
  - wrong kind, short id, missing sig: dropped;
  - 3,500 distinct events: capped at 3,000;
  - `buildFilter` with `sinceSeconds: 604800, ttl: 600` at `nowSec=1791386100` gives `since = 1791385800 - 604800`;
  - the REQ frame sent equals `["REQ","s", filter]` and nothing from the client request is in it (call `handler.fetch` with `?filter=...` and assert the frame);
  - edge cache: second call within TTL does not open sockets;
  - `openWorkerSocket` with a mocked `fetch` returning `{ status: 101, webSocket: { accept(){}, addEventListener(){} , send(){}, close(){} } }`, and a non-101 response gives an error status.
- [ ] **Step 2:** FAIL. **Step 3:** implement; wire `svc.js` dispatch. **Step 4:** PASS, lint.
- [ ] **Step 5: Commit** `feat(worker): Nostr snapshot routes for P2P order relays`

---

### Task 3: Sidecar: http onion hosts and Nostr through Tor

**Files:**
- Create: `umbrel/tor-proxy/fetch-via-agent.js`, `umbrel/tor-proxy/nostr.js`, `umbrel/tor-proxy/__tests__/fetch-via-agent.test.js`, `umbrel/tor-proxy/__tests__/nostr.test.js`
- Modify: `umbrel/tor-proxy/server.js` (use the extracted fetcher; build `openSocket` with `ws` + the existing agent), `umbrel/tor-proxy/svc.js` (nostr dispatch: `onionRelays ?? relays`), `umbrel/tor-proxy/handler.js` (pass `openSocket` through `createHandler`), `umbrel/tor-proxy/package.json` + `package-lock.json` (`npm install ws@^8`), `umbrel/tor-proxy/Dockerfile` (`COPY server.js handler.js svc.js nostr.js fetch-via-agent.js services.json ./`)

**Interfaces:**

```js
// fetch-via-agent.js (CommonJS)
/** Same behaviour as today's server.js fetchViaAgent, but chooses http or https by URL protocol (port 80/443 default). */
function createFetchViaAgent({ http, https, agent, maxBytes, defaultTimeoutMs }) {} // -> fetchViaAgent(url, { method, body, contentType, timeoutMs })
// nostr.js (CommonJS): same contract as the worker's snapshot(), and
function createNostrRoute({ openSocket, now = Date.now }) {} // -> async (res, service, route) writes the JSON or 502, no-store
```

`server.js` `openSocket(url)`: `new WebSocket(url, { agent, handshakeTimeout: 15000 })` from `ws`, adapted to the `{ send, close, onMessage, onClose, onError }` shape. Port the snapshot logic from the worker file (copy, CommonJS); keep the two in sync by sharing the test vectors (copy the worker's test cases).

- [ ] **Step 1: Write failing tests.**
  - fetch-via-agent: with fake `http`/`https` modules recording `request(opts)`, `http://abc.onion/api/info/` uses `http` with port 80, `https://hodlhodl.com/...` uses `https` with port 443, both with the agent; a response over `maxBytes` rejects; non-2xx rejects with `status`.
  - nostr: the worker's cases (dedupe, timeout, all-error 502, cap, kinds), plus "onionRelays preferred": a service with both lists opens only the onion ones.
  - handler.test.js: `GET /svc/mostro-nostr/orders` through `createHandler({ fetchViaAgent, openSocket: fakeRelay(...) })` returns the snapshot with `Cache-Control: no-store`.
- [ ] **Step 2:** FAIL. **Step 3:** implement; `cd umbrel/tor-proxy && npm install ws@^8 && cd -`. **Step 4:** PASS; `docker build umbrel/tor-proxy` is NOT required here (controller does it at release), but `node -e "require('./umbrel/tor-proxy/server.js')"` must not be run (it listens); instead `node --check umbrel/tor-proxy/server.js`.
- [ ] **Step 5: Commit** `feat(tor-proxy): http onion hosts and Nostr snapshots through Tor`

---

### Task 4: Pure foundations: types, Nostr verification, sanitizer

**Files:**
- Create: `src/lib/observatory/p2p/types.ts`, `src/lib/observatory/p2p/nostr-verify.ts`, `src/lib/observatory/p2p/sanitize.ts`, tests `src/lib/observatory/p2p/__tests__/nostr-verify.test.ts`, `sanitize.test.ts`

**Interfaces:**

```ts
// types.ts: everything in the spec's "Data model" block, plus raw shapes:
export interface NostrEvent { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }
export interface NostrSnapshot { events: NostrEvent[]; relays: { url: string; status: "eose" | "timeout" | "error"; count?: number }[]; fetchedAt: number }
export interface RoboInfo { num_public_buy_orders: number; num_public_sell_orders: number; book_liquidity: number; active_robots_today: number; last_day_nonkyc_btc_premium: number; last_day_volume: number; lifetime_volume: number; version: { major: number; minor: number; patch: number }; maker_fee: number; taker_fee: number; bond_size: number; min_order_size: number; max_order_size: number; notice_severity: string; notice_message: string }
export type RoboLimits = Record<string, { code: string; price: number; min_amount: number; max_amount: number }>;
export type RoboHistorical = Record<string, { volume: number; num_contracts: number }>;
export interface HodlOffer { id: string; side: "buy" | "sell"; currency_code: string; asset_layer: string; price: string; price_source: string; exchange_price_deviation: string | null; exchange_price_sign: string | null; exchange_price_unit: string | null; min_amount: string; max_amount: string; min_amount_sats: string | null; max_amount_sats: string | null; fee: { author_fee_rate: string }; payment_methods?: { name: string }[]; payment_method_instructions?: { payment_method_name: string }[]; working_now: boolean; country_code: string }
export interface HodlPage { status: string; offers: HodlOffer[] }

// nostr-verify.ts
export function eventId(e: Omit<NostrEvent, "id" | "sig">): string;     // sha256 hex of JSON.stringify([0, pubkey, created_at, kind, tags, content])
export function verifyEvent(e: NostrEvent): boolean;                     // id matches AND schnorr.verify(sig, id, pubkey); false on any throw
export function verifySnapshot(s: NostrSnapshot): { events: NostrEvent[]; rejected: number };
export function latestReplaceable(events: NostrEvent[]): NostrEvent[];   // newest per `${pubkey}:${kind}:${d}`; ties by id
export function tag(e: NostrEvent, name: string): string[] | undefined;  // values after the name, first match

// sanitize.ts
export function sanitizeMethods(raw: string[], max?: number): string[];  // default max 4 labels, 32 chars each
export function sanitizeNotice(s: string, max?: number): string | null; // default 140; empty -> null
```

Implementation notes:
- `@noble/curves/secp256k1.js` exports `schnorr`; `@noble/hashes/sha2.js` exports `sha256`; `@noble/hashes/utils.js` exports `bytesToHex`, `hexToBytes`, `utf8ToBytes`. This exact snippet verified all 12 events of `signed-sample.json` during research:
  ```ts
  const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))));
  return id === e.id && schnorr.verify(hexToBytes(e.sig), hexToBytes(id), hexToBytes(e.pubkey));
  ```
- `sanitizeMethods`: for each raw string: remove `https?://\S+`, `\b(t|wa)\.me/\S+`, `@\w+`, `\+?\d[\d\s-]{5,}\d`, the placeholders `[link]`, `[number]`, `@user`, and emoji (`\p{Extended_Pictographic}` and variation selectors, `u` flag); collapse whitespace; trim punctuation at the ends; drop empties; dedupe case-insensitively; truncate to `max` chars with an ellipsis character `…`. RoboSats splits methods on spaces into separate `pm` values: join a RoboSats `pm` tag with spaces before sanitizing (the normalizer does that, the sanitizer just takes strings).

- [ ] **Step 1: Write failing tests:**
  ```ts
  import sample from "../../__tests__/fixtures/p2p/nostr/signed-sample.json";
  it("verifies all 12 recorded events", () => expect(sample.events.every((e) => verifyEvent(e as NostrEvent))).toBe(true));
  it("rejects a tampered tag and a wrong sig", () => {
    const e = structuredClone(sample.events[0]) as NostrEvent;
    expect(verifyEvent({ ...e, tags: [...e.tags, ["x", "1"]] })).toBe(false);
    expect(verifyEvent({ ...e, sig: "00".repeat(64) })).toBe(false);
    expect(verifyEvent({ ...e, pubkey: "zz" })).toBe(false);
  });
  it("verifySnapshot counts rejects", () => { /* sample + one tampered => rejected 1 */ });
  it("latestReplaceable keeps newest per d", () => { /* two events same pubkey/kind/d, different created_at */ });
  it("sanitizes contact details", () => {
    expect(sanitizeMethods(["SPEI", "retiro sin tarjeta @nantulec"])).toEqual(["SPEI", "retiro sin tarjeta"]);
    expect(sanitizeMethods(["Nequi 🟡🔵 https://t.me/x +57 300 123 4567"])).toEqual(["Nequi"]);
    expect(sanitizeMethods(["Revolut", "revolut", "SEPA", "Zelle", "Wise", "PayPal"])).toEqual(["Revolut", "SEPA", "Zelle", "Wise"]);
    expect(sanitizeMethods(["[link] @user [number]"])).toEqual([]);
  });
  ```
  (JSON imports work in Vitest with `resolveJsonModule`; if the type of `tags` widens badly, cast through `unknown as NostrSnapshot`.)
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS, type-check, lint.
- [ ] **Step 5: Commit** `feat(p2p): Nostr event verification, P2P types and method sanitizer`

---

### Task 5: Venue normalizers

**Files:**
- Create: `src/lib/observatory/p2p/normalize-robosats.ts`, `normalize-mostro.ts`, `normalize-hodlhodl.ts`, tests for each under `src/lib/observatory/p2p/__tests__/`

**Interfaces:**

```ts
// normalize-robosats.ts
export const ROBOSATS_COORDINATORS: { key: string; name: string; pubkey: string; serviceId: string }[]; // derived from registry services with p2p.venue === "robosats"
export function robosatsOffers(events: NostrEvent[], index: IndexPrices | null, nowSec: number): P2pOffer[];
export function robosatsHost(key: string, info: RoboInfo | null, inBook: number, reachable: boolean): VenueHost;
export function robosatsHistory(h: RoboHistorical): DailyVolume[];        // sorted by date asc, date = first 10 chars
export function robosatsIndex(l: RoboLimits, source: string, at: number): IndexPrices;
// normalize-mostro.ts
export function mostroOffers(orders: NostrEvent[], info: NostrEvent[], index: IndexPrices | null, nowSec: number): P2pOffer[];
export function mostroHosts(orders: NostrEvent[], info: NostrEvent[], nowSec: number): VenueHost[];
export function mostroDaily(trades: NostrEvent[], index: IndexPrices | null, nowSec: number, days?: number): DailyVolume[]; // default 7, zero-filled
// normalize-hodlhodl.ts
export function hodlhodlOffers(pages: HodlPage[], index: IndexPrices | null, nowSec: number): P2pOffer[];
export function hodlhodlHost(offers: P2pOffer[], ok: boolean): VenueHost;
```

`nowSec` is always the snapshot's `fetchedAt` (spec ruling 20); for HodlHodl, the time of the fetch.

Mapping rules (pin each in a test):
- **Common:** `side` from the `k` tag (or HodlHodl `side`), maker's perspective. `currency` uppercased. `price = index * (1 + premium/100)` when a declared premium and an index exist; HodlHodl uses its `price`. `satsMax`: `amt` if > 0, else HodlHodl `max_amount_sats`, else `round(fiatMax / price * 1e8)` when `price`, else null. Pass `premium`, `index` lookups through `indexFor` from Task 6 (import it; if Task 6 is not merged yet, implement `indexFor` in `market.ts` first in this task, it is two lines).
- **RoboSats:** keep only events whose `pubkey` is a federation pubkey and `y[0] === "robosats"`, `network` mainnet, `s` pending, `expiration` > now. `host` = coordinator key from the pubkey. `fa` with one value: fiatMin = fiatMax; two values: range. `pm` values joined by spaces then sanitized as one string (RoboSats splits labels on spaces; keep the joined label). `layer` from tag. `bondPct` from `bond`. `link` from `source` only when it matches `^http://[a-z2-7]{56}\.onion/` of that coordinator's onion. `id` `robosats:<key>:<d>`.
- **RoboSats info:** `makerFeePct = maker_fee * 100`, `takerFeePct = taker_fee * 100`, `bondPct = bond_size`, `minSats = min_order_size`, `maxSats = max_order_size`, `volume24hBtc = last_day_volume`, `lifetimeBtc = lifetime_volume`, `version = "0.8.7"`, `notice` only when `notice_severity` is not `none`/empty. `status`: info present gives `up`; info fetch failed gives `down`; not reachable (public, onion-only) gives `unknown`.
- **Mostro:** `latestReplaceable` first. Keep `y[0] === "mostro"`, `network` mainnet, `s` pending, `expires_at` > now, `pubkey` in the info set. `host` = pubkey; host `name` = `y[1]` of its latest order or info, else `pubkey.slice(0, 8)`. `link` null. Info tags: `mostro_version`, `fee` (fraction, so `* 100`), `min_order_amount`, `max_order_amount` (sats), `maintenance_mode`. Status `up` if info `created_at` within 48 h or it has a live order; `maintenance_mode === "true"` gives `down`.
- **Mostro trades:** `latestReplaceable`, `s === "success"`, mainnet, UTC day of `created_at`, last `days` days ending today (`nowSec`), zero-filled; BTC from `amt` (> 0) else `fa[0] / index`, else skipped from BTC but counted in trades.
- **HodlHodl:** skip `asset_layer !== "BTC"` and `working_now === false`. `premium`: if `price_source === "exchange_rate"` and unit `%`, `sign === "-" ? -dev : +dev`; else computed from `price` and index. `methods` from `payment_methods[].name` or `payment_method_instructions[].payment_method_name`. `layer` `onchain`. `link` `https://hodlhodl.com/offers/<id>`. Never read `title`, `description`, `trader`.

- [ ] **Step 1: Write failing tests** against the fixtures (`nowSec = 1791386100`):
  - `robosatsOffers(robosats-orders, index(temple-limits))`: length 131 minus non-mainnet/expired (compute expected in the test with a direct filter over the fixture tags), every `host` in the 7 keys, at least one range offer with `fiatMin < fiatMax`, a USD offer's `satsMax` within 1% of `fiatMax / (usdIndex*(1+premium/100)) * 1e8`; no field contains `"Robot"` (`JSON.stringify(offers).includes("Robot") === false`).
  - `robosatsHost("temple", temple-info, 10, true)`: `makerFeePct` 0.025, `takerFeePct` 0.175, `bondPct` 3, `volume24hBtc` 0.25827531, `lifetimeBtc` 192.30429803, `version` "0.8.7", `status` "up"; `robosatsHost("bazaar", null, 22, false)` gives `unknown`.
  - `robosatsHistory(temple-historical)`: 1,076 entries, last `{ date: "2026-10-06", btc: 0.189, trades: 28 }`.
  - `robosatsIndex(temple-limits)`: 80 codes, `prices.USD === 82905.69`.
  - `mostroOffers`: no regtest, none expired, every pubkey present in info; count equals 103 (the live mainnet count measured when recording; if the filter rules produce a different number, print the excluded reasons in the test failure and reconcile with the spec rules, do not just update the number).
  - `mostroHosts`: an instance with live orders is `up`; one with only stale info (> 48 h) and no orders is `down`.
  - `mostroDaily(trades, index, now)`: 7 entries, dates ascending ending 2026-10-07, trade counts sum equals the success events in that window.
  - `hodlhodlOffers([offers-0, offers-500])`: no `ARK`, both method shapes produce labels, a GBP `exchange_rate` offer with sign `-` deviation `5` has premium -5, `JSON.stringify(result)` contains neither `trader-` nor `description`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS, type-check, lint.
- [ ] **Step 5: Commit** `feat(p2p): normalizers for RoboSats, Mostro and HodlHodl`

---

### Task 6: Markets and hash state

**Files:**
- Create: `src/lib/observatory/p2p/market.ts`, `src/lib/observatory/p2p/__tests__/market.test.ts`
- Modify: `src/lib/observatory/obs-hash.ts`, `src/lib/observatory/__tests__/obs-hash.test.ts`

**Interfaces:**

```ts
// market.ts
export const STABLE_TO_FIAT: Record<string, string>; // { USDT: "USD", USDC: "USD" }
export function indexFor(code: string, index: IndexPrices | null): number | null;
export function computePremium(price: number, idx: number): number; // (price/idx - 1) * 100
export function buildMarkets(offers: P2pOffer[], index: IndexPrices | null): Map<string, Market>;
export function marketOrder(markets: Map<string, Market>): string[];       // currencies by offer count desc, then code
export function defaultCurrency(locale: string, markets: Map<string, Market>): string | null; // en USD, es EUR, pt BRL, de EUR, fr EUR, pl PLN; fallback to marketOrder[0] when < 3 offers
export function filterVenues(offers: P2pOffer[], venues: readonly Venue[]): P2pOffer[];
export interface BoardRow { currency: string; cells: Record<Venue, { median: number | null; offers: number }> }
export function premiumBoard(markets: Map<string, Market>, side: "buy" | "sell", top?: number): BoardRow[]; // side = visitor intent; default top 12
export interface Headline { liquiditySats: number; venuesOnline: number; hostsOnline: number; hostsTotal: number; cheapestBuy: { currency: string; premium: number } | null }
export function headline(markets: Map<string, Market>, hosts: VenueHost[], currency: string | null): Headline;
export function depthClip(points: DepthPoint[], lo?: number, hi?: number): { points: DepthPoint[]; below: number; above: number }; // percentiles 2/98
```

Rules:
- Visitor intent `buy` lists maker `sell` offers (sorted premium asc). Intent `sell` lists maker `buy` offers (premium desc).
- `Market.depth.sell` (maker sells): cumulative `satsMax` as premium increases; `depth.buy`: cumulative as premium decreases. Offers with `premium === null` or `satsMax === null` are in `offers` but not in depth.
- Currencies with no index (for example `BTC` swaps, `XMR`) still form a `Market` with `index: null`; `premiumBoard` and the wall skip them; `marketOrder` keeps them last.
- Median over offers with a premium, per side; null when none.

`obs-hash.ts`: `ObsState` gains `cur: string | null` (`/^[A-Z]{3,5}$/` after uppercasing, else null), `side: "buy" | "sell"` (default `buy`), `venue: Venue[]` (subset of the 3, comma-separated, unknown dropped, default all three, serialized only when not all). `SELECTION_KEYS` in `useObsState.ts` gains `cur`, `side`, `venue`. `OBSERVATORY_TABS` gains `"p2p"` (Task 8 renders it; adding it here is fine since the shell falls back to WabiSabi for unknown render branches until then: check `ObservatoryPage` renders `WabiSabiTab` for anything not `whirlpool`, which keeps tests green).

- [ ] **Step 1: Write failing tests** (build offers from the Task 5 normalizers over all fixtures, index from `temple-limits`):
  - USD market exists, `bestBuy` is the sell offer with the lowest premium, `medianPremium.buy` equals a median computed in the test;
  - `depth.sell` is monotonic non-decreasing in both premium and cumSats, and its last `cumSats` equals the sum of `satsMax` of priced sell offers;
  - a USDT offer is priced with the USD index;
  - `BTC` currency market has `index: null` and is absent from `premiumBoard`;
  - `defaultCurrency("pl", markets)` falls back when PLN has < 3 offers; `defaultCurrency("pt", ...)` gives `BRL` (30+ BRL offers in fixtures);
  - `headline` counts hosts `up` over total;
  - `depthClip` with a synthetic outlier at +500% puts it in `above`;
  - hash: round-trip `#p2p&cur=EUR&side=sell&venue=mostro,hodlhodl`; `#p2p&cur=zz1&side=nope&venue=evil` gives `cur null, side buy, venue all`; existing WabiSabi hashes unchanged (existing tests stay green).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS, type-check, lint.
- [ ] **Step 5: Commit** `feat(p2p): market builder, premium board, headline and URL state`

---

### Task 7: Data layer

**Files:**
- Create: `src/hooks/usePolled.ts`, `src/lib/observatory/p2p/p2p-client.ts`, `src/hooks/useP2p.ts`, tests `src/lib/observatory/p2p/__tests__/p2p-client.test.ts`, `src/hooks/__tests__/useP2p.test.ts`
- Modify: `src/hooks/useWabisator.ts` (move `usePolled` and `Polled` out, `export { usePolled, type Polled } from "./usePolled"`)

**Interfaces:**

```ts
// p2p-client.ts
export const P2P_REFRESH_MS: { orders: 30_000; info: 60_000; limits: 300_000; history: 3_600_000; mostroInfo: 300_000; trades: 600_000; hodlhodl: 60_000 };
type Opts = { isUmbrel: boolean; signal?: AbortSignal };
export function getNostr(serviceId: "robosats-nostr" | "mostro-nostr", path: "/orders" | "/info" | "/trades", o: Opts): Promise<NostrSnapshot>;
export function getRoboInfo(serviceId: string, o: Opts): Promise<RoboInfo>;
export function getRoboLimits(o: Opts): Promise<IndexPrices>;           // temple, then lake, then (Umbrel) the rest, first success; source = service name
export function getRoboHistorical(serviceId: string, o: Opts): Promise<RoboHistorical>;
export function getHodlhodl(o: Opts): Promise<HodlPage[]>;               // offsets 0,100,... 2 at a time, stop at a short page, max 10 pages
export function reachableRobosats(isUmbrel: boolean): string[];          // service ids via isReachable
// useP2p.ts
export type SourceId = "robosats" | "mostro" | "hodlhodl" | "index";
export interface SourceStatus { id: SourceId; state: "ok" | "partial" | "stale" | "down" | "loading"; updatedAt: number | null; detail: string[] } // detail: relay URLs timed out, coordinators down, "n events failed verification"
export interface P2pData { offers: P2pOffer[]; hosts: VenueHost[]; index: IndexPrices | null; markets: Map<string, Market>; sources: SourceStatus[]; nowSec: number }
export function useP2p(): P2pData;
export function useP2pHistory(enabled: boolean): { robosats: DailyVolume[]; perCoordinator: Record<string, DailyVolume[]>; mostro: DailyVolume[]; loading: boolean };
```

Behaviour:
- Every fetcher goes through `serviceGet` and `withObservatoryCache(key, fn, ttl)` with TTL = refresh interval; cache keys include `isUmbrel`.
- Normalizers get `nowSec = snapshot.fetchedAt` (spec ruling 20); the composition then drops offers whose `expiresAt` is before the visitor's clock.
- `useP2p` runs `usePolled` per source (one per reachable RoboSats coordinator for info is fine: at most 7), verifies Nostr snapshots with `verifySnapshot` before normalizing, and memoizes the composition.
- Source state: `ok` when the latest fetch succeeded with every relay `eose` and every reachable coordinator up; `partial` when some relays timed out, some coordinators failed or > 10% of events were rejected; `stale` when the last success is older than 3 intervals and the latest fetch failed; `down` with no data; `loading` before the first result.
- Offers from a `stale` source stay until their own `expiresAt`; a `down` source contributes nothing.
- `useP2pHistory(enabled)` starts fetching only once `enabled` turns true (set by an IntersectionObserver in the Volume section).

- [ ] **Step 1: Write failing tests.**
  - client: mock `fetch`; assert URLs `https://coinjoin-stats.copexit.workers.dev/svc/mostro-nostr/orders`, `/tor-proxy/svc/robosats-bazaar/api/info/` on Umbrel; `reachableRobosats(false)` equals `["robosats-temple", "robosats-lake"]` and no request for `robosats-bazaar` is ever made with `isUmbrel: false` (Review Focus 6); HodlHodl paging stops after the 70-offer page (serve `offers-0` for offsets 0-400 and `offers-500` for 500) and requests offsets `0..500`; limits fall back to lake when temple 502s.
  - hook (jsdom, fake timers, `fetch` mocked from the fixtures, `verifyEvent` mocked to `true` for redacted fixtures via `vi.mock("@/lib/observatory/p2p/nostr-verify", ...)` partial mock keeping the rest): produces offers from all three venues, `markets.get("EUR")` exists, sources `ok`; with the HodlHodl route failing, its source is `down` and others `ok`; with one relay `timeout` in the snapshot, Mostro is `partial` and its detail lists the relay URL.
  - `useWabisator` tests still pass unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS, type-check, lint.
- [ ] **Step 5: Commit** `feat(p2p): data layer with verified Nostr snapshots and source health`

---

### Task 8: Tab shell, headline, source strip, market selector

**Files:**
- Create: `src/components/observatory/p2p/P2pTab.tsx`, `P2pHeadline.tsx`, `SourceStrip.tsx`, `MarketSelector.tsx`, `P2pFooter.tsx`, `src/lib/observatory/p2p/venue-palette.ts`, tests in `src/components/observatory/p2p/__tests__/`
- Modify: `src/components/observatory/ObservatoryPage.tsx` (third tab "P2P markets", tablist label "Observatory section", grid `grid-cols-3`, render `P2pTab` for `p2p`), `src/app/globals.css` (`--p2p-robosats`, `--p2p-mostro`, `--p2p-hodlhodl`, and `--p2p-coord-<key>` for the 7 coordinators, each with a `-fg` variant, both themes, same method and comment style as the `--coord-*` block), `src/app/observatory/layout.tsx` (description and keywords), locales

**Interfaces:**
- `venue-palette.ts`: `venueColorVar(v: Venue)`, `hostColorVar(venue, key)` (RoboSats coordinators get their token, Mostro instances use the venue colour).
- `P2pTab()`: reads `useObsState` and `useP2p`; layout order and anchors: `#p2p-headline`, sub-nav (Markets, Premiums, Venues, Volume), `#p2p-markets` (selector, then a slot for Task 9), `#p2p-premiums` (slot for Task 10), `#p2p-venues` (slot for Task 10), `#p2p-volume` (slot for Task 11), footer. Slots are children/props so later tasks plug in without re-layout.
- `P2pHeadline({ headline, currency, side, loading })`: eyebrow "KYC-free bitcoin, live", the sentence ("{{btc}} BTC on offer without KYC across {{venues}} venues, cheapest to buy in {{currency}} at {{premium}} over the index." with variants when no premium or no data), and 4 tiles.
- `SourceStrip({ sources })`: chips with dot, label, "updated Ns ago" (one shared 1 s ticker), tooltip/`aria-describedby` with `detail`.
- `MarketSelector({ markets, cur, side, venues, onChange })`: top 8 chips, a "More" combobox (native `<select>` styled with tokens is acceptable and preferred over a custom listbox), Buy/Sell segmented control ("I want to buy BTC" / "I want to sell BTC"), venue toggle chips.
- `P2pFooter`: sources with links (`rel="noopener noreferrer"`), privacy line and index source (spec section 8 text).

Requirements:
- `cur` empty in the URL: use `defaultCurrency(i18n.language, markets)` for rendering without writing it to the URL; a user choice writes it.
- Loading: skeletons shaped like the sentence and the tiles. All down and no data: the calm error panel pattern from `ObservatoryErrorState` with retry calling each source's `refresh`.
- Numbers: `Intl.NumberFormat(i18n.language)`; BTC with 2 decimals at 1+ BTC, 4 below; premium signed with one decimal and a `%`.
- The headline sentence must fit 390 px in de and pl (test renders it with the de and pl strings at a 390 px container and asserts no element wider than its container is NOT possible in jsdom; instead keep the sentence as inline text that wraps, no `whitespace-nowrap`, and the e2e in Task 12 checks scroll width per locale).

- [ ] **Step 1: Write failing tests:**
  - shell: `#p2p` renders `P2pTab`, the three tabs exist with roles, arrow keys cycle through 3, `#whirlpool` still renders Whirlpool;
  - headline with fixture-built data shows non-zero BTC and the EUR premium when `cur=EUR`; with no data shows dashes, not `0`;
  - source strip: `partial` chip exposes the timed-out relay URL in its description;
  - market selector: clicking BRL calls `onChange({ cur: "BRL" })`; side toggle; venue toggle never allows an empty set (last active venue cannot be turned off);
  - `useObsState` writes `cur` with `replace` history.
- [ ] **Step 2:** FAIL. **Step 3:** implement (frontend-design approach: this headline is the "shocking" moment; big tabular number, restrained colour, generous space). **Step 4:** PASS, gates, locale parity.
- [ ] **Step 5: Commit** `feat(observatory): P2P tab with live KYC-free headline, sources and market selector`

---

### Task 9: The wall and the offer list

**Files:**
- Create: `src/components/observatory/p2p/DepthWall.tsx`, `OfferList.tsx`, `OfferRow.tsx`, tests
- Modify: `P2pTab.tsx` (mount in `#p2p-markets`), locales

**Interfaces:**
- `DepthWall({ market, side, venues, view })`: `view === "table"` renders an accessible table of steps (premium, cumulative BTC, venue) instead of the SVG.
- `OfferList({ market, side, venues, hosts })`.

Requirements (spec sections 3 and 4):
- **Wall:** visx (`@visx/shape` `AreaClosed`/`LinePath` with `curveStepAfter`, `@visx/scale`, `@visx/axis`; check what `TrendChart.tsx` imports and stay within installed packages). Both sides on one chart, index hairline at 0% labelled with the index price, each step segment coloured by venue token, "beyond" counts at the edges from `depthClip`. Focusable step markers (`tabIndex=0`, aria-label with premium and amount) show the offer card on focus/hover; on touch, tap opens a bottom sheet (reuse `useFocusTrap`). Draw-in with motion, none under reduced motion. Height 320 desktop, 240 mobile. Empty market: the "No KYC-free offers to buy in {{cur}} right now" state plus 3 nearest markets as chips.
- **List:** desktop table, mobile cards (below 640 px), columns per spec, 25 rows then "Show all {{count}}". Premium coloured relative to the market median (better than median uses the `good` token, worse uses `medium`, far worse `high`). Venue badge shows the coordinator or instance name. Links: RoboSats onion with a "Tor" label, HodlHodl https, Mostro none with "Open in any Mostro client". Age as relative time (`Intl.RelativeTimeFormat`).
- No identity: rows render only `P2pOffer` fields (which have none).

- [ ] **Step 1: Write failing tests:**
  - wall renders one focusable marker per priced offer in the clipped range; focusing one shows its premium; table view renders rows; reduced motion (`matchMedia` mocked) skips animation props;
  - list sorts by best premium for each side; "Show all" expands; Mostro rows have no link; RoboSats link text includes "Tor";
  - **identity test (Review Focus 2):** render the EUR and USD markets' lists from all fixtures and assert `document.body.textContent` contains none of: `"Robot"`, `"trader-"`, `"@user"`, `"[number]"`, `"[link]"`, and none of the robot nicks present in `signed-sample.json` `name` tags (read them in the test).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS, gates.
- [ ] **Step 5: Commit** `feat(observatory): P2P depth wall and offer list`

---

### Task 10: Premium board and venues

**Files:**
- Create: `src/components/observatory/p2p/PremiumBoard.tsx`, `VenueSection.tsx`, `RobosatsCoordinatorCard.tsx`, `MostroInstances.tsx`, `HodlhodlCard.tsx`, tests
- Modify: `P2pTab.tsx` (mount in `#p2p-premiums` and `#p2p-venues`), locales

**Interfaces:**
- `PremiumBoard({ rows, side, onSelect(cur, venue) })` from `premiumBoard(...)`.
- `VenueSection({ hosts, offers, isUmbrel, highlight })` where `highlight` is the hash `coordinator`.

Requirements (spec sections 5 and 6):
- **Board:** a real `<table>` with row and column headers; cells show median premium and offer count; shading via severity tokens (`good` for the best cell in a row, a neutral ramp otherwise; never hex); empty cells show a muted dash. Mobile: a venue segmented control showing one column at a time; the table scrolls inside its own container.
- **RoboSats cards:** grid 1/2/3 columns; facts per spec; `unknown` status renders "Tor only" with the muted "Full stats on a self-hosted node" line; notice in amber when present; a highlighted card (from `coordinator=`) scrolls into view and gets a ring.
- **Mostro:** compact table; inactive (status `down`) behind "Show {{count}} inactive"; names from hosts; pubkey short form in a `title` attribute only.
- **HodlHodl:** one card (offers, currencies count, median author fee, escrow line).
- Each venue has its one-line explainer from the spec.

- [ ] **Step 1: Write failing tests:** board cell click calls `onSelect("EUR", "mostro")`; best cell per row is marked; RoboSats bazaar card on public shows "Tor only"; temple card shows fee "0.025%" and lifetime "192.30 BTC"; Mostro inactive toggle; `coordinator=temple` highlights the temple card.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS, gates.
- [ ] **Step 5: Commit** `feat(observatory): P2P premium board and venue health`

---

### Task 11: Volume history

**Files:**
- Create: `src/components/observatory/p2p/P2pVolume.tsx`, `src/lib/observatory/p2p/volume.ts` (+ test), component test
- Modify: `P2pTab.tsx` (mount in `#p2p-volume`, with the IntersectionObserver that enables `useP2pHistory`), locales

**Interfaces:**

```ts
// volume.ts
export function sumDaily(series: DailyVolume[][]): DailyVolume[];                        // by date, union of dates
export function rangeSlice(d: DailyVolume[], range: HistoryRange, today: string): DailyVolume[]; // reuse HistoryRange from coordinator-page.ts
export function athOf(d: DailyVolume[]): { date: string; volume: number } | null;
export function shares(per: Record<string, DailyVolume[]>, range: HistoryRange, today: string): { key: string; btc: number; pct: number }[]; // desc
```

Requirements (spec section 7): reuse `VolumeHistoryChart` (map `DailyVolume` to `HistoryPoint { date, volume: btc, coinjoins: trades }`; if its labels say "CoinJoins", add an optional `countLabel` prop rather than forking the component). Range switch 30 d, 90 d, 1 y, All. Coverage label: "{{n}} of 7 coordinators" with the Tor note on the public site. Mostro: 7 bars (count and BTC), "seen on public relays". HodlHodl line. Skeletons until enabled data arrives.

- [ ] **Step 1: Write failing tests:** `sumDaily(temple, lake)` on 2026-10-06 equals 0.189 + 0.165 BTC and 28 + 28 trades; `rangeSlice` lengths; `athOf`; `shares` sum to 100 (within rounding); component shows the coverage label "2 of 7" when `isUmbrel` is false.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS, gates.
- [ ] **Step 5: Commit** `feat(observatory): P2P volume history`

---

### Task 12: Integration, e2e, docs

**Files:**
- Modify: `e2e/helpers/mock-api.ts` (`mockObservatoryApi` also answers the P2P routes from `fixtures/p2p/`: `/svc/robosats-nostr/orders`, `/svc/mostro-nostr/{orders,info,trades}`, `/svc/robosats-{temple,lake}/api/{info,limits,historical}/`, `/svc/hodlhodl/api/v1/offers` by `pagination[offset]` (0-400 serve `offers-0`, 500 serves `offers-500`); export a `failP2pRoute(page, pathname)` helper that makes one route 502), `docs/development-guide.md` (Observatory: P2P section, registry capabilities), `docs/README.md` (spec index), `src/components/faq` or privacy copy that lists where data goes (add "P2P market data (RoboSats, Mostro relays, HodlHodl) on the Observatory, through the relay or Tor"; find the existing list with `grep -rn "Chainalysis screening" src public/locales/en`)
- Create: `e2e/observatory-p2p.spec.ts`

Note: the browser verifies Nostr signatures in every build, and the redacted fixtures do not verify. So the e2e mock serves `nostr/signed-sample.json` (12 valid events: 6 RoboSats, 6 Mostro) as both order snapshots and `nostr/mostro-info.json` (unredacted, valid) for Mostro info; `mostro-trades` is served as is (failed events are dropped and the Mostro chip shows "partial", which case 1 tolerates). Read the sample's currencies in the spec file to pick the assertions. There is no verification bypass flag.

e2e cases:
1. `/observatory#p2p` shows the headline with a non-zero BTC figure, the source strip with 4 chips, the wall and at least one offer row.
2. Selecting a currency chip updates the URL (`cur=`) and the list.
3. `#p2p&side=sell` lists maker buy offers (assert the first row's side label).
4. Venue filter: turning off HodlHodl removes its rows.
5. Reload keeps the state from the hash.
6. With `failP2pRoute(page, "/svc/hodlhodl/api/v1/offers")`, the HodlHodl chip says down and RoboSats/Mostro rows still render.
7. Every request the page makes is to the app origin or `coinjoin-stats.copexit.workers.dev` (collect `page.on("request")`).
8. At 390 px, `scrollWidth <= innerWidth` on the P2P tab in `en`, `de` and `pl`.
9. `#wabisabi` and `#whirlpool` still render (existing specs also run).

- [ ] Steps: write the e2e, wire, gates (type-check, lint, full `pnpm test`, `pnpm build`, the full e2e serially). Commit `feat(observatory): integrate P2P markets, e2e and docs`.

---

### Task 13 (controller): live check, visual QA, rollout

1. **Live proxy check:** `wrangler dev --config workers/coinjoin-stats/wrangler.toml` and curl each P2P `/svc` route (orders snapshots must show `eose` from at least one relay; hodlhodl offset 0 returns 100 offers; temple info 200; bazaar 404 `ONION_ONLY`). Confirm Cloudflare outbound WebSockets work under `wrangler dev --remote` as well as local `workerd`. If HodlHodl blocks Cloudflare egress (403/429), record it and decide: keep it Umbrel-only (registry flag) or drop it from the public site.
2. **Sidecar:** `docker build umbrel/tor-proxy`, run against a local Tor, curl `/svc/robosats-bazaar/api/info/` (onion over http) and `/svc/robosats-nostr/orders` (onion relays).
3. **Visual QA:** serve the build on :3000 against the deployed worker (after the owner approves the worker deploy), screenshots of every section at 390 and 1440, dark and light, iterate to the quality bar.
4. **Ship (owner approval required for each push/deploy):** worker deploy, PR, CI, merge, release 0.41.0 (both images), community store, memory note.

---

## Self-review against the spec

- Goals 1 to 7: headline (Task 8), liquidity across 3 venues (Tasks 5, 7), premiums vs index and wall and board (Tasks 6, 9, 10), health (Task 10), history (Task 11), per-market depth (Tasks 6, 9), URLs/i18n/a11y/mobile (Tasks 6, 8 to 12).
- Registry entries, worker and sidecar changes: Tasks 1 to 3, including the onion `http` follow-up and `ws` through Tor.
- Caching/polling table: Task 7 (`P2P_REFRESH_MS`, TTLs in the registry from Task 1 match it: orders 30, info 60, limits 300, historical 3600, Mostro info 300, trades 600, HodlHodl 60).
- Failure states: Task 7 (source states), Task 8 (all-down panel), Task 9 (empty market), Task 6 (no index), Task 12 (e2e partial outage).
- URL state: Task 6 (parse/serialize), Task 8 (writes), Task 10 (`coordinator=` highlight), Task 9 (`view=table`).
- Privacy rulings: Global Constraints, Review Focus 2 and 6, Tasks 4, 5, 9, 12.
- Out of scope respected: no Bisq/Peach code, no ticks, no `/api/book/`.
- Known risk carried to Task 13: HodlHodl's Cloudflare-fronted API may rate-limit or block the worker's egress; `temple`'s clearnet relay timed out during research (lake answered), so the snapshot tolerates one dead relay by design.
