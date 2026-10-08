# Development Reference

Architecture, data flow and conventions for the am-i-exposed web app. For the heuristic catalog and scoring rationale see [privacy-engine.md](./privacy-engine.md); for tests see [testing.md](./testing.md).

## Layering

- `src/lib/` is framework-free TypeScript (no React, no hooks, no components), except `src/lib/i18n/`. The CLI (`cli/`) compiles `src/lib/**` directly, so anything browser-only must be typed structurally or guarded (see `src/lib/browser.ts`, `src/lib/analysis/settings.ts`).
- `src/hooks/` wraps `src/lib` for React (state, effects, `useSyncExternalStore` stores).
- `src/components/` and `src/app/` render. Every interactive page/component is `"use client"` (static export, no RSC).

## Architecture

```
src/
├── app/                          # Next.js 16 routes (static export)
│   ├── page.tsx                  # Scanner: hash routing (#tx= / #addr= / #check= / #xpub=), one view per phase
│                                 # (Home, ScanScreen, Results, DestinationResult, ErrorScreen, Wallet*)
│   ├── layout.tsx                # Root layout: metadata, CSP <meta>, theme pre-paint, providers,
│                                 # SiteHeader / PrivacyNotice / SiteFooter
│   ├── globals.css               # Theme tokens (dark default, html[data-theme="light"] overrides)
│   ├── graph/                    # Standalone graph explorer
│   ├── observatory/              # Observatory (WabiSabi, Whirlpool, P2P markets)
│   ├── guide/ faq/ glossary/ about/ agents/ setup-guide/ welcome/   # Route + metadata layout; body in components/pages
│   └── */opengraph-image.tsx     # Static OG / Twitter images per route
├── components/
│   ├── chrome/                   # SiteHeader (nav, settings, mobile menu), SiteFooter, PrivacyNotice, nav.ts
│   ├── home/                     # Home: hero scan field over a live "glass mempool" (GlassField),
│   │                             # LensExplainer/LensStage, HowItWorks, SelfHostRow, recent scans + bookmarks
│   ├── scan/                     # ScanScreen: progress while a scan runs (ScanStage, ScanTxLive, ChecksStrip),
│   │                             # the reveal timeline (useRevealTimeline, RevealSkip)
│   ├── results/                  # Results: one progressive layout for tx and address results
│   │   ├── Results.tsx           # Verdict -> evidence -> findings -> explain rail -> context -> analyst tools
│   │   ├── VerdictBand.tsx, GradeDial.tsx, SectionNav.tsx, ResultActions.tsx
│   │   ├── EvidencePanel.tsx     # Transaction stage (tx) or address summary
│   │   ├── FindingsList.tsx, FindingItem.tsx   # Grouped findings, adversary/temporality filters
│   │   ├── ExplainRail.tsx, ScoreBreakdown.tsx, ExposureMatrix.tsx
│   │   ├── ContextSection.tsx    # CEX risk, exchange warning, common mistakes, analyst view, remediation, recovery
│   │   ├── AnalystWorkspace.tsx  # Graph explorer + DeepAnalysisTxid (Boltzmann heat map, taint) / DeepAnalysisAddress (cluster, timelines)
│   │   └── DeepAnalysisTxid.tsx, DeepAnalysisAddress.tsx, ResultsFooter.tsx, TipRow.tsx
│   ├── stage/                    # TxStage: inputs -> outputs value flow with engine tags (StageRow, StageDiagram,
│   │                             # VerticalFlowBand, analyst readings in analyst.ts)
│   ├── flows/                    # Non-tx results: DestinationResult (pre-send check), ErrorScreen, PsbtBanner,
│   │                             # WalletLoading / WalletResults / WalletWorkspace, FindingGroups, FlowUi
│   ├── pages/                    # Subpage bodies (About, Agents, Faq, Glossary, Graph, SetupGuide, Welcome),
│   │                             # PageFrame (subpage frame), ShareCardButton
│   ├── GraphExplorerPanel.tsx    # Graph explorer wrapper (API client, expansion hooks)
│   ├── FindingCard.tsx           # Finding body/tables, reused by findings, CoinSelector, TxBreakdownPanel
│   ├── ClusterPanel.tsx          # Opt-in address cluster analysis
│   ├── CexRiskPanel.tsx, cex/    # OFAC + Chainalysis screening
│   ├── ApiSettings.tsx, settings/  # Settings popover: network, analysis, cache, workspace, locale, theme, entity filter
│   ├── wallet/                   # Wallet building blocks (address table, tx list, coin selector, graph, xpub warning)
│   ├── guide/                    # Guide page sections (data in src/data/guide/)
│   ├── observatory/              # Observatory cards, charts, tables
│   ├── history/                  # Recent scans and bookmarks
│   ├── ui/                       # Small shared primitives (Tooltip, CopyButton, Spinner, Collapse, ...)
│   └── viz/                      # visx/SVG charts
│       ├── LinkabilityHeatmap.tsx                # Boltzmann link probability matrix
│       ├── TaintPathDiagram.tsx, taint/          # Taint flow diagram
│       ├── UtxoBubbleChart.tsx, PrivacyTimeline.tsx, FingerprintTimeline.tsx, EntityGraph.tsx
│       ├── GraphExplorer.tsx, graph/             # OXT-style graph (see docs/adr-oxt-graph.md)
│       └── shared/svgConstants.ts                # SVG colors, derived from src/lib/palette.ts
├── context/NetworkContext.tsx    # Active network (selected, or the self-hosted backend's) and its NETWORK_CONFIG
├── hooks/                        # React wrappers: useScanner (the scanner state machine behind page.tsx),
│                                 # useAnalysis, useWalletAnalysis, useHashRouting, useBoltzmann,
│                                 # useGraphExpansion, useAnalysisSettings, useTheme, usePalette, ...
├── data/                         # entities.json, ofac-addresses.json, guide/*, glossary, agents
└── lib/
    ├── types.ts                  # Finding (id: FindingId), ScoringResult, Grade, TxType, ...
    ├── view/                     # View model: buildResultViewModel (tx-view-model.ts), findings grouping and
    │                             # filters, exposure matrix, score waterfall, tx I/O rows, verdict taglines
    ├── palette.ts                # Hex colors for JS (SVG, canvas); mirrors globals.css tokens
    ├── severity.ts               # Severity -> Tailwind class maps
    ├── browser.ts                # isBraveBrowser (structurally typed for the CLI)
    ├── format.ts                 # formatSats, formatBtc, fmtN (locale-safe analysis text)
    ├── finding-utils.ts          # i18n keys/params for findings
    ├── analysis/
    │   ├── heuristic-registry.ts # TX_HEURISTICS (28), ADDRESS_HEURISTICS (6), tick()
    │   ├── tx-pipeline.ts        # runTxHeuristics + finalizeTxResult (the only tx loop and finalize)
    │   ├── orchestrator.ts       # Step lists, analyzeTransaction, analyzeAddress
    │   ├── run-txid-analysis.ts  # Full txid pipeline (fetch, trace, heuristics, chain, Boltzmann)
    │   ├── run-address-analysis.ts # Full address pipeline (+ per-tx breakdown, OFAC pre-send)
    │   ├── address-orchestrator.ts # Per-address tx breakdown, destination pre-send check
    │   ├── analysis-state.ts     # AnalysisState type, initial state, shared finding builders
    │   ├── settings.ts           # AnalysisSettings, defaults, localStorage-backed store
    │   ├── chain-trace.ts        # runChainTrace (recursive fetch) + runChainAnalysis (chain steps)
    │   ├── analyze-sync.ts       # Synchronous quick score for graph views
    │   ├── enrichment.ts         # BIP47 / ricochet finding enrichment (extra API lookups)
    │   ├── finding-metadata.ts   # FINDING_METADATA registry, FindingId union, tier enrichment
    │   ├── cross-heuristic/      # Suppressions, compound scoring, rollup, deterministic cap
    │   ├── heuristics/           # One module per heuristic + tx-utils, entropy math, detectors
    │   ├── chain/                # Chain modules (below)
    │   ├── entity-filter/        # EIDX index loader, matcher, search, data updater
    │   ├── cex-risk/             # OFAC list check, Chainalysis proxy check
    │   ├── cluster/              # Opt-in address cluster builder
    │   ├── boltzmann-*.ts        # WASM worker pool, eligibility, compute, entropy enhancement
    │   ├── wallet-audit.ts       # Wallet-level aggregate audit
    │   ├── coin-selection.ts     # Coin selection advisor (privacy-cost ranking over linkage clusters)
    │   ├── wallet-clusters.ts    # Linkage clusters: coins the wallet's history already links (W2, advisor)
    │   └── detect-input.ts       # Input type detection (txid, address, xpub, descriptor, PSBT)
    ├── api/                      # mempool client, retry, rate limit, IndexedDB cache, cache policy,
    │                             # prevout enrichment, network auto-detect, error messages
    ├── bitcoin/                  # networks, PSBT parser, descriptor/xpub derivation, address types
    ├── scoring/score.ts          # calculateScore, sumImpact, grades
    ├── recommendations/          # Primary recommendation cascade, remediation actions
    ├── graph/                    # Graph reducer, expansion ops, auto-trace, URL codec, saved graphs
    ├── wallet/                   # scan.ts: gap-limit address scan with hosted-API throttling;
    │                             # saved-wallets.ts: hashed-key snapshots (IndexedDB); refresh.ts: quick refresh
    ├── observatory/              # whirlpool + Wabisator clients, cache, sky/board/coordinator models, URL state
    └── i18n/                     # i18next config and React provider
```

