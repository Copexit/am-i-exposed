# Observatory v2: P2P markets

Status: decisions delegated by the owner (2026-10-07, same mandate as sub-project 3: "extremely clean, pretty, shocking, perfect UI/UX"). Roadmap sub-project 4. Target release: 0.41.0. Builds on the service layer (`docs/spec-service-attribution.md`) and the Observatory shell (`docs/spec-observatory-wabisabi.md`).

---

## Why

Buying bitcoin without KYC is the first privacy decision most people make, and the hardest one to research. The order books live behind Tor, in Nostr events or inside apps; nobody shows, in one place, how much KYC-free liquidity exists right now, what it costs over the market price, and which venues are alive. The Observatory already answers "is CoinJoin alive and how big is it". The P2P tab answers "can bitcoin be bought or sold without KYC today, where, and at what premium".

## Goals

1. **A page someone lands on, gets value from in five seconds, bookmarks and leaves.** The first screen says how much bitcoin is on offer without KYC right now, in the visitor's currency, and the cheapest premium to buy or sell.
2. **KYC-free liquidity:** live offers from RoboSats (whole federation), Mostro (all instances seen on public relays) and HodlHodl, normalized into one schema.
3. **Premiums vs index:** every offer's premium against one common index price per currency, a per-currency premium board across venues, and a depth chart ("the wall") by premium.
4. **Venue and coordinator health:** each RoboSats coordinator and Mostro instance: up or down, version, fees, bond, limits, 24 h volume, offers in the book.
5. **Volume history:** RoboSats daily volume per coordinator (years of history), Mostro completed trades as seen on relays (recent days).
6. **Per-market depth:** a currency selector; each currency is a market with its depth, best offers and payment methods.
7. Bookmarkable URLs, 6 languages, light and dark, accessible, fast on a phone, no visitor request ever reaching a third party.

## Non-goals

- Trading, taking offers, or any request that carries visitor data. Every request is `aggregate` class; there is no `lookup` in this sub-project.
- Showing trader identities. Robot nicknames, HodlHodl logins, Nostr names, ratings per person and free-text contact details are never rendered.
- Bisq (see "Providers"): no usable public source today.
- Peach: escrow suspended, skipped.
- Other NIP-69 publishers seen on relays (Bitblik, telegram bots, Sparrow test events, Bitvyber): not curated venues; ignored. The registry makes adding one a data change later.
- Price alerts, notifications, saved searches.
- Scoring: nothing here touches scan results.

---

## Providers (live research, 2026-10-07)

All fixtures referenced below were captured on this date and live in `src/lib/observatory/__tests__/fixtures/p2p/`.

### RoboSats (federation of 7 coordinators)

Coordinator list from `frontend/static/federation.json` in the RoboSats repo (v0.8.7-alpha). It is copied into the registry, not fetched at runtime (it changes a few times a year; a registry PR follows it).

| Key | Name | Clearnet | Onion `/api/info/` via Tor | Nostr pubkey (orders) |
|---|---|---|---|---|
| temple | Temple of Sats | `https://unsafe.templeofsats.org` | 200 | `74001620...7191` |
| lake | TheBigLake | `https://unsafe.thebiglake.org` | 200 | `f2d4855d...a10c` |
| bazaar | LibreBazaar | none | 200 | `95521a33...6b9b` |
| alice | Alice | none | 502 (down) | `40d33962...0866` |
| eleuteria | Eleuteria | none | SOCKS failure (down) | `0f243ba6...c219` |
| freeport | FreePort | none | 200 (24 s) | `e489cdb0...4afd` |
| ammanaya | Ammanaya | none | 200 | `91820b0f...5548` |

REST (trailing slash is mandatory, without it the coordinator answers 301 to HTML):
- `GET /api/info/`: `num_public_buy_orders`, `num_public_sell_orders`, `book_liquidity` (sats), `active_robots_today`, `last_day_nonkyc_btc_premium` (%), `last_day_volume` (BTC), `lifetime_volume` (BTC), `version{major,minor,patch}`, `maker_fee`, `taker_fee` (fractions), `bond_size` (%), `min_order_size`, `max_order_size` (sats), `notice_severity`, `notice_message`, `swap_enabled`. CORS `*`.
- `GET /api/limits/`: `{ "<currency id>": { code, price, min_amount, max_amount } }` for 80 currencies. `price` is the coordinator's index (median of blockchain.info and yadio). This is the index source for every venue (see Rulings).
- `GET /api/historical/`: `{ "YYYY-MM-DD 00:00:00+00:00": { volume (BTC), num_contracts } }`, one entry per day since the coordinator started (~1,000 days, ~65 KB).
- `GET /api/book/`: the book, with `maker_nick` and `maker_hash_id`. **Not used**: the Nostr order feed covers all 7 coordinators even from clearnet, and carries no more than needed.
- `GET /api/ticks/` needs a date range and fails past 5,000 ticks. Not used in v1.

