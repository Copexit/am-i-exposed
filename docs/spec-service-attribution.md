# Service layer and CoinJoin service attribution

Status: design approved in conversation (2026-10-06). Covers roadmap sub-projects 1 (service layer) and 2 (scan attribution). Target release: 0.39.0.

---

## Why

A tester pointed at wabisator.com, a live monitor of WabiSabi CoinJoin coordinators. It rebuilds every round from the coordinators' public data and can answer, for any transaction, whether it was a CoinJoin, which coordinator ran it, how many of its inputs were fresh or remixed, and which CoinJoins its coins came out of or went into. A scan on am-i.exposed today only knows that a transaction *looks like* a WabiSabi CoinJoin.

The owner's priorities (2026-10-06): privacy value in scans first, an excellent Observatory second, and a foundation that later also covers P2P exchanges (RoboSats, Mostro, Bisq, HodlHodl). This spec is the foundation plus the scan value. The Observatory work (sub-projects 3 and 4) gets its own specs and reuses everything here.

## Goals

1. One registry of external services, read by the app, the Cloudflare worker and the Umbrel tor-proxy sidecar, so a new service is a data change plus a client, not new plumbing.
2. Every request to a service goes through a hop am-i.exposed controls: the `coinjoin-stats` worker on the public site, the tor-proxy sidecar on Umbrel/StartOS. A visitor's IP never reaches a third-party service.
3. Requests that carry a user's txid ("lookups") are impossible without an explicit, per-scan consent, are never cached anywhere, and are never retried automatically.
4. Tx, address and wallet results gain an opt-in **CoinJoin services** check that reports, from Wabisator: recorded CoinJoin rounds (coordinator, round, anonsets, fresh vs remixed inputs, rounds it was remixed from and into), coins that came out of recorded CoinJoins, coins that went into them, and post-mix coins spent together.

## Non-goals