## Data flow (txid scan)

1. `useAnalysis` (hook) detects the input type, creates the API client, checks the IndexedDB result cache and calls `runTxidAnalysis`.
2. `runTxidAnalysis` fetches the tx and raw hex, enriches missing prevouts (self-hosted backends), starts Boltzmann in the worker pool, fetches fiat prices / outspends / parent and child txs, and output address tx counts for 2-output txs. Optional fetches that fail mark the result `partial` (never cached).
3. `runChainTrace` recursively traces backward and forward (depth, minSats, skip CoinJoins, timeout from `AnalysisSettings`).
4. `runTxHeuristicSteps` runs the 28 tx heuristics via `runTxHeuristics`, reporting each step to the loader. Findings are **raw**: not yet scored.
5. BIP47 and ricochet findings are enriched; `runChainAnalysis` appends chain findings (backward, forward, cluster, spending, entity proximity, taint, linkability); warnings (partial trace, missing prevouts) are appended; the entropy finding is upgraded with the WASM Boltzmann result.
6. `finalizeTxResult` runs **once**, after every finding is collected: cross-heuristic rules, metadata enrichment, `calculateScore`, tx type classification. Chain findings therefore count toward the grade.

`analyzeTransaction` (golden tests, CLI, per-tx address breakdown) and `analyzeTransactionSync` (graph views) use the same `runTxHeuristics` + `finalizeTxResult` pair with less context. Address scans go through `runAddressAnalysis` -> `analyzeAddress` (6 address heuristics + temporal and fingerprint-evolution chain modules, scored with the address base).

