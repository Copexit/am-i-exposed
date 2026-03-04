# Development Reference

## Architecture

```
src/
├── app/
│   ├── page.tsx          # Main page - state machine (idle/fetching/analyzing/complete/error)
│   ├── layout.tsx        # Root layout with metadata, CSP, NetworkContext
│   ├── error.tsx         # Error boundary
│   └── globals.css       # Theme variables, scrollbar, focus styles
├── components/
│   ├── AddressInput.tsx   # Search input with URL parsing, paste detection, type hints
│   ├── AddressSummary.tsx # Address stats (balance, received, sent, tx count)
│   ├── ConnectionBadge.tsx # Tor vs clearnet indicator
│   ├── DiagnosticLoader.tsx # Step-by-step heuristic progress with timer
│   ├── ExportButton.tsx   # Copy formatted report to clipboard
│   ├── FindingCard.tsx    # Collapsible finding with severity border colors
│   ├── Header.tsx         # Sticky header with logo, badge, network selector
│   ├── InstallPrompt.tsx  # PWA install banner
│   ├── NetworkSelector.tsx # mainnet/testnet4/signet dropdown
│   ├── PrivacyNotice.tsx  # One-time dismissible privacy banner
│   ├── RecentScans.tsx    # localStorage-backed recent scan history
│   ├── Remediation.tsx    # "What to do next" prioritized action list
│   ├── ResultsPanel.tsx   # Full results: score, findings, summaries, actions
│   ├── ScoreBreakdown.tsx # Waterfall showing base 70 +/- each finding
│   ├── ScoreDisplay.tsx   # Animated score count-up with grade badge
│   └── TxSummary.tsx      # Visual I/O map with anonymity set coloring
├── context/
│   └── NetworkContext.tsx  # Network state provider (reads from URL ?network=)
├── hooks/
│   ├── useAnalysis.ts     # Main orchestration hook with AbortController
│   ├── useKeyboardNav.ts  # Keyboard shortcuts (Esc, /, Ctrl+K)
│   ├── useRecentScans.ts  # localStorage with useSyncExternalStore
│   └── useUrlState.ts     # URL search params for network
└── lib/
    ├── analysis/
    │   ├── detect-input.ts # Input type detection + URL extraction
    │   ├── orchestrator.ts # Runs all heuristics with cross-heuristic intelligence
    │   └── heuristics/     # 18 heuristic modules
    ├── api/
    │   ├── client.ts       # Unified client with mempool -> blockstream fallback
    │   ├── mempool.ts      # mempool.space API
    │   ├── fetch-with-retry.ts # Retry logic, ApiError types
    │   ├── rate-limiter.ts # API rate limiting
    │   ├── url-diagnostics.ts # Custom endpoint validation
    │   ├── enrich-prevouts.ts # Prevout data enrichment
    │   └── types.ts        # API response types
    ├── scoring/
    │   └── score.ts        # Base 70/93, sum impacts, clamp 0-100, grade
    └── types.ts            # Finding, ScoringResult, Grade types
```

## Heuristics (18 total)

### Transaction heuristics (14)
| ID | Module | Impact | Description |
|----|--------|--------|-------------|
| coinbase | coinbase-detection.ts | 0 | Coinbase transaction detection |
| H1 | round-amount.ts | -5 to -15 | Round BTC/sat amounts in outputs |
| H2 | change-detection.ts | -5 to -25 | Address type mismatch, round amount, self-send |
| H3 | cioh.ts | -6 to -45 | Common Input Ownership Heuristic |
| H4 | coinjoin.ts | +15 to +30 | Whirlpool, WabiSabi, JoinMarket, Stonewall |
| H5 | entropy.ts | -5 to +15 | Simplified Boltzmann (capped at 8x8) |
| H6 | fee-analysis.ts | 0 to -2 | Round fee rate, RBF signaling |
| H7 | op-return.ts | -5 to -8 | OP_RETURN metadata, protocol detection (stacks) |
| H11 | wallet-fingerprint.ts | -2 to -6 | nLockTime, Low-R signatures, BIP69, wallet ID |
| H17 | multisig-detection.ts | 0 to -3 | Multisig/escrow detection |
| anon | anonymity-set.ts | -1 to +5 | Equal-value output group analysis |
| timing | timing.ts | -1 to -3 | Mempool/off-hours timing analysis |
| script | script-type-mix.ts | -8 to +2 | Script uniformity, bare multisig detection |
| dust | dust-output.ts | -3 to -8 | Dust attack / tiny output detection |

