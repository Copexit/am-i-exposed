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
│   ├── page.tsx                  # Scanner: hash routing (#tx= / #addr= / #check= / #xpub=), phase machine
│   ├── layout.tsx                # Root layout: metadata, CSP <meta>, providers
│   ├── globals.css               # Theme tokens (dark default, html[data-theme="light"] overrides)
│   ├── graph/                    # Standalone graph explorer
│   ├── observatory/              # CoinJoin Observatory (Whirlpool + WabiSabi stats)
│   ├── guide/ faq/ glossary/ about/ agents/ setup-guide/ welcome/
│   └── */opengraph-image.tsx     # Static OG / Twitter images per route
├── components/
│   ├── ResultsPanel.tsx          # Results layout (score, findings, viz, recommendations)
│   ├── results/                  # Results sub-sections (findings, sidebar, deep analysis, waterfall)
│   ├── DiagnosticLoader.tsx      # Step-by-step heuristic progress with running score
│   ├── ChainAnalysisPanel.tsx    # Chain findings grouped by category
│   ├── GraphExplorerPanel.tsx    # Graph explorer wrapper (API client, hooks)
│   ├── ClusterPanel.tsx          # Opt-in address cluster analysis
│   ├── CexRiskPanel.tsx, cex/    # OFAC + Chainalysis screening
│   ├── wallet/                   # xpub/descriptor audit views
│   ├── settings/                 # Network, analysis, cache, workspace, locale, entity filter
│   ├── guide/                    # Guide page sections (data in src/data/guide/)
│   ├── observatory/              # Observatory cards, charts, tables
│   ├── history/                  # Recent scans and bookmarks
│   ├── ui/                       # Small shared primitives (Tooltip, CopyButton, Spinner, ...)
│   └── viz/                      # visx/SVG charts
│       ├── TxFlowDiagram.tsx, FlowChart.tsx      # Sankey I/O flow (+ Boltzmann overlay)
│       ├── LinkabilityHeatmap.tsx                # Boltzmann link probability matrix
│       ├── CoinJoinStructure.tsx                 # CoinJoin structure diagram
│       ├── TaintPathDiagram.tsx, taint/          # Taint flow diagram
│       ├── ScoreWaterfall.tsx, SeverityRing.tsx  # Score breakdown, severity distribution
│       ├── UtxoBubbleChart.tsx, PrivacyTimeline.tsx, FingerprintTimeline.tsx, EntityGraph.tsx
│       ├── GraphExplorer.tsx, graph/             # OXT-style graph (see docs/adr-oxt-graph.md)
│       └── shared/svgConstants.ts                # SVG_COLORS, derived from src/lib/palette.ts
├── context/NetworkContext.tsx    # Selected network and its NETWORK_CONFIG
├── hooks/                        # React wrappers (useAnalysis, useAnalysisSettings, useBoltzmann,
│                                 # useGraphExpansion, useWalletAnalysis, useHashRouting, useTheme, ...)
├── data/                         # entities.json, ofac-addresses.json, guide/*, glossary, agents
└── lib/
    ├── types.ts                  # Finding (id: FindingId), ScoringResult, Grade, TxType, ...
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
    │   ├── coin-selection.ts     # Coin selection advisor
    │   └── detect-input.ts       # Input type detection (txid, address, xpub, descriptor, PSBT)
    ├── api/                      # mempool client, retry, rate limit, IndexedDB cache, cache policy,
    │                             # prevout enrichment, network auto-detect, error messages
    ├── bitcoin/                  # networks, PSBT parser, descriptor/xpub derivation, address types
    ├── scoring/score.ts          # calculateScore, sumImpact, grades
    ├── recommendations/          # Primary recommendation cascade, remediation actions
    ├── graph/                    # Graph reducer, expansion ops, auto-trace, URL codec, saved graphs
    ├── wallet/scan.ts            # Gap-limit address scan with hosted-API throttling
    ├── observatory/              # whirlpoolstats / liquisabi clients, cache, selectors
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

`src/app/globals.css` defines the tokens; Tailwind semantic classes (`text-severity-high`, `bg-surface-inset`) are the default in className code. JS contexts (SVG, canvas) use `src/lib/palette.ts` (`COLORS`, `LIGHT_COLORS`), which `palette.test.ts` keeps in sync with the CSS.

- Severity: critical `#ef4444`, high `#f97316`, medium `#eab308`, low `#60a5fa`, good `#28d065`
- Bitcoin `#f7931a`, danger `#ef4444`, success `#28d065`
- Dark theme by default; a light theme is available via `html[data-theme="light"]` (`useTheme`).

## API endpoints

All requests go to one mempool.space-compatible backend (public, Tor onion, Umbrel or a custom URL). No secondary or fallback APIs.

- `GET /tx/{txid}`, `/tx/{txid}/hex`, `/tx/{txid}/outspends`
- `GET /address/{addr}`, `/address/{addr}/utxo`, `/address/{addr}/txs` (+ `/txs/chain/{lastTxid}` pagination)
- `GET /address-prefix/{prefix}` (autocomplete)
- `GET /v1/historical-price?currency=USD|EUR&timestamp={ts}`

Base URLs: `https://mempool.space/api`, `/testnet4/api`, `/signet/api`; Tor: `http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api`. Wallet scans against hosted APIs use a short burst (300ms gaps) followed by a 9s sustained delay per address; local backends are not throttled.

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
4. PSBTs are analyzed directly, never put in the URL hash.

## Workflow

```bash
pnpm dev          # Dev server on :3000
pnpm build        # Static export to out/
pnpm lint         # ESLint, --max-warnings 0
pnpm type-check   # tsc --noEmit
pnpm test         # Vitest (see docs/testing.md)
pnpm test:e2e     # Playwright against out/
```