## From result to screen

`src/app/page.tsx` renders one view per scanner phase from `useScanner`. A finished tx or address scan goes to `Results`, which builds a `ResultViewModel` with `buildResultViewModel` (`src/lib/view/`). Every number, tag and label on the result reads from that view model or from the engine result; components never re-run heuristics. Heavy tools (graph explorer, Boltzmann heat map, taint, cluster) are lazy-loaded in the analyst workspace. Design rules: [ui/design.md](./ui/design.md).

## Heuristics

Registered in `src/lib/analysis/heuristic-registry.ts`: **28 transaction-level + 6 address-level = 34**. Impacts and references per heuristic are in [privacy-engine.md](./privacy-engine.md).

| Kind | IDs |
|------|-----|
| Transaction | coinbase, h1 (round amounts), h2 (change), h3 (CIOH), h4 (CoinJoin), h5 (entropy), h6 (fees), h7 (OP_RETURN), h11 (wallet fingerprint), anon, timing, script, dust, dust-spend, h17 (multisig/escrow), peel, consolidation, unnecessary, tx0, bip69, bip47, exchange, coinsel, witness, postmix, entity, ricochet, utxo-age |
| Address | h8 (reuse), h9 (UTXOs), h10 (address type), spending, recurring, highactivity |

Finding ids are typed: `Finding.id` is `FindingId`, the key union of `FINDING_METADATA` (plus `h7-op-return-${number}`), so a typo or an unregistered id is a compile error. Adding a finding means adding its metadata entry and its English locale keys (enforced by `locale-parity.test.ts`).

