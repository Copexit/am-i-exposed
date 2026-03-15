# Development Reference

## Architecture

```
src/
├── app/
│   ├── page.tsx              # Main page - state machine (idle/fetching/analyzing/complete/error)
│   ├── layout.tsx            # Root layout with metadata, CSP, NetworkContext
│   ├── error.tsx             # Error boundary
│   └── globals.css           # Theme variables, scrollbar, focus styles
├── components/
│   ├── AddressInput.tsx      # Search input with URL parsing, paste detection, type hints
│   ├── AddressSummary.tsx    # Address stats (balance, received, sent, tx count)
│   ├── ApiSettings.tsx       # Settings panel container/portal/focus trap
│   ├── ChainAnalysisPanel.tsx # Chain analysis findings grouped by category
│   ├── ConnectionBadge.tsx   # Tor vs clearnet indicator
│   ├── DiagnosticLoader.tsx  # Step-by-step heuristic progress with timer
│   ├── ExportButton.tsx      # Copy formatted report to clipboard
│   ├── FindingCard.tsx       # Collapsible finding with severity border colors
│   ├── GraphExplorerPanel.tsx # OXT-style graph wrapper (creates API client, wires hooks)
│   ├── Header.tsx            # Sticky header with logo, badge, network selector
│   ├── InstallPrompt.tsx     # PWA install banner
│   ├── PrivacyNotice.tsx     # One-time dismissible privacy banner
│   ├── Remediation.tsx       # "What to do next" prioritized action list
│   ├── ResultsPanel.tsx      # Full results: score, findings, summaries, actions
│   ├── ScoreDisplay.tsx      # Animated score count-up with grade badge
│   ├── ShareCardButton.tsx   # Canvas-rendered share card for social media
│   ├── TxSummary.tsx         # Visual I/O map with anonymity set coloring
│   ├── settings/
│   │   ├── AnalysisSettingsPanel.tsx # Depth/sats/timeout sliders, skip toggles
│   │   ├── LocaleSelector.tsx       # Language dropdown
│   │   └── NetworkSettings.tsx      # API URL, health check, diagnostics
│   └── viz/
│       ├── CoinJoinStructure.tsx  # CoinJoin input/output mapping diagram
│       ├── GraphExplorer.tsx      # OXT-style graph orchestrator (toolbar, sidebar, canvas)
│       ├── graph/                 # OXT-style graph sub-components (see docs/adr-oxt-graph.md)
│       │   ├── types.ts           # All graph-related TypeScript interfaces
│       │   ├── constants.ts       # Node/port dimensions, zoom limits, colors
│       │   ├── layout.ts          # Column-based DAG layout algorithm
│       │   ├── edge-utils.ts      # Edge path calculation + port-to-port routing
│       │   ├── portLayout.ts      # UTXO port position math for expanded nodes
│       │   ├── scriptStyles.ts    # Script type colors, dashes, thickness, fingerprint encoding
│       │   ├── icons.tsx          # Toolbar icon components
│       │   ├── GraphCanvas.tsx    # Main SVG canvas (nodes, edges, pan/zoom, gestures)
│       │   ├── GraphMinimap.tsx   # Minimap overlay for fullscreen navigation
│       │   ├── ExpandedNode.tsx   # Expanded node with input/output UTXO ports
│       │   ├── GraphSidebar.tsx   # 320px right sidebar (I/O, Analysis, Technical tabs)
│       │   └── index.ts           # Barrel exports
│       ├── ScoreWaterfall.tsx     # Finding impact waterfall chart
│       ├── TaintPathDiagram.tsx   # Bithypha-style taint flow visualization
│       ├── TxFlowDiagram.tsx      # Transaction I/O flow Sankey diagram
│       └── shared/svgConstants.ts # Shared SVG colors and constants
├── context/
│   └── NetworkContext.tsx    # Network state provider (reads from URL ?network=)
├── hooks/
│   ├── useAnalysis.ts       # Main orchestration hook with AbortController
│   ├── useAnalysisSettings.ts # Chain trace settings (depth, sats, timeout)
│   ├── useAnalysisState.ts  # State types, initial state, helper factories
│   ├── useChainTrace.ts     # Backward/forward recursive tracing + chain heuristics
│   ├── useGraphExpansion.ts # Expandable tx graph state (undo/reset/node cap)
│   ├── useKeyboardNav.ts    # Keyboard shortcuts (Esc, /, Ctrl+K)
│   ├── useRecentScans.ts    # localStorage with useSyncExternalStore
│   ├── useUrlState.ts       # URL search params for network
│   └── useWalletAnalysis.ts # xpub/descriptor wallet-level audit
└── lib/
    ├── analysis/
    │   ├── detect-input.ts        # Input type detection + URL extraction
    │   ├── orchestrator.ts        # Heuristic registry, tx/address analysis entry points
    │   ├── cross-heuristic.ts     # Cross-heuristic suppression/boosting rules
    │   ├── address-orchestrator.ts # Address analysis + destination pre-send checks
    │   ├── heuristics/            # 32 tx-level + 6 address-level heuristic modules
    │   │   └── tx-utils.ts        # Shared utilities (getSpendableOutputs)
    │   ├── chain/                 # 13 chain analysis modules
    │   │   ├── recursive-trace.ts # Multi-hop backward/forward tracing engine
    │   │   ├── backward.ts        # Input provenance analysis
    │   │   ├── forward.ts         # Output destination analysis
    │   │   ├── clustering.ts      # Address clustering
    │   │   ├── entity-proximity.ts # Known entity proximity scan
    │   │   ├── taint.ts           # Proportional (haircut) taint flow
    │   │   ├── linkability.ts     # Linkability matrix analysis
    │   │   ├── spending-patterns.ts # Spending pattern detection
    │   │   ├── joinmarket.ts      # JoinMarket-specific analysis
    │   │   ├── coinjoin-quality.ts # CoinJoin quality assessment
    │   │   ├── peel-chain-trace.ts # Peel chain following
    │   │   ├── temporal.ts        # Temporal pattern analysis
    │   │   └── prospective.ts     # Prospective privacy assessment
    │   └── entity-filter/         # Entity matching (OFAC, exchanges, etc.)
    │       ├── entity-match.ts    # Address-to-entity lookup
    │       └── filter-loader.ts   # Binary index loader
    ├── api/
    │   ├── client.ts          # API client (mempool.space only, no fallback)
    │   ├── mempool.ts         # mempool.space REST API implementation
    │   ├── cached-client.ts   # Cached API client wrapper
    │   ├── fetch-with-retry.ts # Retry logic, ApiError types
    │   ├── rate-limiter.ts    # Request rate limiter
    │   ├── analysis-cache.ts  # Analysis result caching (IndexedDB)
    │   ├── idb-cache.ts       # IndexedDB cache implementation
    │   ├── url-diagnostics.ts # API URL validation and diagnostics
    │   ├── enrich-prevouts.ts # Prevout data enrichment for self-hosted backends
    │   └── types.ts           # API response types
    ├── bitcoin/
    │   ├── networks.ts        # Network configs (mainnet, testnet4, signet)
    │   ├── psbt.ts            # PSBT parser using @scure/btc-signer
    │   └── descriptor.ts      # xpub/descriptor parser with BIP44/49/84/86
    ├── scoring/
    │   └── score.ts           # Base 70/93, sum impacts, clamp 0-100, grade
    ├── format.ts              # formatSats, formatBtc, fmtN (locale-safe)
    └── types.ts               # Finding, ScoringResult, Grade types
```