### Address heuristics (4)
| ID | Module | Impact | Description |
|----|--------|--------|-------------|
| H8 | address-reuse.ts | +3 to -93 | Address reuse count with severity scaling |
| H9 | utxo-analysis.ts | +2 to -11 | UTXO count, dust UTXOs |
| H10 | address-type.ts | -5 to 0 | P2TR/P2WPKH (0) > P2WSH (-2) > P2SH (-3) > P2PKH (-5) |
| spending | spending-analysis.ts | -5 to +2 | Counterparty diversity, cold storage |

## Scoring Model

- **Base**: 70/100 (transactions), 93/100 (addresses)
- **Sum**: All finding `scoreImpact` values added
- **Clamp**: Result clamped to 0-100
- **Grades**: A+ >= 90, B >= 75, C >= 50, D >= 25, F < 25

## Cross-Heuristic Intelligence

The orchestrator runs a post-processing pass after all heuristics:
- **CoinJoin detected**: Suppresses CIOH, round-amount, change detection, script-mixed, low-entropy, wallet fingerprint, dust, timing, fee, anonymity-set, and multisig/escrow findings
- CIOH finding: severity → "low", title += context note, scoreImpact = 0
- Round amount finding: suppressed as denomination
- Change detection: suppressed as unreliable in CoinJoin context

## Key Design Decisions

1. **Static export**: `output: "export"` in next.config.ts. No server. GitHub Pages.
2. **No bitcoinjs-lib**: Was planned but removed. All data comes from mempool.space API.
3. **useSyncExternalStore for localStorage**: Must cache parsed JSON for referential stability.
4. **50ms tick between heuristics**: Creates diagnostic effect. ~1.5s total for tx analysis.
5. **Hash-based routing**: `#tx=...` / `#addr=...` for sharing.
6. **Privacy-honest disclosure**: Banner about mempool.space IP visibility.
7. **motion/react**: Import from `motion/react` not `framer-motion`.
8. **Tailwind CSS 4**: `@theme inline` in globals.css, not tailwind.config.
9. **AbortController**: Cancels in-flight requests on reset/new query.
10. **Running score during analysis**: DiagnosticLoader shows live score tally and per-heuristic impact.
11. **Danger zone for F-grade**: Pulsing red glow + warning banner for critical failures.
12. **Clickable addresses**: TxSummary addresses are clickable to scan related addresses.
13. **Auto-expand remediation**: D/F grades auto-open the "What to do next" section.
14. **Score breakdown waterfall**: Visual bars showing each finding's relative impact on the score.
15. **Recent scan timestamps**: Relative time display ("2m ago") with clear history button.
16. **Header as hash reset**: Logo click clears hash (no full page reload), triggers hashchange listener.

## API Endpoints

- `GET /api/tx/{txid}` - Full transaction data
- `GET /api/tx/{txid}/hex` - Raw hex (wallet fingerprinting)
- `GET /api/address/{addr}` - Address stats
- `GET /api/address/{addr}/utxo` - UTXO set
- `GET /api/address/{addr}/txs` - Recent transactions (last 25)

Base URLs:
- Mainnet: `https://mempool.space/api`
- Fallback: `https://blockstream.info/api` (mainnet only)
- Testnet4: `https://mempool.space/testnet4/api`
- Signet: `https://mempool.space/signet/api`
- Tor: `http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api`

## CSS Tokens

All colors defined as CSS custom properties in `globals.css`:
- `--severity-critical` (#ef4444) / `--severity-high` (#f97316) / `--severity-medium` (#eab308) / `--severity-low` (#3b82f6) / `--severity-good` (#28d065)
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

## Future Ideas

- [ ] Full Boltzmann entropy via WebWorker
- [ ] Transaction graph visualization (1-hop)
- [ ] PDF/PNG report export
- [ ] Multi-transaction batch analysis
- [ ] Score comparison mode (before/after CoinJoin)
- [ ] phoenixd Lightning payment for premium reports
- [ ] Browser extension for mempool.space integration