### Chain modules (`src/lib/analysis/chain/`)

| Module | Used by | Purpose |
|--------|---------|---------|
| recursive-trace.ts | chain-trace, wallet scan, graph | Multi-hop backward/forward tracing |
| backward.ts | step `chain-backward` | Input provenance, CoinJoin inputs |
| forward.ts | step `chain-forward` | Output destinations, toxic merges |
| clustering.ts | step `chain-cluster` | CIOH cluster over the traced graph |
| spending-patterns.ts (+ post-mix-consolidation.ts, ricochet-detection.ts) | step `chain-spending` | Downstream spending behavior |
| entity-proximity.ts | step `chain-entity` | Known entities within N hops |
| taint.ts | step `chain-taint` | Proportional (haircut) backward taint |
| linkability.ts | chain analysis | Input-output link matrix |
| temporal.ts, prospective.ts | analyzeAddress | Burst timing, fingerprint evolution |
| trace-maps.ts | chain-trace | Parent/child/address lookup maps from trace layers |

## Scoring model

- Base 70 (transactions) or 93 (addresses), sum of `scoreImpact`, clamped 0-100.
- Grades: A+ >= 90, B >= 75, C >= 50, D >= 25, F < 25.
- Cross-heuristic rules (`cross-heuristic/index.ts`, in order): CoinJoin/Stonewall suppressions, multisig suppressions, CIOH/consolidation/entropy dedup, compound scoring (RBF x change, corroborated change, post-mix to entity, post-mix vs backward CoinJoin), wallet contradiction rules, behavioral fingerprint rollup, deterministic score cap (last).

## Settings and state

- `src/lib/analysis/settings.ts` owns `AnalysisSettings` (maxDepth, minSats, skipLargeClusters, skipCoinJoins, timeout, walletGapLimit, enableCache, boltzmannTimeout), defaults and a plain localStorage store. `useAnalysisSettings` is a thin `useSyncExternalStore` wrapper; the CLI builds settings from flags with the same defaults.
- `src/lib/analysis/analysis-state.ts` owns the `AnalysisState` shape used by `useAnalysis` (phases: idle, fetching, analyzing, complete, error).

## Colors

`src/app/globals.css` defines the tokens; Tailwind semantic classes (`text-severity-high`, `bg-surface-inset`) are the default in className code. JS contexts (SVG, canvas, inline styles) use `src/lib/palette.ts` (`DARK_COLORS` / `LIGHT_COLORS`, resolved per theme by `usePalette()`; `COLORS` for brand/severity hues and rasterized images), which `palette.test.ts` keeps in sync with the CSS.