Nostr: every coordinator publishes its public orders as NIP-69 kind 38383 events signed by its `nostrHexPubkey`, and the federation relays sync each other. `wss://unsafe.thebiglake.org/relay/` returned 131 live orders from 5 coordinators in 3.7 s (temple's clearnet relay timed out). Onion relays (`ws://<onion>/relay/`) work through Tor (lake: 133 events in 3.6 s).

Order event tags: `d` (order uuid), `k` (`buy`|`sell`, maker side), `f` (currency code), `s` (`pending`), `amt` (sats, `0` when fiat-denominated), `fa` (fiat amount, or `min, max` for a range), `pm` (payment methods, free text split on spaces), `premium` (%), `source` (onion order URL), `expiration`, `y` (`robosats`, coordinator alias), `network`, `layer` (`lightning`), `bond` (%), `name` (robot nick, never shown). `content` is optional free text (never shown).

### Mostro (Nostr-native, many independent instances)

No REST. Everything is Nostr:
- **Orders:** kind 38383, `y` = `mostro` plus the instance name (for example `MostroColomBia`), signed by the instance pubkey. Tags as above plus `published_at`, `expires_at`, `expiration` (relay purge time, not order expiry).
- **Instance info:** kind 38385, `y` = `mostro`, `z` = `info`: `mostro_version`, `fee`, `min_order_amount`, `max_order_amount` (sats), `fiat_currencies_accepted`, `expiration_hours`, `maintenance_mode`, `bond_enabled`, `lnd_node_alias`. 97 instance pubkeys published info; 29 republished within 24 h.
- **Completed trades:** orders whose latest state is `s=success` (the replaceable event is overwritten). `relay.mostro.network` caps a REQ at 300 events, `nos.lol` and `relay.damus.io` at 500; the union of three relays gave 314 trades over 30 days, but only the last ~9 days are dense. So Mostro history is "completed trades seen on public relays, last 7 days".

Relays used: `wss://relay.mostro.network`, `wss://nos.lol`, `wss://relay.damus.io` (all answered EOSE in under 2.2 s; `relay.primal.net` worked but adds little; `nostr.satstralia.com` refused). The union had 103 live mainnet orders from 12 instances, all signed by pubkeys that also published a 38385 info event. Regtest/testnet events exist (`network=regtest`) and are dropped.

### HodlHodl (custodial-free multisig escrow, on-chain)

- `GET https://hodlhodl.com/api/v1/offers?pagination[limit]=100&pagination[offset]=N`. No auth for public offers. The limit is capped at 100 server-side (asking 1000 returns 100). 570 offers across 6 pages. No CORS headers (irrelevant: the browser never calls it). Works through Tor (4 s).
- Offer fields used: `id`, `side` (maker side), `currency_code` (also `USDT`, `USDC`), `asset_layer` (`BTC` on-chain; a few `ARK`), `price` (fiat per BTC), `price_source` (`exchange_rate` or `fixed_value`), `exchange_price_deviation` and `exchange_price_sign` (the declared premium when `exchange_price_unit` is `%`), `min_amount`/`max_amount` (fiat), `min_amount_sats`/`max_amount_sats`, `fee.author_fee_rate`, `payment_methods[].name` or, on some offers, `payment_method_instructions[].payment_method_name` (two shapes, both handled), `working_now`, `country_code`.
- Fields never read: `title`, `description` (they contain phone numbers and handles) and `trader.*`. The recorded fixtures have them scrubbed.
- HodlHodl also publishes 126 offers as NIP-69 events (`y=hodlhodl`) on damus; the REST API is more complete (570), so REST wins.
- No public volume or trade history.

### Bisq: unusable

- `bisq.markets` (the Markets API) fails DNS: SERVFAIL with a DNSSEC "DNSKEY missing" error at its delegation, from Google and Cloudflare resolvers.
- The markets onion (`bisqmktse2c...onion/api/markets`) answers with an empty reply through Tor.
- mempool.space removed its Bisq backend (`/bisq/api/*` serves the SPA HTML; `bisq.mempool.space` returns "endpoint does not exist").
- Bisq 1 offers live only on its own P2P network (a full Bisq node is needed), and Bisq 2 has no public market API. No Bisq events on Nostr.

Ruling: no Bisq tab or source in this release. The venue list and registry make it a data-plus-client addition when a public source returns.

### Peach: skipped (escrow suspended).

---

## Architecture

```
browser (am-i.exposed)                  public site                         self-hosted (Umbrel/StartOS)
  serviceGet("robosats-temple", ...)  -> CF worker /svc/<id><path>       -> sidecar /tor-proxy/svc/<id><path>
  serviceGet("robosats-nostr", "/orders") -> worker opens WebSockets      -> sidecar opens ws through Tor SOCKS
                                          to the listed relays, REQ,         (onion relays when listed)
                                          collects until EOSE/timeout,
                                          returns one JSON snapshot
```

Everything stays on the existing `/svc` route. The registry gains two route capabilities, both used only by `aggregate` routes:
1. **GET query plumbing:** a new `offset` validator and a `fixedQuery` map, for HodlHodl pagination.
2. **Nostr snapshot routes:** a route with a `nostr` block. The proxy (worker or sidecar) runs a fixed filter against the service's relays and returns a snapshot. The client cannot send a filter; filters come only from the registry.

Plus: services without a clearnet `base` (onion-only RoboSats coordinators), and the sidecar learning plain `http://` for onion hosts.

### Registry entries (all `aggregate`)

```jsonc
// RoboSats coordinators: 7 entries, same routes. Clearnet base only where it exists.
{
  "id": "robosats-temple", "name": "Temple of Sats (RoboSats)", "kind": "p2p-exchange",
  "homepage": "https://learn.robosats.org",
  "base": "https://unsafe.templeofsats.org",
  "onion": "http://ngdk7ocdzmz5kzsysa3om6du7ycj2evxp2f2olfkyq37htx3gllwp2yd.onion",
  "routes": [
    { "path": "/api/info/", "http": "GET", "class": "aggregate", "ttl": 60, "timeoutMs": 20000 },
    { "path": "/api/limits/", "http": "GET", "class": "aggregate", "ttl": 300, "timeoutMs": 20000 },
    { "path": "/api/historical/", "http": "GET", "class": "aggregate", "ttl": 3600, "timeoutMs": 30000 }
  ]
},
{ "id": "robosats-bazaar", "name": "LibreBazaar (RoboSats)", "kind": "p2p-exchange",
  "homepage": "https://learn.robosats.org",
  "onion": "http://librebazovfmmkyi2jekraxsuso3mh622avuuzqpejixdl5dhuhb4tid.onion",
  "routes": [ /* same three */ ] },
// ... lake (clearnet + onion), alice, eleuteria, freeport, ammanaya (onion only)

{
  "id": "robosats-nostr", "name": "RoboSats federation relays", "kind": "nostr-relay",
  "homepage": "https://learn.robosats.org",
  "relays": ["wss://unsafe.thebiglake.org/relay/", "wss://unsafe.templeofsats.org/relay/"],
  "onionRelays": ["ws://4t4jxmivv6uqej6xzx2jx3fxh75gtt65v3szjoqmc4ugdlhipzdat6yd.onion/relay/",
                  "ws://ngdk7ocdzmz5kzsysa3om6du7ycj2evxp2f2olfkyq37htx3gllwp2yd.onion/relay/",
                  "ws://librebazovfmmkyi2jekraxsuso3mh622avuuzqpejixdl5dhuhb4tid.onion/relay/"],
  "routes": [
    { "path": "/orders", "http": "GET", "class": "aggregate", "ttl": 30, "timeoutMs": 8000,
      "nostr": { "filter": { "kinds": [38383], "authors": ["<7 coordinator pubkeys>"], "#s": ["pending"], "limit": 1000 } } }
  ]
},
{
  "id": "mostro-nostr", "name": "Mostro relays", "kind": "nostr-relay",
  "homepage": "https://mostro.network",
  "relays": ["wss://relay.mostro.network", "wss://nos.lol", "wss://relay.damus.io"],
  "routes": [
    { "path": "/orders", "http": "GET", "class": "aggregate", "ttl": 30, "timeoutMs": 8000,
      "nostr": { "filter": { "kinds": [38383], "#y": ["mostro"], "#s": ["pending"], "limit": 1000 } } },
    { "path": "/info", "http": "GET", "class": "aggregate", "ttl": 300, "timeoutMs": 8000,
      "nostr": { "filter": { "kinds": [38385], "#y": ["mostro"], "limit": 500 } } },
    { "path": "/trades", "http": "GET", "class": "aggregate", "ttl": 600, "timeoutMs": 8000,
      "nostr": { "filter": { "kinds": [38383], "#y": ["mostro"], "#s": ["success"], "limit": 2000 }, "sinceSeconds": 604800 } }
  ]
},
{
  "id": "hodlhodl", "name": "HodlHodl", "kind": "p2p-exchange",
  "homepage": "https://hodlhodl.com", "base": "https://hodlhodl.com",
  "routes": [
    { "path": "/api/v1/offers", "http": "GET", "class": "aggregate", "ttl": 60, "timeoutMs": 20000,
      "query": { "pagination[offset]": "offset" }, "fixedQuery": { "pagination[limit]": "100" } }
  ]
}
```

Registry type changes (`src/lib/services/registry.ts`, mirrored by both proxies):
- `base?: string` (at least one of `base`, `onion`, `relays` is required; a registry test enforces it). `relays?: string[]`, `onionRelays?: string[]`.
- `ParamValidator` adds `offset`: integer, clamped to 0..5000, floored to a multiple of 100, default 0.
- `ServiceRoute` adds `fixedQuery?: Record<string, string>` (appended after validated params, cannot be overridden by the client) and `nostr?: { filter: NostrFilter; sinceSeconds?: number }`.
- A `nostr` route must be `GET` and `aggregate`; a registry test enforces it, and both proxies refuse anything else as `MISCONFIGURED`.

### Nostr snapshot (worker and sidecar, same contract)

`GET /svc/<id><path>` for a route with `nostr`:
1. Build the filter from the registry. With `sinceSeconds`, set `since = floor(now / ttl) * ttl - sinceSeconds` (stable within a TTL, so the edge cache key and the upstream request agree).
2. Open every relay in parallel (worker: `fetch(httpsUrl, { headers: { Upgrade: "websocket" } })` then `resp.webSocket.accept()`; sidecar: the `ws` package with the Tor `SocksProxyAgent`, `onionRelays` when listed, else `relays`). Send `["REQ", "s", filter]`.
3. Collect `EVENT` messages until each relay sends `EOSE` or `CLOSED`, errors, or the route `timeoutMs` (8 s) passes. Send `CLOSE` and close the socket.
4. Drop malformed events (missing `id`, `pubkey`, `sig`, `kind`, `tags`, `created_at`), events of a kind not in the filter, and duplicates by `id`. Cap at 3,000 events and 4 MiB.
5. Answer `200` with:
   ```json
   { "events": [ /* raw NIP-01 events, newest first */ ],
     "relays": [ { "url": "wss://relay.mostro.network", "status": "eose" | "timeout" | "error", "count": 291 } ],
     "fetchedAt": 1791386100 }
   ```
   `502 UPSTREAM_DOWN` only when every relay errored. A snapshot where some relays timed out is still 200 (the client shows coverage).
6. Worker: edge-cached for `ttl` like any aggregate route. Sidecar: no cache, as today.

The proxies do not verify signatures (CPU on the worker, and the client must not trust the hop anyway). The client verifies (see Data model).

### Sidecar changes

- `fetchViaAgent` picks `http` or `https` by URL protocol (port 80 or 443 by default) so `http://<onion>` bases work. Same SOCKS agent (`socks5h`, DNS inside Tor).
- `svc.js` upstream is `service.onion ?? service.base` (unchanged), and a GET to a service with neither answers 404 `NOT_FOUND`.
- New `nostr.js`: `nostrSnapshot({ relays, filter, timeoutMs, openSocket })`, with `openSocket(url)` injected (`ws` + agent in `server.js`; a fake in tests). `ws` is added to `umbrel/tor-proxy/package.json` (npm, it has its own lockfile) and the Dockerfile copies `nostr.js`.
- `services.json` stays a byte copy of the registry (existing parity test).

### Worker changes

- `svc.js`: the `offset` validator and `fixedQuery`; a service without `base` answers 404 `ONION_ONLY` (the client never asks: it reads the registry, see below); `nostr` routes dispatch to `nostr.js`.
- New `workers/coinjoin-stats/nostr.js` (same contract, WebSocket via `fetch` upgrade).
- README: the P2P routes.

---

## Data model

`src/lib/observatory/p2p/` holds pure, fixture-tested modules. Nothing in them touches the network.

```ts
export type Venue = "robosats" | "mostro" | "hodlhodl";
export type Side = "buy" | "sell";            // the MAKER's side: "sell" offers are where a visitor buys BTC
export type Layer = "lightning" | "onchain" | "other";

export interface P2pOffer {
  id: string;                 // `${venue}:${host}:${d or id}`
  venue: Venue;
  host: string;               // robosats coordinator key, mostro instance pubkey, "hodlhodl"
  side: Side;
  currency: string;           // uppercase ISO 4217, plus USDT/USDC; "BTC" (RoboSats swaps) and unknown codes kept but unpriced
  fiatMin: number | null;     // equal to fiatMax for fixed amounts
  fiatMax: number | null;
  satsMax: number | null;     // from the offer when given, else fiatMax / price * 1e8
  premium: number | null;     // % vs index; declared by the venue when it has one, else computed from price
  price: number | null;       // fiat per BTC
  methods: string[];          // sanitized labels, max 4, max 32 chars each
  layer: Layer;
  bondPct: number | null;     // RoboSats fidelity bond
  createdAt: number;          // unix s
  expiresAt: number | null;
  link: string | null;        // https or http .onion order page from a known host; null for Mostro
}

export interface VenueHost {
  venue: Venue; key: string; name: string;
  status: "up" | "down" | "unknown";   // unknown = onion-only seen from the public site
  inBook: number;                      // live offers from this host
  version: string | null;
  makerFeePct: number | null; takerFeePct: number | null; bondPct: number | null;
  minSats: number | null; maxSats: number | null;
  volume24hBtc: number | null; lifetimeBtc: number | null; robotsToday: number | null;
  premium24h: number | null;           // RoboSats last_day_nonkyc_btc_premium
  notice: string | null;               // RoboSats notice_message when severity is not "none"; sanitized, max 140 chars
  lastSeen: number | null;             // Mostro: latest 38385 created_at
}

export interface DailyVolume { date: string; btc: number; trades: number }   // "YYYY-MM-DD" UTC

export interface IndexPrices { source: string; prices: Record<string, number>; at: number }   // code -> fiat per BTC

export interface Market {
  currency: string; index: number | null;
  offers: P2pOffer[];                   // sorted: sells by premium asc, buys by premium desc
  bestBuy: P2pOffer | null;             // cheapest sell offer (where to buy)
  bestSell: P2pOffer | null;            // highest buy offer (where to sell)
  medianPremium: { buy: number | null; sell: number | null };
  liquiditySats: { buy: number; sell: number };
  depth: { buy: DepthPoint[]; sell: DepthPoint[] };   // cumulative sats by premium step
  byVenue: Record<Venue, { offers: number; liquiditySats: number; medianPremium: number | null }>;
}
export interface DepthPoint { premium: number; cumSats: number }
```

Modules:
- `nostr-verify.ts`: `verifyEvent(e)` (NIP-01 id = sha256 of `[0, pubkey, created_at, kind, tags, content]`, BIP-340 Schnorr with `@noble/curves`, already a dependency) and `latestReplaceable(events)` (keep the newest per `pubkey:kind:d`). Events failing verification are dropped and counted.
- `normalize-robosats.ts`: Nostr order events to offers (pubkey must be one of the 7 registry coordinators); `info` to `VenueHost`; `historical` to `DailyVolume[]`; `limits` to `IndexPrices`.
- `normalize-mostro.ts`: order events (mainnet only, `expires_at > fetchedAt`, author must have published a 38385 info event in the snapshot) to offers; info events to hosts (`status` up when info is under 48 h old or it has live offers, else down); `success` events to `DailyVolume[]` (BTC from `amt`, else `fa / index`).
- `normalize-hodlhodl.ts`: offers to `P2pOffer` (never reads title, description or trader), and one aggregate `VenueHost`.
- `sanitize.ts`: `sanitizeMethods(raw: string[])` strips URLs, `@handles`, runs of 7+ digits and emoji, collapses whitespace, dedupes case-insensitively, truncates. Applied to every venue's methods and to RoboSats notices.
- `market.ts`: `indexFor(code, index)` (USDT/USDC use USD), `computePremium`, `buildMarkets(offers, index)`, `defaultCurrency(locale, markets)`, `premiumBoard(markets, venues)`, `headline(markets)`.
- `p2p-hash.ts` (extends the Observatory hash, see URL state).

Premium semantics, identical for every venue: `premium = (price / index - 1) * 100`. Positive means above the index: a buyer pays more, a seller gets more. RoboSats and Mostro declare it (`premium` tag); HodlHodl declares it for `exchange_rate` offers (`sign` and `deviation`, against its own exchange-rate provider). The declared value is shown since that is what the trader set and sees; fixed-price offers get the computed value against the common index.

---

## Page

The Observatory tab list becomes `wabisabi`, `whirlpool`, `p2p`. The tablist label changes from "CoinJoin protocol" to "Observatory section". The tab label is "P2P markets". The page metadata (`src/app/observatory/layout.tsx`) adds P2P to the description and keywords ("robosats", "mostro", "hodlhodl", "kyc-free bitcoin", "p2p bitcoin premium").

### Section order

1. **Headline** (above the fold at 390x844 and 1440x900).
   - Eyebrow "KYC-free bitcoin, live".
   - One sentence in large type: "**4.21 BTC** on offer without KYC across **3 venues**, cheapest to buy in **EUR** at **+1.8%** over the index." Numbers are tabular, the currency is the selected one.
   - Four glass tiles: Offers (sells / buys), Liquidity (BTC to buy, BTC to sell), Median premium to buy, Venues and coordinators online (`n / m`).
   - A source strip: one chip per source (RoboSats federation, Mostro relays, HodlHodl, Index) with a calm status dot (ok, partial, stale, down) and "updated Ns ago". Partial means some relays timed out or some coordinators are down; the chip's tooltip lists which.
2. **Market selector.** Chips for the 8 currencies with the most offers, plus a "More" combobox (searchable, all currencies with at least one offer). A Buy / Sell segmented control ("I want to buy BTC" / "I want to sell BTC"). A venue filter (All, RoboSats, Mostro, HodlHodl) as toggle chips. All three in the URL.
3. **The wall (depth chart).** SVG with visx (already installed). X axis: premium %, clipped to the 2nd to 98th percentile with a "beyond" bucket at each edge. Y axis: cumulative BTC. Sell side (where to buy) steps up to the right from the cheapest offer; buy side steps up to the left. The index sits at 0% as a hairline labelled with its price in the currency. Each step is coloured by its venue. Hover or focus shows the offer (venue, amount range, premium, methods, layer). Reduced motion: no draw-in animation.
4. **Offer list.** The current market and side, sorted by premium (best first).
   - Desktop: a table with Venue (coloured badge plus coordinator or instance name), Amount (fiat range and approximate BTC), Premium (signed, coloured relative to the market median), Methods (chips), Layer (Lightning or on-chain icon plus label), Bond or escrow, Age, and "Open" (external link when `link` is set, `rel="noopener noreferrer"`, an onion link labelled "Tor").
   - Mobile: stacked cards with the same facts.
   - 25 rows, then "Show all N".
   - A note under Mostro rows: "Open in any Mostro client" (no link: Mostro has no web order page).
5. **Premium board.** A matrix: rows are the top 12 currencies, columns RoboSats, Mostro, HodlHodl, cells the median premium to buy (or to sell, following the side switch) with the offer count. Cells shade from good (low premium for buyers) to costly with the existing severity palette tokens, never hex. Clicking a cell selects that market and venue. Mobile: one column per venue as a swipeable segment, the matrix stays inside its own scroll container.
6. **Venues and coordinators.**
   - RoboSats: one card per coordinator, coloured edge (RoboSats federation colours from `federation.json`, mapped to new `--p2p-*` tokens in both themes), name, status dot, version, maker and taker fee, bond, min and max order, 24 h volume, lifetime volume, robots today, offers in the book, 24 h non-KYC premium. Onion-only coordinators on the public site show status "Tor only" and the facts the Nostr feed gives (offers in the book), with "Full stats on a self-hosted node" in muted text.
   - Mostro: a compact table of instances (name from the order `y` tag, else a short pubkey), status, version, fee, limits, currencies, offers, last seen. Instances with no info for 48 h and no offers sit behind "Show N inactive".
   - HodlHodl: one card (offers, currencies, typical fee, on-chain multisig escrow).
   - Each venue has a one-line explainer (escrow model: Lightning hold invoices and bonds, Mostro hold invoices over Nostr, HodlHodl 2-of-3 on-chain multisig).
7. **Volume history.**
   - RoboSats daily federation volume (sum of reachable coordinators), ranges 30 d, 90 d, 1 y, All, with an all-time-high marker, reusing the WabiSabi `VolumeHistoryChart`; under it, per-coordinator share bars for the selected range. Public site: the clearnet coordinators only, labelled "2 of 7 coordinators (the rest are reachable through Tor on a self-hosted node)". Self-hosted: all reachable coordinators.
   - Mostro completed trades as bars for the last 7 days (count and BTC), labelled "seen on public relays".
   - HodlHodl: "HodlHodl publishes no volume data."
8. **Attribution and privacy footer.** Sources with links, "Data is fetched through the am-i.exposed relay (or Tor on a self-hosted node). No request from this page carries anything about the visitor." The index source ("index: RoboSats coordinator price, median of blockchain.info and yadio.io").

Sticky sub-navigation (as the WabiSabi tab): Markets, Premiums, Venues, Volume.

### Visual quality bar (hard requirements, reviewed)

Same bar as the WabiSabi spec: design tokens only (new `--p2p-robosats`, `--p2p-mostro`, `--p2p-hodlhodl` and per-coordinator tokens in `globals.css` for both themes), tabular figures, eased transitions, skeletons shaped like content, a calm error panel that keeps the last data, no horizontal page scroll at 390 px, and screenshot review at 390 and 1440 in both themes before merge. The headline sentence is the "shocking" moment: it must read well at 390 px in every locale (long German and Polish strings tested).

---

## Data flow, caching, polling

`src/lib/observatory/p2p/p2p-client.ts`, one function per source through `serviceGet` and `withObservatoryCache` (TTL = refresh interval). Polling uses the existing `usePolled` (moved from `useWabisator.ts` to `src/hooks/usePolled.ts`, re-exported) so it runs only while the tab is visible and keeps the last good data.

| Source | Route | Refresh | Notes |
|---|---|---|---|
| RoboSats orders | `robosats-nostr /orders` | 30 s | all 7 coordinators |
| RoboSats info | `robosats-<key> /api/info/` | 60 s | each reachable coordinator in parallel |
| Index | `robosats-temple /api/limits/`, fallback `robosats-lake` | 300 s | self-hosted tries all reachable in registry order |
| RoboSats history | `robosats-<key> /api/historical/` | 1 h | fetched when the Volume section first scrolls into view |
| Mostro orders | `mostro-nostr /orders` | 30 s | |
| Mostro info | `mostro-nostr /info` | 300 s | |
| Mostro trades | `mostro-nostr /trades` | 600 s | lazy, with the Volume section |
| HodlHodl | `hodlhodl /api/v1/offers` | 60 s | pages 0, 100, ... until a page has fewer than 100 offers, max 10 pages, 2 at a time |

"Reachable": on the public site a RoboSats service is reachable only with a `base`; self-hosted, every service with a `base` or `onion`. The client decides from the registry and never requests an onion-only service from the worker.

`useP2p()` composes the sources into `{ offers, hosts, index, markets, sources: SourceStatus[] }` with `useMemo`; markets rebuild only when an input changes.

## Failure states

- **One source down:** its chip turns "down", its offers stay on screen while they are not expired (last good data), marked stale after 3 refresh intervals, then removed. Other venues render normally.
- **Some relays down:** the snapshot still answers; the chip is "partial" with the relay list in its tooltip.
- **Index down:** premiums declared by venues still show; computed premiums and BTC amounts for fiat-only offers show "n/a"; the wall falls back to declared premiums.
- **All sources down, no cached data:** a calm error panel with retry; headline tiles show dashes, not zeros.
- **Coordinator notices** (RoboSats `notice_severity` warning or above): a small amber line on its card.
- **Empty market** (currency with zero offers on the chosen side): "No KYC-free offers to buy in PLN right now" plus the three nearest markets by offer count.
- **Invalid signatures:** dropped; if more than 10% of a snapshot fails, the chip shows "partial" with "some events failed verification".

## URL state

Extends the Observatory hash (`src/lib/observatory/obs-hash.ts`, tolerant parse, defaults omitted):
- `#p2p` (tab)
- `&cur=EUR` (3 to 5 uppercase letters; unknown codes fall back to the default market once data loads)
- `&side=sell` (default `buy`, meaning the visitor wants to buy, so sell offers are listed)
- `&venue=robosats,mostro` (subset of venues; default all)
- `&pm=sepa-instant` (payment-method filter, a canonical id from `src/lib/observatory/p2p/payment-methods.ts` or `other`; unknown ids are ignored). Raw labels from every venue (RoboSats space-joined `pm` tag, Mostro free text, HodlHodl names with a type) map to catalog ids; a label matching nothing maps to `other`, so no offer is dropped. An offer matches when any of its methods matches. The filter narrows the wall, the offer list and the nearest-market suggestions, and a status note states the filtered count, BTC and median premium; currency chip counts and the headline stay unfiltered.
- `&amt=250&amtu=fiat` (amount filter, see below). `amt` is a plain decimal (`^\d{1,13}(\.\d{1,8})?$`, no signs, exponents or grouping) between 0.01 and 1e12 for `amtu=fiat`, or between 1 sat (0.00000001) and 21e6 for `amtu=btc`; anything else is dropped. `amtu` is written with every `amt`; a missing or unknown unit reads as `fiat`.
- `&view=table` (reused: replaces the wall with a table of depth steps)
- `&coordinator=<key>` (reused: scrolls to and highlights that coordinator or instance card)

`cur`, `side`, `venue`, `pm`, `amt` and `amtu` changes replace the history entry (they are selections), like `coordinator` and `tx` today.

### Amount filter

An amount input sits beside the payment-method picker, in the selected market currency or in BTC (a unit toggle). It composes with side, currency, venue and payment method, and narrows the wall, the offer list, the picker's method counts and the status note. The note reads "Offers that accept €250 by SEPA: N offers, X BTC. Median premium +x%." A second line names the best listed offer for the amount ("Cheapest for €250 by SEPA: <venue>, +x%", or "Best price to sell ..." on the sell side). Unlisted Mostro instances never appear in that line. Currency chip counts and the headline stay unfiltered.

Venue encodings, all normalized to `fiatMin`/`fiatMax` in the offer currency:
- RoboSats: `fa` with two values is a range and one value is a fixed amount; `amt` is 0.
- Mostro: `fa` is a range or one value; one value with `amt > 0` is a fixed fiat amount for fixed sats.
- HodlHodl: `min_amount`/`max_amount`, with min == max a fixed amount.
- No `fa` tag, or empty HodlHodl limits, gives null limits.

Matching (`amountMatch` and `filterAmount` in `market.ts`), only in the selected currency:
- Range: `fiatMin <= amount <= fiatMax`, inclusive. A one-sided limit is open on the missing side.
- Fixed (`fiatMin === fiatMax`): matches within ±5% of the offer amount (`FIXED_TOLERANCE`).
- No stated limits: kept, and the amount cell reads "No limits stated".
- A BTC amount is priced at the offer's own `price` when it has one, else at the market index; it is an estimate. An offer with neither is kept.

Input: `inputmode=decimal`, accessible name "Amount in EUR". Typing writes the hash after a 400 ms pause. Both "1.234,56" and "1,234.56" parse; a lone separator followed by exactly 3 digits is a grouping mark unless it is the locale's decimal mark. Pasted currency symbols or codes at either end ("€250", "250 EUR") are stripped. Out-of-range values get their own message with the bounds. The converted value shows under the input ("≈ 0.0034 BTC"), and a tooltip states the rules and the tolerance. Switching unit converts the value at the index. The BTC unit is `aria-disabled`, with its reason described, when the currency has no index. Changing currency clears a fiat amount, including one still pending in the debounce; a BTC amount is kept. Clearing from the input, Escape or the note's "Any amount" returns focus to the input.

## Mobile layout (390 px)

- Headline sentence, then the 4 tiles in a 2x2 grid, then the source strip as a horizontally scrollable row inside its container.
- Market chips scroll horizontally inside their container; Buy/Sell is full width.
- The wall is full width, 240 px tall, with tap-to-inspect (tap a step, a sheet shows the offer).
- Offers are cards; the premium board is a per-venue segment; venue cards stack.
- Every touch target is at least 40 px.

## i18n

All copy under `observatory.p2p.*` in `public/locales/{en,es,pt,de,fr,pl}/common.json`, with `defaultValue` on every `t()` call. Plurals with `_one/_other` (pl `_one/_few/_many/_other`). Numbers and currencies through `Intl.NumberFormat(i18n.language, ...)`. Spanish is Castilian tuteo. Venue names, coordinator names, currency codes and payment method labels are not translated. Default market by locale: en USD, es EUR, pt BRL, de EUR, fr EUR, pl PLN, falling back to the market with the most offers when the default has fewer than 3.

Voice: no "we/us/our", no em dashes, tool-named or passive ("Offers are read from public Nostr relays through the am-i.exposed relay").

## Testing

- **Unit, pure modules, against the fixtures:**
  - `verifyEvent` on `nostr/signed-sample.json` (12 valid), a tampered copy (fails), and `latestReplaceable` keeps the newest per `d`.
  - RoboSats: 131 Nostr orders map to offers, all pubkeys in the registry, range orders give `fiatMin < fiatMax`, `amt=0` orders get `satsMax` from the index; info, historical and limits mapping (BTC volume, 80 index prices).
  - Mostro: regtest dropped, expired dropped, authors without info dropped, instance status rule, 7-day trade bins.
  - HodlHodl: both payment-method shapes, declared premium from sign and deviation, fixed-price premium computed, `title`/`description`/`trader` never present in the output (assert on `JSON.stringify`).
  - `sanitizeMethods`: handles, links, phone numbers and emoji stripped (cases from the redacted fixture strings).
  - `buildMarkets`: best offers, medians, depth monotonic and summing to liquidity, USDT priced with USD, unpriced currencies excluded from the wall.
  - `defaultCurrency`, `premiumBoard`, `headline`.
  - Hash parse/serialize round-trip with the new keys; `#p2p&cur=zz1&side=nope&venue=evil` falls back without throwing.
- **Worker:** nostr route with a fake WebSocket (EOSE, timeout, one relay erroring, all relays erroring gives 502, dedupe, cap, kind filter, `since` rounding), offset validator and `fixedQuery`, onion-only 404, registry `MISCONFIGURED` guard.
- **Sidecar:** http vs https selection for onion URLs (fake `http`/`https` modules), nostr route with a fake `openSocket`, onion relays preferred.
- **Registry:** every service has `base`, `onion` or `relays`; nostr routes are GET and aggregate; sidecar copy parity.
- **Component:** headline, source strip states, market selector and URL sync, wall (steps rendered, keyboard focus shows the offer), offer list (no names rendered: assert fixture robot nicks and logins are absent from the DOM), premium board click, venue cards (Tor only state), volume history ranges, empty market, all-down panel.
- **e2e** with all P2P `/svc` routes mocked from the fixtures: `/observatory#p2p` renders the headline with non-zero liquidity; switching to `cur=BRL` updates the list; venue filter; `#p2p&side=sell` lists buy offers; deep link restores state after reload; no request leaves for a third-party host (assert every request URL is same-origin or the worker); no horizontal scroll at 390 px; WabiSabi and Whirlpool tabs still render.
- **Visual QA** (controller): screenshots of every section at 390 and 1440, dark and light, against the quality bar.

## Out of scope

Bisq (no public source), Peach (suspended), trade execution, per-trader data, price alerts, RoboSats ticks (premium history), HodlHodl Nostr feed, other NIP-69 publishers, LN/onchain swap offers (RoboSats `BTC` currency) beyond counting them, and moving the CF worker to Durable Objects for persistent relay connections.

## Rulings

1. **One P2P tab, not one tab per venue.** Visitors care about a market (currency and side), not a brand; venues are a filter. Tab id `p2p`.
2. **Bisq is out:** `bisq.markets` DNS is broken (DNSSEC SERVFAIL), its onion returns empty replies, mempool dropped its Bisq API, and Bisq offers are otherwise only on its own P2P network.
3. **RoboSats orders come from the federation Nostr relays, not `/api/book/`.** One clearnet relay carries all coordinators' orders, signed by coordinator keys, so the public site sees the whole federation without Tor. REST is used only for info, limits and history.
4. **Onion-only coordinators are first-class in the registry** (`onion` without `base`). The public site never asks the worker for them; self-hosted nodes reach them over Tor.
5. **Clearnet RoboSats hosts are named `unsafe.*` by their operators** because a visitor's browser would expose its IP to them. The relay hop removes that risk, which is why clearnet is acceptable here.
6. **Nostr is fetched by the proxy as a one-shot snapshot**, never by the browser (the service-layer rule). Filters are fixed in the registry; the client cannot send one.
7. **Signatures are verified in the browser** (`@noble/curves`, already installed), not in the proxy: the client should not trust any hop with integrity, and the worker stays cheap.
8. **Mostro instances are authenticated by having published a 38385 info event** in the same snapshot; anything else carrying `y=mostro` is ignored.
9. **Index = RoboSats coordinator `/api/limits/` price** (80 currencies including ARS, VES, CUP; mempool.space's price API has only 7). USDT and USDC use the USD index. Currencies without an index are listed but excluded from the wall and premium board.
10. **Declared premium wins over computed** when a venue declares one (it is what the trader set and sees); computed vs the common index otherwise.
11. **Side is always stored from the maker's perspective; the UI speaks from the visitor's** ("I want to buy BTC" lists sell offers). URL default `side=buy` (visitor intent).
12. **No trader identities, ever:** robot nicknames, logins, ratings, descriptions and Nostr `content` are never rendered. Payment methods are sanitized. Fixtures are redacted (HodlHodl title/description/login; handles, links and numbers in Nostr `pm`/`content`; robot names), with `signed-sample.json` the only untouched Nostr file for signature tests.
13. **HodlHodl from REST, not its Nostr feed** (570 offers vs 126). Pagination via a new `offset` validator and a registry `fixedQuery` (`pagination[limit]=100`).
14. **Mostro volume is "completed trades seen on public relays, last 7 days"**, labelled as such; relays cap REQ results (300 to 500), so longer history would be wrong.
15. **The sidecar learns `http://` for onion hosts** (protocol-selected `http`/`https` module through the same `socks5h` agent) and gets a `ws` dependency for Nostr through Tor.
16. **Mostro links are omitted** (no web order page); RoboSats `source` onion links are shown with a "Tor" label; HodlHodl links go to `https://hodlhodl.com/offers/<id>`.
17. **History and Mostro trades load lazily** when the Volume section approaches the viewport, to keep the first paint to orders, info and index.
18. **`usePolled` moves to its own file**; the WabiSabi hooks re-export it. No new polling code.
19. **No new frontend dependency.** visx, motion, noble and i18next cover everything; the only new package is `ws` in the sidecar.
20. **Expiry is judged against the snapshot's `fetchedAt`, not the visitor's clock**, so a wrong device clock or an edge-cached snapshot never empties or overfills the book; offers kept from a stale snapshot are dropped once the visitor's clock passes their `expiresAt`.
