# Am I Exposed?

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/Copexit/am-i-exposed/actions/workflows/ci.yml/badge.svg)](https://github.com/Copexit/am-i-exposed/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/Copexit/am-i-exposed.svg)](https://github.com/Copexit/am-i-exposed/stargazers)
[![GitHub last commit](https://img.shields.io/github/last-commit/Copexit/am-i-exposed.svg)](https://github.com/Copexit/am-i-exposed/commits/main)

**The on-chain privacy scanner you were afraid to run.**

Paste a Bitcoin address, transaction ID, xpub/descriptor, or unsigned PSBT. Get a privacy score 0-100. Find out what the blockchain reveals about you - before someone else does.

*Because Chainalysis already checked.*

[Live Site](https://am-i.exposed) | [Methodology](https://am-i.exposed/methodology/) | [Privacy Guide](https://am-i.exposed/guide/) | [Setup Guide](https://am-i.exposed/setup-guide/) | [Contributing](CONTRIBUTING.md)

---

## Why this exists

In April 2024, [OXT.me](https://oxt.me) and [KYCP.org](https://kycp.org) went offline following the arrest of the Samourai Wallet developers. OXT was the gold standard for Boltzmann entropy analysis. KYCP made CoinJoin privacy assessment accessible to ordinary users. Both are gone.

**am-i.exposed** fills that gap and goes further: 31 heuristics, multi-hop chain tracing, entity matching against 30M+ known addresses, real Boltzmann entropy computed on-device via WebAssembly, interactive graph exploration, wallet-level auditing, and pre-broadcast PSBT analysis. All client-side. No backend. No tracking.

For the full technical deep-dive - every heuristic, scoring weight, academic reference, threat model, and competitor analysis - see [`privacy-engine.md`](./docs/privacy-engine.md).

## How it works

1. Paste a Bitcoin address, txid, xpub/descriptor, or PSBT
2. Your browser fetches transaction data from the mempool.space API
3. 31 heuristics, 14 chain analysis modules, and entity matching against 364 known services run client-side
4. Boltzmann entropy is computed on-device using a Rust/WASM engine
5. You get a privacy score (0-100), letter grade, detailed findings, and actionable recommendations

## Privacy disclosure

**Your queries are not fully private.** Analysis runs client-side, but your browser makes API requests to [mempool.space](https://mempool.space) to fetch blockchain data. Their servers can see your IP address and which addresses/transactions you look up.

For stronger privacy:
- Use **Tor Browser** - the tool auto-detects Tor and routes API requests through the mempool.space `.onion` endpoint
- Use a **trusted, no-log VPN**
- **Wait** before querying a recent transaction (timing correlation is a real risk)
- **Self-host** with your own mempool.space instance and [Umbrel](#self-hosting)

There is no am-i.exposed backend. No analytics. No cookies. No tracking. The static site is served from GitHub Pages and has zero visibility into what is analyzed. See the [Operational Security Concerns](./docs/privacy-engine.md#operational-security-concerns) section of the privacy engine docs for the full threat model.

## Privacy score

| Grade | Score | Meaning |
|-------|-------|---------|
| A+ | 90-100 | Excellent - you know what you're doing |
| B | 75-89 | Good - minor issues |
| C | 50-74 | Fair - notable concerns |
| D | 25-49 | Poor - significant exposure |
| F | 0-24 | Critical - you might as well use Venmo |

Scoring starts at a base of 70. Each heuristic applies a positive or negative modifier. The sum is clamped to 0-100. Only CoinJoin participation, Taproot usage, and high entropy can raise the score. Everything else can only lower it.

## What it checks

### Transaction analysis (paste a txid)

**Core privacy heuristics**

| Heuristic | What it detects |
|-----------|----------------|
| Round amount detection | Round BTC/sat outputs that reveal payment vs change |
| Change detection | Address type mismatch, unnecessary inputs, round-amount change, output ordering |
| Common input ownership (CIOH) | Multi-input txs that link all your addresses to the same entity |
| Script type mix | Mixed address types across inputs/outputs that distinguish sender from recipient |
| Fee analysis | Round fee rates and RBF signaling that narrow wallet identification |
| Unnecessary input | Inputs that weren't needed to cover the output, exposing extra UTXOs |

**CoinJoin and mixing**

| Heuristic | What it detects |
|-----------|----------------|
| CoinJoin detection | Whirlpool (5 equal outputs), WabiSabi (20+ I/O), JoinMarket (maker/taker) |
| Post-mix analysis | Spending behavior after CoinJoin that undoes privacy gains |
| CoinJoin premix | Tx0 pre-mix transactions and their privacy implications |
| Anonymity set estimation | How large the set of indistinguishable participants is |

**Structural patterns**

| Heuristic | What it detects |
|-----------|----------------|
| Peel chain detection | Sequential self-transfers that slowly drain a wallet |
| Consolidation | Fan-in transactions merging UTXOs (links all addresses) |
| Exchange patterns | Deposit/withdrawal patterns typical of centralized exchanges |
| Entity detection | Matching against 364 known entities (exchanges, mixers, darknet, gambling) |
| Coin selection | Algorithm fingerprints (largest-first, knapsack, branch-and-bound) |

**Metadata and fingerprinting**

| Heuristic | What it detects |
|-----------|----------------|
| OP_RETURN metadata | Permanent embedded data (Omni, OpenTimestamps, Runes, ASCII text) |
| Wallet fingerprinting | nLockTime, nVersion, nSequence, BIP69 ordering, low-R signatures |
| Witness analysis | Witness structure patterns that identify wallet software |
| BIP47 notification | Payment code notification transactions |
| Multisig/escrow | P2SH and P2WSH multisig patterns |
| Coinbase detection | Mining reward transactions (structurally different from regular txs) |

**Entropy**

| Heuristic | What it detects |
|-----------|----------------|
| Boltzmann entropy (WASM) | Full link probability matrix computed on-device via Rust/WebAssembly - how many valid interpretations of the transaction exist, and the exact probability of each input-output link |

### Address analysis (paste an address)

| Heuristic | What it detects |
|-----------|----------------|
| Address reuse | The #1 privacy killer - harshest penalty in the model |
| UTXO set exposure | Dust attack detection (<1000 sats), consolidation risk, UTXO count |
| Address type | P2TR (Taproot) > P2WPKH (SegWit) > P2SH > P2PKH (Legacy) |
| Spending patterns | How funds have moved through the address over time |
| Recurring payments | Repeated payments to the same destination (routine detection) |
| High activity | Addresses with unusually high transaction counts |

### Chain analysis (multi-hop tracing)

| Module | What it does |
|--------|-------------|
| Backward tracing | Follows inputs upstream to discover fund origins |
| Forward tracing | Follows outputs downstream to track where funds went |
| Entity proximity | Detects known entities (exchanges, mixers, darknet markets) within N hops |
| Taint analysis | Proportional (haircut) method tracking value flow through the tx graph |
| UTXO clustering | Groups addresses by common-input-ownership across the tx graph |
| Peel chain tracing | Follows sequential self-transfers to map wallet drain patterns |
| Temporal analysis | Time-based patterns across transaction history |
| Spending patterns | Behavioral patterns in how outputs are spent |
| CoinJoin quality | Structural analysis of CoinJoin effectiveness |
| JoinMarket analysis | JoinMarket-specific maker/taker detection |
| Linkability scoring | Cross-tx linkability assessment |
| Prospective analysis | Forward-looking risk assessment of unspent outputs |

### Entity detection

Transactions and addresses are checked against a database of **364 known entities** across 8 categories:

| Category | Count | Examples |
|----------|-------|---------|
| Exchanges | 169 | Binance, Coinbase, Kraken, Bitfinex, Bitstamp |
| Payment services | 50 | BitPay, BTCPay, payment processors |
| Gambling | 43 | Known gambling platforms |
| Scams | 29 | Identified scam operations |
| Darknet markets | 28 | Silk Road, Hydra, and others |
| Mining pools | 24 | F2Pool, AntPool, Foundry |
| Mixers | 11 | Bitcoin Fog, ChipMixer, and others |
| P2P exchanges | 10 | Bisq, Paxful, HodlHodl |

The full entity index covers **30M+ addresses** using a priority-budgeted binary index. High-priority entities (OFAC-listed, darknet markets) get 100% named coverage. The core index (~0.4 MB) loads instantly; the full index (~92 MB) is available for deep scans.

### Wallet analysis (paste an xpub or descriptor)

Full wallet-level privacy audit with BIP44/49/84/86 derivation support. Scans derived addresses across the gap limit and produces an aggregate privacy assessment covering address reuse, UTXO hygiene, spending patterns, fingerprint consistency, and consolidation history.

### PSBT analysis (paste an unsigned PSBT)

Pre-broadcast privacy check. Analyze a transaction before signing to catch privacy issues while they can still be fixed - round amounts, script type mismatches, change detection, and wallet fingerprinting.

### Cross-heuristic intelligence

The engine doesn't run heuristics in isolation. CoinJoin detection suppresses CIOH and round-amount penalties. Multisig patterns are recognized so that CIOH isn't falsely applied. Findings interact and inform each other.

## Visualizations

| Chart | Description |
|-------|-------------|
| Transaction flow (Sankey) | Input-to-output flow diagram with optional Boltzmann linkability overlay |
| Link probability heatmap | Full Boltzmann matrix showing the probability of each input-output link |
| Graph explorer | OXT-style interactive transaction DAG - expand, collapse, and trace through the graph |
| Taint path diagram | Value flow visualization showing how taint propagates through transactions |
| Cluster timeline | Temporal activity chart for address transaction history |
| CoinJoin structure | Pool composition breakdown for Whirlpool, WabiSabi, and JoinMarket transactions |
| Score waterfall | Step-by-step breakdown of how the privacy score was calculated |
| UTXO bubble chart | Visual clustering of unspent outputs by value and age |
| Severity ring | Distribution of findings by severity level |

## Tech

- **Next.js 16** static export - no server, hosted on GitHub Pages
- **Client-side analysis** - all heuristics, chain analysis, and entity matching run in your browser
- **Boltzmann WASM** - Rust-compiled WebAssembly engine computing real link probability matrices on-device, using all threads, with turbo paths for JoinMarket and more
- **IndexedDB cache** - confirmed transactions, outspends, and analysis results are cached locally across sessions. Repeat scans are instant, API requests are minimized, and fewer queries leave your browser
- **mempool.space API** only - no secondary APIs, your queries stay with one provider
- **Tor-aware** - auto-detects `.onion` and routes API requests through Tor
- **TypeScript** strict mode throughout
- **Tailwind CSS 4** - dark theme
- **visx** - interactive SVG visualizations (graph explorer, taint diagrams, timelines)
- **@scure/btc-signer** - PSBT parsing and raw transaction decoding
- **i18next** - 5 languages (English, Spanish, Portuguese, German, French)
- **PWA** - installable, works offline after first load
- **844+ tests** - Vitest unit/integration + Playwright E2E

## Self-hosting

### Umbrel

am-i.exposed is available as an Umbrel app, connecting directly to your own Bitcoin node and mempool.space instance for maximum privacy - no third-party API requests.

See [`docs/deploy-umbrel.md`](./docs/deploy-umbrel.md) for setup instructions.

### Custom mempool.space instance

Point the tool at any mempool.space-compatible API by configuring the API URL in settings. Supports self-hosted instances, eliminating all third-party data exposure.

## Internationalization

Available in 5 languages:

- English (default)
- Spanish (Castilian)
- Portuguese
- German
- French

Translations live in `public/locales/`. Contributions for additional languages are welcome.

## Development

```bash
pnpm install
pnpm dev          # Dev server on :3000
pnpm build        # Static export to out/
pnpm lint         # ESLint (must be 0 errors)
pnpm test         # 844+ tests (Vitest)
pnpm build:wasm   # Rebuild Boltzmann WASM from Rust source
```

See [`docs/development-guide.md`](./docs/development-guide.md) for architecture, component tree, and state management details. See [`docs/testing-reference.md`](./docs/testing-reference.md) for example transactions and expected scores.

## Research & Acknowledgments

The privacy engine is built on foundational research by the Bitcoin privacy community:

- **LaurentMT** - Creator of the Boltzmann entropy framework for Bitcoin transactions. His research series "Bitcoin Transactions & Privacy" (Parts 1-3, ~2015) defined transaction entropy E = log2(N), link probability matrices, and the mathematical tools that underpin all modern transaction privacy analysis. His [Boltzmann tool](https://github.com/Samourai-Wallet/boltzmann) was the first implementation to compute these metrics. The entropy heuristic (H5) and WASM link probability engine are direct implementations of his work.

- **Greg Maxwell** - Inventor of [CoinJoin](https://bitcointalk.org/index.php?topic=279249.0) (2013). The original CoinJoin proposal inspired the entire ecosystem of collaborative transactions and directly motivated the entropy framework. The CIOH (H3), CoinJoin detection (H4), and entropy (H5) heuristics all trace back to concepts he introduced.

- **OXT Research / ErgoBTC** - "Understanding Bitcoin Privacy with OXT" 4-part series (2021). Comprehensive educational guide covering change detection, transaction graphs, wallet clustering, CIOH, and defensive measures. Directly informed heuristic implementations and user-facing explanations. Archived at: [Part 1](https://archive.ph/1xAw7), [Part 2](https://archive.ph/TDvjy), [Part 3](https://archive.ph/suxyq), [Part 4](https://archive.ph/Aw6zC).

- **Kristov Atlas** - CoinJoin Sudoku research, referenced by LaurentMT as foundational for deterministic link detection.

- **Spiral BTC** - "The Scroll #3: A Brief History of Wallet Clustering" - historical survey of chain analysis from 2011-2024, covering the evolution from naive CIOH to wallet fingerprinting with ML.

- **Academic researchers**: Meiklejohn et al. ("A Fistful of Bitcoins"), Moser & Narayanan ("Resurrecting Address Clustering"), Kappos et al. ("How to Peel a Million"), Reid & Harriman (2011), Ron & Shamir (2012).

- **privacidadbitcoin.com** - Spanish-language Bitcoin privacy education. Community entropy calculation reference that helped identify a counting error in the original implementation.

See [`research-boltzmann-entropy.md`](./docs/research-boltzmann-entropy.md) for the full research reference and [`privacy-engine.md`](./docs/privacy-engine.md) for the technical documentation.

## Support

am-i.exposed is free, open-source, and funded entirely by voluntary contributions. No ads, no subscriptions, no token.

**Lightning:** `woozycuticle72@walletofsatoshi.com`

**Nostr zap:** `npub14n4e3dnxcumh7kexfgunp86dzhtjcfewe40g4qm6yfl3kf9ute2q5jqr48`

## Authors

- **Copexit** - Development & Architecture
- **Arkad** ([@multicripto](https://x.com/multicripto)) - Co-author (Research & UX)

## License

MIT