- Severity: critical `#ef4444`, high `#f97316`, medium `#eab308`, low `#60a5fa`, good `#28d065`
- Bitcoin `#f7931a`, danger `#ef4444`, success `#28d065`
- Dark (`:root`) and light (`html[data-theme="light"]`) themes. The theme follows the OS unless System / Light / Dark is picked in settings (`useTheme`, stored in `localStorage["ami-theme"]`); a pre-paint script in `layout.tsx` avoids a flash. Token table: [ui/design.md](./ui/design.md).

## API endpoints

All requests go to one mempool.space-compatible backend (public, Tor onion, Umbrel or a custom URL). No secondary or fallback APIs.

- `GET /tx/{txid}`, `/tx/{txid}/hex`, `/tx/{txid}/outspends`
- `GET /address/{addr}`, `/address/{addr}/utxo`, `/address/{addr}/txs` (+ `/txs/chain/{lastTxid}` pagination)
- `GET /address-prefix/{prefix}` (autocomplete)
- `GET /v1/historical-price?currency=USD|EUR&timestamp={ts}`
- `GET /v1/fees/recommended`, `GET /tx/{txid}/status`
- `GET /block-height/0` (genesis hash, plain text): which chain a self-hosted backend serves, see below

### Backend network detection

A self-hosted backend (Umbrel / StartOS `/api`, or a custom URL) has no network in its path, so the app asks it: `src/lib/api/backend-network.ts` maps the genesis hash from `/block-height/0` to mainnet, testnet4 or signet (supported), or testnet3, regtest, `unknown` (unsupported). Every signet, default or custom, shares one genesis block, so a custom signet reads as signet.