- The Observatory redesign (sub-project 3) and P2P services (sub-project 4). Only the existing Observatory clients move onto the new route, with no visible change.
- Any score or grade change from service data. Results are informational, so a scan's grade never depends on whether someone pressed the button.
- Running our own indexer. Wabisator is the data backend (owner's decision); the registry keeps that swappable.
- Bisq fee-address matching (the fee receiver list rotates and is reused; the existing Bisq deposit detection stays). CLI and MCP (they stay offline).
- Moving the Chainalysis check onto the service layer (no benefit).

---

## Decisions (owner, 2026-10-06)

| Topic | Decision |
|---|---|
| Lookups with a user's txid | Opt-in per scan, never automatic, also on Umbrel |
| Routing | Always through our worker (public) or Tor sidecar (self-hosted); no direct browser calls, even where CORS allows |
| Data backend | Wabisator (LiquiSabi-compatible JSON-RPC at `https://wabisator.com/api.php`) |
| Scoring | Informational only in this release |
| Caps | 1 txid for a tx, up to 10 for an address, up to 50 for a wallet, per consent |

Wabisator and LiquiSabi are not open source under any license (LiquiSabi's repositories have no license file). Nothing is copied from them; the API is used as a documented public service and the logic below is our own.

---

## 1. Service registry

`src/lib/services/registry.json` is the single source of truth. A committed copy lives at `umbrel/tor-proxy/services.json` (the sidecar's Docker build context is `umbrel/tor-proxy/`); a unit test fails if the two differ.

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

Rules encoded by the registry:

- **Class.** `aggregate` requests carry no user data and may be edge-cached for `ttl` seconds. `lookup` requests carry user data: never cached (worker sends `Cache-Control: no-store` and skips `caches.default`), never logged, never retried by the proxy.
- **Param validators.** A lookup lists every allowed param with a validator name. Unknown params are rejected. Validators: `txid` (`^[0-9a-f]{64}$`, lowercased first), `page` (integer clamped 1..10000). Aggregate RPC params are forwarded as an object of at most 2 KB of JSON.
- **Bodies.** The proxy rebuilds JSON-RPC bodies itself (`{ jsonrpc: "2.0", id: 1, method, params }`); the client body is never forwarded verbatim. Request body cap 64 KB, response cap 4 MiB.
- **Kinds** used now: `data-provider`. Reserved for later sub-projects: `wabisabi-coordinator`, `p2p-exchange`, `nostr-relay`. Optional per-service `onion` base for onion-only services (used by sub-project 4; the sidecar prefers it when present).

`src/lib/services/registry.ts` exports the typed registry plus `findRoute(serviceId, path, http, rpcMethod?)`, used by the app (to know a method's class) and mirrored in plain JS by the worker and sidecar.

## 2. One proxied route

Path shape on both hops: `/svc/<serviceId><route path>`, for example `/svc/wabisator/api.php` or `/svc/whirlpoolstats/txs?page=3`.

- **Public site:** `https://coinjoin-stats.copexit.workers.dev/svc/...`. The worker imports the registry JSON (bundled by wrangler from `../../src/lib/services/registry.json`). The legacy routes (`/whirlpool/*`, `/liquisabi/api`) stay for one release so open tabs and installed PWAs on 0.38.x keep working, then are removed.
- **Self-hosted:** `/tor-proxy/svc/...` (nginx already forwards `/tor-proxy/` to the sidecar). The sidecar loads `services.json` and fetches via its Tor SOCKS agent. Its legacy `/observatory/*` routes are removed in the same release, since app and sidecar images always ship together. `/chainalysis/address/*` is untouched.
- **Errors:** both hops answer `{ "error": { "code", "message" } }` with 400 (`DISALLOWED`, `BAD_PARAMS`), 404 (unknown service or route), 413 (`TOO_LARGE`) or 502 (`UPSTREAM_DOWN`, `UPSTREAM_HTTP`), as the current routes do.

Client side, `src/lib/services/`:

- `route.ts`: `serviceUrl(serviceId, path, { isUmbrel })` returns the worker or sidecar URL (replaces `src/lib/observatory/endpoints.ts`).
- `client.ts`:
  - `serviceGet(serviceId, path, { isUmbrel, signal, query })` and `serviceRpc(serviceId, path, method, params, { isUmbrel, signal, consent })`, built on the existing `getJson` / `postJsonRpc` transport (timeouts unchanged: 10 s, 45 s through Tor).
  - `serviceRpc` looks the method up in the registry. For a `lookup` it requires a `LookupConsent` and throws `ConsentRequiredError` without one.
  - `LookupConsent` is an opaque object created only by `grantLookupConsent({ serviceId, txids })` and valid only for the txids it names. A call with any other txid throws.
- The Observatory clients (`liquisabi-client.ts`, `whirlpool-client.ts`) switch to `serviceRpc` / `serviceGet`. Their IndexedDB cache (`withObservatoryCache`) stays for aggregate data only.

## 3. CoinJoin services check (scan attribution)

### 3.1 Data

From Wabisator, two lookup methods:

- `search { query: txid }` returns:
  - `Matches[]`, entries with `Kind: "coinjoin"` and `TxId`, `RoundId`, `Coordinator`, `Name`, `Time`, `Btc`, `Inputs`;
  - `Transaction`, which has `Known`, `Inputs`, `Outputs`, and `OutOf[]` / `Into[]`. Each `OutOf` / `Into` entry has `CoinjoinTxId`, `Coordinator`, `Name`, `Time`, `CoinjoinBtc`, `Vin` or `Vout`, `PrevVout`, `Value`, `Fresh`.
- `coinjoin { txId }` returns:
  - `Coinjoin`, with round metadata: `RoundId`, `IsBlame`, `FinalMiningFeeRate`, `InputCount`, `OutputCount`, `AverageStandardInputsAnonSet`, `AverageStandardOutputsAnonSet`, `FreshInputsEstimateBtc`, `CoordinatorName`, times;
  - `RemixedFrom[]` and `RemixedInto[]`;
  - `Transaction.Inputs[]` (`Origin` is `fresh`, `remix` or `other`, plus `From`) and `Transaction.Outputs[]` (`Standard`).

`src/lib/services/wabisabi-attribution.ts` (pure, fixture-tested) turns these into:

```ts
type TxAttribution =
  | { kind: "coinjoin"; txid; coordinator: { key; name }; roundId; time; isBlame; feeRate;
      inputs: number; outputs: number; anonsetIn: number; anonsetOut: number;
      freshBtc: number; inputOrigins: { fresh: number; remix: number; other: number };
      remixFrom: { coordinator: string; name: string; btc: number; coins: number }[];   // grouped by coordinator
      remixedFromRounds: RoundRef[]; remixedIntoRounds: RoundRef[];
      nonStandardOutputs: number }
  | { kind: "linked"; txid; outOf: CoinRef[]; into: CoinRef[] }   // not a CoinJoin, coins came out of / went into recorded rounds
  | { kind: "none"; txid }                                         // Wabisator has no record of CoinJoin activity
  | { kind: "error"; txid; message };
type RoundRef = { txid; coordinator; name; time; btc };
type CoinRef = { roundTxid; coordinator; name; time; index: number; sats: number };
```

`lookupTx(txid, consent, ctx)` runs `search`; if a `coinjoin` match exists for that txid it also runs `coinjoin` and returns `kind: "coinjoin"`; otherwise it maps `OutOf` / `Into` (`linked` when either is non-empty, else `none`).

`summarize(results: TxAttribution[])` builds the address and wallet view:
- `checked` and `failed` counts;
- `rounds`: recorded CoinJoins among the txids;
- `outOfSats` and `intoSats`, each grouped by coordinator;
- `postMixMerges`: txids that are not CoinJoins and spend 2+ coins from recorded CoinJoins, with the number of rounds involved. This is the post-mix mistake, now confirmed with coordinator names. The local `post-mix-consolidation` heuristic keeps its scoring role.

### 3.2 Which txids are checked

- **Tx result:** that txid.
- **Address result:** the address's 10 most recent transactions (`addressTxs`, newest first). The card states that more exist when it is capped.
- **Wallet result:** up to 50 of the wallet's transactions, newest first, from the scanned address infos (deduplicated).
- **Local and pending inputs:** PSBTs and raw local transactions (Before You Send) get no card: they have no txid on chain, and sending their inputs' txids would leak a not-yet-broadcast spend.
- **Pacing:** requests run 2 at a time with a 250 ms gap. Progress shows `n / N`. One failed txid does not stop the rest. It is counted and shown, with a "Retry failed" button.

### 3.3 Interface

A **CoinJoin services** card (`src/components/services/ServiceCheck.tsx`):
- tx results: a section after the findings, before the context section;
- address results: same place;
- wallet results: below the findings.

States:

1. **Consent (idle).** Title "CoinJoin services". Body: "See whether this transaction was part of a WabiSabi CoinJoin, which coordinator ran it, and where its coins came from or went." The privacy line depends on the backend:
   - Public site: "Sends {{count}} transaction ID(s) to Wabisator (wabisator.com) through the am-i.exposed relay. Your IP address is not shared with Wabisator. Nothing is stored."
   - Self-hosted: "... through Tor from your node."

   Button: "Check CoinJoin services". Wabisator's coverage note: "Covers the WabiSabi coordinators Wabisator monitors (Kruw, OpenCoordinator, GingerWallet and others)."
2. **Running.** Progress "Checked n of N".
3. **Result (tx).**
   - `coinjoin`: coordinator badge (fixed colour per known coordinator, neutral for others), round time, blame round tag, fee rate, inputs and outputs, average anonset in/out, a bar of fresh / remixed / other inputs with "remixed from" grouped by coordinator, the number of non-standard outputs ("change outputs are the linkable ones"), and lists of rounds remixed from and into. Every round txid is a link that scans it.
   - `linked`: "Coins from recorded CoinJoins: 3 inputs, from Kruw rounds …" and "Coins that went into recorded CoinJoins: 2 outputs, Kruw round …", each with amount, time and a scan link.
   - `none`: "No recorded WabiSabi CoinJoin activity for this transaction." Plus the coverage note: absence does not prove anything about Whirlpool, JoinMarket or unmonitored coordinators.
   - `error`: "Wabisator could not be reached. Local results are unaffected." Plus a Retry button.
4. **Result (address / wallet).** Summary tiles:
   - CoinJoin rounds among the transactions;
   - sats out of CoinJoins and sats into CoinJoins, each split by coordinator;
   - post-mix merges, in an amber call-out when > 0: "{{count}} transaction(s) spent coins from different CoinJoin outputs together, which links them again."

   Below the tiles, the list of linked transactions, each expandable to its tx view.

Results live only in component state: not in the scan cache, history, URL, share card or exports. A new scan resets the card to the consent state.

All copy is in all 6 locales, in the project voice (no "we", no em dashes, passive or tool-named).

## 4. Docs and copy

- FAQ / privacy text that lists where data goes adds: "Optional checks run only when clicked: Chainalysis screening and the CoinJoin services check (Wabisator), each through a relay or Tor."
- `docs/development-guide.md`: a "Services" section (registry, route, classes, consent).
- `workers/coinjoin-stats/README.md`: the `/svc` route.

## 5. Testing

- **Unit:**
  - registry validation (every route well-formed, lookups have validators);
  - registry parity with the sidecar copy;
  - `serviceUrl`;
  - `serviceRpc` consent enforcement (missing consent, wrong txid);
  - attribution mapping and `summarize`, against recorded real responses saved as fixtures (a Kruw round, a post-mix consolidation with 45 `OutOf` coins, an unknown txid, a non-coinjoin with `Into`).
- **Worker:**
  - `/svc` routing, allowlist, param validation;
  - aggregate edge-cache vs lookup `no-store`;
  - legacy routes still answering;
  - body and response caps.
- **Sidecar:** the same cases through `createHandler` with a fake `fetchViaAgent`.
- **Component:** ServiceCheck in each state.
- **e2e:** with the `/svc/wabisator/api.php` route mocked in Playwright:
  - a tx scan, then consent, then the coordinator card;
  - an address scan, then the summary;
  - a wallet scan, then the post-mix merge call-out;
  - no request reaches `/svc/.../api.php` with a lookup method before the click (asserted).
  - The existing Observatory e2e keeps passing on the new route.

## 6. Rollout

1. Deploy the worker with `/svc` added and the legacy routes kept; verify live (aggregate cached, lookup no-store, disallowed method 400).
2. Merge and release 0.39.0 (GitHub Pages, both Docker images, community Umbrel store).
3. A later release removes the worker's legacy routes.