## Heuristics (31 total: 25 tx-level + 6 address-level + 6 chain analysis)

### Transaction heuristics (25 registered in orchestrator)
| ID | Module | Impact | Description |
|----|--------|--------|-------------|
| coinbase | coinbase-detection.ts | 0 | Coinbase transaction detection |
| h1 | round-amount.ts | -5 to -15 | Round BTC/sat/USD/EUR amounts in outputs |
| h2 | change-detection.ts | -5 to -25 | Address type mismatch, round amount, self-send, fresh address |
| h3 | cioh.ts | -6 to -45 | Common Input Ownership Heuristic |
| h4 | coinjoin.ts | +15 to +30 | Whirlpool, WabiSabi, JoinMarket, Stonewall, simplified Stonewall |
| h5 | entropy.ts | -5 to +15 | Simplified Boltzmann entropy (capped at 8x8) |
| h6 | fee-analysis.ts | 0 to -2 | Round fee rate, RBF signaling, CPFP detection |
| h7 | op-return.ts | -5 to -8 | OP_RETURN metadata, protocol detection |
| h11 | wallet-fingerprint.ts | -2 to -6 | nLockTime, Low-R signatures, wallet identification |
| h17 | multisig-detection.ts | 0 to -3 | Multisig/escrow detection |
| anon | anonymity-set.ts | -1 to +5 | Equal-value output group analysis |
| timing | timing.ts | -1 to -3 | Mempool/off-hours timing analysis |
| script | script-type-mix.ts | -8 to +2 | Script uniformity, bare multisig detection |
| dust | dust-output.ts | -3 to -8 | Dust attack / tiny output detection |
| peel | peel-chain.ts | -3 to -8 | Peel chain detection |
| consolidation | consolidation.ts | -3 to -10 | Fan-in/fan-out consolidation patterns |
| unnecessary | unnecessary-input.ts | -2 to -5 | Unnecessary input detection |
| tx0 | coinjoin-premix.ts | 0 to +3 | CoinJoin premix (tx0) detection |
| bip69 | bip69.ts | -1 to -2 | BIP69 lexicographic ordering |
| bip47 | bip47-notification.ts | 0 to -3 | BIP47 notification transaction detection |
| exchange | exchange-pattern.ts | -2 to -5 | Exchange withdrawal pattern detection |
| coinsel | coin-selection.ts | -1 to -3 | Coin selection algorithm fingerprinting |
| witness | witness-analysis.ts | -1 to -3 | Witness data type/depth analysis |
| postmix | post-mix.ts | -5 to -15 | Post-mix consolidation detection |
| entity | entity-detection.ts | -5 to -10 | Known entity address detection |