- **Umbrel:** `useLocalApi` asks on every load, alongside the health probe (no persistent cache: `/api` stays the same URL when the node switches networks). If the node cannot be asked, the `bitcoinNetwork` hint in `/api/local-info` (Umbrel's `APP_BITCOIN_NETWORK`) applies, then mainnet.
- **Custom URL:** asked once per URL, cached in memory and in IndexedDB (`genesis@{baseUrl}`, infinite TTL). Settings "Apply" re-asks and shows "Connected: Signet". A URL that cannot be asked keeps the selected network.
- `NetworkContext` (`resolveBackendNetwork`): a supported chain pins the network (selector shows it, the others disabled; `?network=` and saved graphs of another network are refused); an unsupported chain opens the "Unsupported Network" dialog naming it. `cacheKeyPrefix` takes the detected network for the backend's URL.
- The CLI does the same for `--api` (SQLite cache): the reported chain replaces the default `--network`; an explicit `--network` that does not match is an error.
- `POST /tx` (opt-in broadcast, `Content-Type: text/plain`, body = signed hex; never retried or automatic), `POST /txs/test` (dry-run before broadcast)

Base URLs: `https://mempool.space/api`, `/testnet4/api`, `/signet/api`; Tor: `http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api`. Wallet scans against hosted APIs use a short burst (300ms gaps) followed by a 9s sustained delay per address; local backends are not throttled.

## Saved wallets

A complete wallet scan is saved as a snapshot so the next open renders at once (`src/lib/wallet/saved-wallets.ts`, `refresh.ts`, `useWalletAnalysis`).

- **Storage:** IndexedDB `aie-wallets` (stores `meta` and `data`), separate from the `aie-cache` response cache and governed by the same setting ("Persist cache across sessions"): with it off nothing is read or written. Settings "Clear" deletes both databases; the settings panel lists saved wallets (hash prefix, script type, network, last scan, size) with a forget button each.
- **Key:** hex SHA-256 of key string + script type + chain + `cacheKeyPrefix(backend)`. The raw xpub is never stored; a BIP329 `xpub` label for the wallet is kept with a placeholder ref, labels of other xpubs are dropped.
- **Snapshot (`SNAPSHOT_VERSION` 1):** derived addresses with chain/index, address stats, UTXOs, each tx once (addresses refer to txids), graph traces, highest used index per chain, gap limit, scan and full-scan times, tip height, BIP329 labels. Self-contained on purpose: the response cache evicts at 10k entries and expires address data, so it cannot rebuild results on its own.
- **Caps:** 25 MB per wallet (graph traces are dropped first, then the save is refused with a visible message), 100 MB in total (least recently scanned wallets are evicted). Partial scans (failed addresses) are never saved.
- **Quick refresh, phase 1** (blocking, renders "Up to date"/"Updated: N new transactions"): tip height; addresses with an unconfirmed tx or a tx under 6 confirmations at the saved tip are refetched; saved addresses with no history at or below the last used index (earlier invoices) get one address check each; per chain a window of min(20, saved gap limit) after the last used index, extended past each used address found; an address whose saved coin is spent by a fetched tx is refetched (stats stay exact).
- **Quick refresh, phase 2** (background, progressive, cancelled on navigation and on forget; the first failure stops all workers): every other address holding a saved coin gets one `/address/:addr/utxo` request, so both a spend and a new payment to that address are caught, and is refetched when its coins differ ("Verifying coins 40/150", then "(coins verified 150/150)"). On a chain where phase 1 found activity, the walk continues to the full saved gap limit past it, as the full scan does. Both phases use an uncached client (`createApiClient(cfg, signal, { fresh: true })`) and, on hosted APIs, one shared token bucket matching the full scan (burst 18, then one request per 3 s). New wallet txs are traced for the graph; saved traces are kept.
- **Not seen until the weekly full rescan:** a new payment to an address that already has history but holds no saved coin, and activity more than 20 unused addresses past the last used one when nothing nearer is used and the saved gap limit is larger. The 20-address window keeps phase 1 short on hosted APIs (a gap-300 window would be 600 requests, about 30 min); deeper walks happen once activity is found. `refresh.test.ts` checks that refresh + coin verification + frontier extension equal a full scan (infos and audit) over random histories with spends, an unconfirmed tx, a confirmation, a reorg and payments within the gap.
- **Forget and clear:** a module epoch per key (bumped by forget) and a global one (bumped by clear) are captured when a scan starts and checked inside the write transaction, so an in-flight refresh never resurrects a forgotten wallet. Forget/clear are broadcast to other tabs (`BroadcastChannel("aie-wallets")`), which drop their saved state; open connections close on `versionchange` so a clear is not blocked, and a clear still blocked after 5 s is reported in settings. Labels: last write wins between tabs editing the same wallet.
- **Full rescan:** the "Full rescan" button, or automatically when the last full walk is older than 7 days, the gap limit setting is above the snapshot's, or the schema version changed (labels survive). A full rescan never walks less deep than the saved gap limit.
- **Request counts** (`src/lib/wallet/__tests__/refresh.test.ts`, mocked 250 used addresses, 150 coins, gap 300): full scan 2,550 requests; quick refresh phase 1: 41 (45 with one new payment), phase 2: 150 in the background (430 after a new payment: the walk continues to the saved gap of 300). Set `AIE_HARNESS_XPUB` (and optionally `AIE_HARNESS_API`, `AIE_HARNESS_GAP`) to run the same comparison against a real signet wallet; never commit a key.
- **Wallet bookmarks (opt-in):** "Bookmark this wallet" stores the raw xpub/descriptor in the `bookmarks` localStorage entry (`type: "wallet"`, with script type, network, grade, name and the snapshot key) only after a privacy dialog is confirmed. Wallet entries are validated on load and import (the key must parse); a file with wallet entries shows the same privacy warning first and imports them only after "I understand" (or imports the rest without them); exports exclude them unless unticked; cache "Clear" keeps them.
- **CLI:** out of scope. Each CLI run is a one-shot scan; its SQLite response cache already serves repeated runs, and a snapshot/refresh path would need its own flags and storage.

## Services

Third-party services (Wabisator, Whirlpool stats) are never called directly by the browser.

- **Registry:** `src/lib/services/registry.json` is the single source of truth (service, base URL, routes, RPC methods, param validators). The worker bundles it; the sidecar ships a committed copy (`umbrel/tor-proxy/services.json`).
- **`/svc` routes:** `/svc/<service>/<path>` on the coinjoin-stats worker (public site, `workers/coinjoin-stats/svc.js`) and `/tor-proxy/svc/...` on the Tor sidecar (self-hosted, `umbrel/tor-proxy/svc.js`). Legacy worker routes (`/whirlpool/*`) stay.
- **Classes:** `aggregate` routes carry no user data and may be cached. `lookup` routes carry a user txid: never cached, never retried automatically.
- **`LookupConsent`:** `src/lib/services/consent.ts`. A lookup request is refused unless the caller holds a consent minted by `grantLookupConsent` for exactly those txids (normalized). The consent is granted by the click on the card.
- **Where the card is mounted:** `ServiceCheck` (`src/components/services/`) in `Results.tsx` (tx and address results, not local PSBT/raw-tx results) and `WalletResults.tsx`. It is not rendered with 0 eligible txids, never starts on its own, and results never touch scores, caches, history, URL or exports. Caps: 10 txids per address, 50 per wallet (`selectTxids`).

## Observatory (WabiSabi tab)

Backed by Wabisator, not LiquiSabi. Only the four aggregate RPC methods are used; a visitor txid is never sent (search runs on the loaded data).

- **Data:** `src/lib/observatory/wabisator-client.ts` calls `serviceRpc("wabisator", "/api.php", ...)` for `flow-map` (`until` floored to 300 s, `since = until - days*86400`), `coordinators-status`, `volume-history`, `rounds-paginated`. Hooks in `src/hooks/useWabisator.ts` poll only while the page is visible and keep the last good data on failure (flow-map 20/60/120 s for 1/7/30 d, status 10 s, volume 600 s, rounds 60 s).
- **Models:** `sky-model.ts` (scene, star layout, replay clock, particle caps), `board.ts` (live round cards), `coordinator-page.ts`, `obs-search.ts` (txid/date), `coordinator-palette.ts`, `obs-format.ts`.
- **Components:** `src/components/observatory/wabisabi/`: `WabiSabiTab` (sections, sticky sub-nav with scroll-spy), `SkyMap` + `sky-renderer` (canvas), `Timeline`, `Ticker`, `StatsStrip`, `TableView`, `LiveBoard`/`RoundRow`, `CoordinatorPage` (`VolumeHistoryChart`, `RoundsTable`), `RemixFlows`, `ObsSearch`.
- **URL state:** `useObsState` / `obs-hash.ts`: `#wabisabi&period=1|7|30&coordinator=<key>&tx=<txid>&view=map|table`. Unknown coordinators and malformed txids are dropped.
- **e2e:** `mockObservatoryApi` serves the aggregate methods from `src/lib/observatory/__tests__/fixtures/wabisator/`.

## Observatory (P2P markets tab)

Live KYC-free offers from RoboSats (whole federation), Mostro and HodlHodl. Spec: `docs/spec-observatory-p2p.md`. Every route is `aggregate`; nothing about the visitor is sent.

- **Registry capabilities:** services may omit `base` (onion-only RoboSats coordinators: the worker answers `404 ONION_ONLY`, the client never asks it; `isReachable(service, isUmbrel)` decides), list `relays` / `onionRelays`, and routes may carry `fixedQuery` (appended, never overridable) and the `offset` validator (HodlHodl pagination). A route with a `nostr` block makes the proxy run that fixed filter against the relays and return one snapshot `{ events, relays, fetchedAt }` (`workers/coinjoin-stats/nostr.js`, `umbrel/tor-proxy/nostr.js`); it must be GET `aggregate`.
- **Mostro allowlist:** anyone can publish `y=mostro` events, so `mostro-nostr.p2p.instances` in the registry lists known instances (source in `instancesSource`: mainnet instances with live orders and completed trades on the three relays, recorded 2026-10-07). Unlisted instances' offers are shown with an "Unlisted instance" chip but never count toward the headline, medians, depth, board or volume. Add one by PR after checking it trades.
- **Robustness:** a snapshot is 502 unless at least one relay sent EOSE (CLOSED or a NOTICE first is an error), so timeouts never replace a good book; events over 16 KiB are dropped, collection stops before 4 MiB, the sidecar caps ws frames at 256 KiB and allows plain http/ws only for .onion. Fixed-price orders (sats for a fixed fiat amount) get their premium computed against the index; expiry is judged on the snapshot clock.
- **Pure modules:** `src/lib/observatory/p2p/`: `nostr-verify.ts` (NIP-01 id + BIP-340 Schnorr, verified in the browser), `normalize-robosats.ts` / `normalize-mostro.ts` / `normalize-hodlhodl.ts` (one `P2pOffer` schema; trader names, content, titles and descriptions are never read), `sanitize.ts` (payment methods and notices), `market.ts` (index, markets, depth, board, headline), `volume.ts`.
- **Data:** `p2p-client.ts` + `src/hooks/useP2p.ts` (`useP2p`, `useP2pHistory`), polled with `src/hooks/usePolled.ts`: orders 30 s, coordinator info 60 s, index and Mostro info 300 s, HodlHodl 60 s; history (1 h) and Mostro trades (600 s) load when the Volume section nears the viewport. Each source reports `ok`, `partial`, `stale`, `down` or `loading`.
- **Components:** `src/components/observatory/p2p/`: `P2pTab`, `P2pHeadline`, `SourceStrip`, `MarketSelector`, `DepthWall`, `OfferList` (+ `offer-facts`), `PremiumBoard`, `VenueSection`, `P2pVolume`, `P2pFooter`. Colours: `--p2p-*` tokens in `globals.css`, read through `venue-palette.ts`.
- **URL state:** `#p2p&cur=EUR&side=sell&venue=robosats,mostro&view=table&coordinator=<key>`; `cur`, `side` and `venue` replace the history entry.
- **e2e:** `mockObservatoryApi` also serves the P2P routes from `src/lib/observatory/__tests__/fixtures/p2p/` (signed sample for both order snapshots, since redacted events fail verification); `failP2pRoute` makes one route 502.

## Key design decisions

1. Static export (`output: "export"`), GitHub Pages; CSP via `<meta>`.
2. `@scure/btc-signer` / `@scure/bip32` for PSBT and xpub derivation; no bitcoinjs-lib.
3. `useSyncExternalStore` for localStorage state; cache parsed JSON for referential stability.
4. Loader tick: 50ms between heuristic steps in the browser, 0 in Node and tests (`setTickDelay`).
5. Hash routing for shareable scans; `hashchange` listener for back/forward.
6. `motion/react` (not `framer-motion`); Tailwind CSS 4 with `@theme inline`.
7. AbortController per scan; stale scans cannot overwrite newer results.
8. Boltzmann runs in a WASM worker pool (`public/workers/boltzmann.worker.js`), auto-computed for small txs.
9. Entity filter: EIDX v2 binary index (core auto-loaded, full index optional) plus OFAC overlay.
10. i18n: 6 locales (en, es, pt, de, fr, pl) in `public/locales/`.

## Common gotchas

1. Finding ids must be unique; multiple OP_RETURN outputs get `h7-op-return-{n}`.
2. Whirlpool = 5 equal outputs at a known denomination; WabiSabi = 20+ inputs/outputs.
3. `fmtN()` (not bare `toLocaleString()`) in analysis text.
4. PSBTs and raw transactions are analyzed in memory: never put in the URL hash, history, bookmarks or cache.

## Workflow

```bash
pnpm dev          # Dev server on :3000
pnpm build        # Static export to out/
pnpm lint         # ESLint, --max-warnings 0
pnpm type-check   # tsc --noEmit
pnpm test         # Vitest (see docs/testing.md)
pnpm test:e2e     # Playwright against out/
```