### Address heuristics (6)
| ID | Module | Impact | Description |
|----|--------|--------|-------------|
| h8 | address-reuse.ts | +3 to -93 | Address reuse count with severity scaling |
| h9 | utxo-analysis.ts | +2 to -11 | UTXO count, dust UTXOs |
| h10 | address-type.ts | -5 to 0 | P2TR/P2WPKH (0) > P2WSH (-2) > P2SH (-3) > P2PKH (-5) |
| spending | spending-analysis.ts | -5 to +2 | Counterparty diversity, cold storage |
| recurring | recurring-payment.ts | -2 to -5 | Recurring payment pattern detection |
| highactivity | high-activity-address.ts | -2 to -5 | High activity address detection |

### Chain analysis modules (6 steps, 14 modules)
| Step | Modules | Description |
|------|---------|-------------|
| chain-backward | backward.ts | Input provenance - parent tx patterns, CoinJoin inputs |
| chain-forward | forward.ts | Output destinations - toxic merges, direct spends |
| chain-cluster | clustering.ts | Address clustering from traced tx graph |
| chain-spending | spending-patterns.ts | Spending pattern analysis across chain |
| chain-entity | entity-proximity.ts | Known entity proximity within N hops |
| chain-taint | taint.ts | Proportional (haircut) backward taint flow |

Additional chain modules (computed inline, no separate step):
- `linkability.ts` - Linkability matrix for tx inputs/outputs
- `recursive-trace.ts` - Multi-hop backward/forward tracing engine
- `joinmarket.ts` - JoinMarket-specific chain analysis
- `coinjoin-quality.ts` - CoinJoin quality assessment
- `peel-chain-trace.ts` - Peel chain following across hops
- `temporal.ts` - Temporal pattern analysis
- `prospective.ts` - Prospective privacy assessment

## Scoring Model

- **Base**: 70/100 (transactions), 93/100 (addresses)
- **Sum**: All finding `scoreImpact` values added
- **Clamp**: Result clamped to 0-100
- **Grades**: A+ >= 90, B >= 75, C >= 50, D >= 25, F < 25

## Cross-Heuristic Intelligence

The `cross-heuristic.ts` module runs a post-processing pass after all heuristics:

**CoinJoin suppression**: When a CoinJoin is detected, suppresses CIOH, round-amount, change detection, script-mixed, low-entropy, wallet fingerprint, dust, timing, fee, anonymity-set, multisig/escrow, consolidation, BIP69, witness analysis, and coin selection findings. Stonewall gets partial CIOH reduction (-3 instead of 0) since all inputs are one wallet.

**Multisig adjustment**: Suppresses script-mixed penalty (structural, not a leak).

**CIOH dedup**: When CIOH fires on non-CoinJoin tx, suppresses redundant unnecessary-input and caps consolidation at -2.

**Consolidation triple-penalty**: When self-send consolidation detected, suppresses zero-entropy (inherent).

**RBF x Change**: When both RBF and change detection fire, boosts change confidence and adds -2 compound.

**Compound stacking**: Change detection boosted by corroborating wallet fingerprint, peel chain, and/or low entropy (max -6 boost).

**Post-mix to entity**: Escalates entity-known-output to critical when post-mix consolidation detected.

**Post-mix + backward CoinJoin dedup**: Zeros backward CoinJoin-input positive finding when negated by post-mix consolidation.

**Wasabi + address reuse paradox**: Flags contradiction between Wasabi fingerprint and address reuse.

**Deterministic cap**: Forces F grade when deterministic findings present (same-address-io, sweep).

## Key Design Decisions

1. **Static export**: `output: "export"` in next.config.ts. No server. GitHub Pages.
2. **@scure/btc-signer**: Used for PSBT parsing and xpub derivation. No bitcoinjs-lib.
3. **useSyncExternalStore for localStorage**: Must cache parsed JSON for referential stability.
4. **50ms tick between heuristics**: Creates diagnostic effect. ~1.5s total for tx analysis.
5. **Hash-based routing**: `#tx=...` / `#addr=...` / `#xpub=...` for sharing.
6. **Privacy-honest disclosure**: Banner about mempool.space IP visibility.
7. **motion/react**: Import from `motion/react` not `framer-motion`.
8. **Tailwind CSS 4**: `@theme inline` in globals.css, not tailwind.config.
9. **AbortController**: Cancels in-flight requests on reset/new query.
10. **Running score during analysis**: DiagnosticLoader shows live score tally and per-heuristic impact.
11. **Danger zone for F-grade**: Pulsing red glow + warning banner for critical failures.
12. **Clickable addresses**: TxSummary addresses are clickable to scan related addresses.
13. **Auto-expand remediation**: D/F grades auto-open the "What to do next" section.
14. **Score breakdown waterfall**: Visual bars showing each finding's relative impact on the score.
15. **Header as hash reset**: Logo click clears hash (no full page reload), triggers hashchange listener.
16. **Entity filter**: Binary index format (EIDX v2) with 1M+ named addresses, OFAC sanctions overlay.
17. **Chain tracing**: Recursive backward/forward tracing with configurable depth, timeout, and minSats filter.
18. **Graph explorer**: Interactive force-directed tx DAG with expand/collapse, undo, and node cap.
19. **i18n**: 5 locales (en, es, de, fr, pt) via react-i18next with key-based lookups.

## API Endpoints

- `GET /api/tx/{txid}` - Full transaction data
- `GET /api/tx/{txid}/hex` - Raw hex (wallet fingerprinting)
- `GET /api/tx/{txid}/outspends` - Output spend status
- `GET /api/address/{addr}` - Address stats
- `GET /api/address/{addr}/utxo` - UTXO set
- `GET /api/address/{addr}/txs` - Recent transactions (last 25)
- `GET /api/v1/historical-price?currency=USD&timestamp={ts}` - Historical USD price
- `GET /api/v1/historical-price?currency=EUR&timestamp={ts}` - Historical EUR price

Base URLs:
- Mainnet: `https://mempool.space/api`
- Testnet4: `https://mempool.space/testnet4/api`
- Signet: `https://mempool.space/signet/api`
- Tor: `http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api`

All API queries go to a single provider (mempool.space by default, or user-configured endpoint). No secondary/fallback APIs are used. For wallet scans, hosted APIs are automatically throttled (3 addresses/batch, 500ms delay) to avoid rate limiting.

## CSS Tokens

All colors defined as CSS custom properties in `globals.css`:
- `--severity-critical` (#ef4444) / `--severity-high` (#f97316) / `--severity-medium` (#eab308) / `--severity-low` (#60a5fa) / `--severity-good` (#28d065)
- `--bitcoin` (#f7931a) / `--danger` (#ef4444) / `--success` (#28d065)
- Dark theme only, no light mode

## Common Gotchas

1. **OP_RETURN duplicate IDs**: Finding IDs must be unique. Appends index when >1 OP_RETURN.
2. **Whirlpool vs WabiSabi**: Whirlpool = 5+ equal outputs at known denominations, 5-10 total outputs. WabiSabi = 20+ inputs/outputs.
3. **ROADMAP.md was .gitignored**: Use `git add -f` to override.
4. **CSP**: Set via `<meta>` tag since static export can't use server headers.

## Development Workflow

```bash
pnpm dev          # Start dev server on :3000
pnpm build        # Static export to out/
pnpm lint         # ESLint

# Screenshots for UI verification
npx playwright screenshot --wait-for-timeout=7000 "http://localhost:3000/#tx=TXID" screenshot.png
npx playwright screenshot --full-page --viewport-size=375,812 "http://localhost:3000" mobile.png
```

## Implemented Features (formerly "Future Ideas")

- [x] Transaction graph visualization - GraphExplorer with multi-hop expansion
- [x] Multi-transaction batch analysis - wallet analysis via xpub/descriptors
- [x] Taint flow visualization - TaintPathDiagram (visx)
- [x] CoinJoin structure diagram - CoinJoinStructure component
- [x] Entity detection - 363+ entities, OFAC sanctions overlay
- [x] Chain analysis - recursive backward/forward tracing up to 50 hops
- [x] Share card generation - Canvas-rendered PNG share cards
- [x] PSBT analysis - client-side parsing without API calls
- [x] i18n - 5 languages (en, es, de, fr, pt)

## Remaining Ideas

- [ ] PDF report export
- [ ] Score comparison mode (before/after CoinJoin)
- [ ] Browser extension for mempool.space integration
