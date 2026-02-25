# Am I Exposed?

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/Copexit/am-i-exposed.svg)](https://github.com/Copexit/am-i-exposed/stargazers)
[![GitHub last commit](https://img.shields.io/github/last-commit/Copexit/am-i-exposed.svg)](https://github.com/Copexit/am-i-exposed/commits/main)

**The on-chain privacy scanner you were afraid to run.**

Paste a Bitcoin address or transaction ID. Get a privacy score 0-100. Find out what the blockchain knows about you.

*Because Chainalysis already checked.*

[Live Site](https://am-i.exposed) | [Methodology](https://am-i.exposed/methodology/) | [Setup Guide](https://am-i.exposed/setup-guide/) | [Contributing](CONTRIBUTING.md)

---

## Why this exists

In April 2024, [OXT.me](https://oxt.me) and [KYCP.org](https://kycp.org) went offline following the arrest of the Samourai Wallet developers. OXT was the gold standard for Boltzmann entropy analysis. KYCP made CoinJoin privacy assessment accessible to ordinary users. Both are gone.

As of today, there is no publicly available tool that combines entropy estimation, wallet fingerprinting detection, CoinJoin pattern recognition, and dust attack warnings in a single interface. **am-i.exposed** fills that gap.

For the full technical deep-dive  - every heuristic, scoring weight, academic reference, threat model, and competitor analysis  - see [`privacy-engine.md`](./docs/privacy-engine.md).

## How it works

1. Paste a Bitcoin address or txid
2. Your browser fetches transaction data from the mempool.space API
3. All 12 heuristics run client-side in your browser
4. You get a privacy score (0-100), letter grade, and detailed findings with recommendations

## Privacy disclosure

**Your queries are not fully private.** Analysis runs client-side, but your browser makes API requests to [mempool.space](https://mempool.space) to fetch blockchain data. Their servers can see your IP address and which addresses/transactions you look up.

For stronger privacy:
- Use **Tor Browser**  - the tool auto-detects Tor and routes API requests through the mempool.space `.onion` endpoint
- Use a **trusted, no-log VPN**
- **Wait** before querying a recent transaction (timing correlation is a real risk)

There is no am-i.exposed backend. No analytics. No cookies. No tracking. The static site is served from GitHub Pages and has zero visibility into what you analyze. See the [Operational Security Concerns](./docs/privacy-engine.md#operational-security-concerns) section of the privacy engine docs for the full threat model.

## Privacy score

| Grade | Score | Meaning |
|-------|-------|---------|
| A+ | 90-100 | Excellent  - you know what you're doing |
| B | 75-89 | Good  - minor issues |
| C | 50-74 | Fair  - notable concerns |
| D | 25-49 | Poor  - significant exposure |
| F | 0-24 | Critical  - you might as well use Venmo |

Scoring starts at a base of 70. Each heuristic applies a positive or negative modifier. The sum is clamped to 0-100. Only CoinJoin participation, Taproot usage, and high entropy can raise the score. Everything else can only lower it.

## What it checks

### Transaction analysis (paste a txid)

| Heuristic | What it detects |
|-----------|----------------|
| **Round amount detection** | Round BTC/sat outputs that reveal payment vs change |
| **Change detection** | Address type mismatch, unnecessary inputs, round-amount change, output ordering |
| **Common input ownership (CIOH)** | Multi-input txs that link all your addresses to the same entity |
| **CoinJoin detection** | Whirlpool, Wasabi/WabiSabi, and JoinMarket patterns  - the only positive signal |
| **Entropy (Boltzmann)** | Partition-based Boltzmann entropy  - how many valid interpretations exist |
| **Fee analysis** | Round fee rates and RBF signaling that narrow wallet identification |
| **OP_RETURN metadata** | Permanent embedded data (Omni, OpenTimestamps, Runes, ASCII text) |
| **Wallet fingerprinting** | nLockTime, nVersion, nSequence, BIP69 ordering, low-R signatures  - identifies wallet software |
| **Script type mix** | Mixed address types across inputs/outputs that distinguish sender from recipient |
| **Anonymity set estimation** | How large the set of indistinguishable participants is |
| **Timing analysis** | Transaction patterns that correlate with off-chain behavior |

### Address analysis (paste an address)

| Heuristic | What it detects |
|-----------|----------------|
| **Address reuse** | The #1 privacy killer  - harshest penalty in the model |
| **UTXO set exposure** | Dust attack detection (<1000 sats), consolidation risk, UTXO count |
| **Address type** | P2TR (Taproot) > P2WPKH (SegWit) > P2SH > P2PKH (Legacy) |
| **Spending patterns** | How funds have moved through the address over time |

### Cross-heuristic intelligence

The engine doesn't run heuristics in isolation. CoinJoin detection suppresses CIOH and round-amount penalties. PayJoin patterns are recognized so that CIOH isn't falsely applied. Findings interact and inform each other.

## Tech

- **Next.js 16** static export  - no server, hosted on GitHub Pages
- **Client-side analysis**  - heuristics run in your browser, not on a server
- **mempool.space API** primary, **Blockstream Esplora** fallback (mainnet only)
- **Tor-aware**  - auto-detects `.onion` and routes API requests through Tor
- **TypeScript** throughout
- **Tailwind CSS 4**  - dark theme
- **PWA**  - installable, works offline (after first load)
- **bitcoinjs-lib**  - raw transaction parsing for wallet fingerprinting

## Development

```bash
pnpm install
pnpm dev
```

Lint:
```bash
pnpm lint
```

Build (static export to `out/`):
```bash
pnpm build
```

See [`testing-reference.md`](./docs/testing-reference.md) for example transactions and expected scores.

## Research & Acknowledgments

The privacy engine is built on foundational research by the Bitcoin privacy community:

- **LaurentMT** - Creator of the Boltzmann entropy framework for Bitcoin transactions. His research series "Bitcoin Transactions & Privacy" (Parts 1-3, ~2015) defined transaction entropy E = log2(N), link probability matrices, and the mathematical tools that underpin all modern transaction privacy analysis. His [Boltzmann tool](https://github.com/Samourai-Wallet/boltzmann) was the first implementation to compute these metrics. Our entropy heuristic (H5) is a direct implementation of his work.

- **Greg Maxwell** - Inventor of [CoinJoin](https://bitcointalk.org/index.php?topic=279249.0) (2013). The original CoinJoin proposal inspired the entire ecosystem of collaborative transactions and directly motivated the entropy framework. Our CIOH (H3), CoinJoin detection (H4), and entropy (H5) heuristics all trace back to concepts he introduced.

- **OXT Research / ErgoBTC** - "Understanding Bitcoin Privacy with OXT" 4-part series (2021). Comprehensive educational guide covering change detection, transaction graphs, wallet clustering, CIOH, and defensive measures. Directly informed our heuristic implementations and user-facing explanations. Archived at: [Part 1](https://archive.ph/1xAw7), [Part 2](https://archive.ph/TDvjy), [Part 3](https://archive.ph/suxyq), [Part 4](https://archive.ph/Aw6zC).

- **Kristov Atlas** - CoinJoin Sudoku research, referenced by LaurentMT as foundational for deterministic link detection.

- **Spiral BTC** - "The Scroll #3: A Brief History of Wallet Clustering"  - historical survey of chain analysis from 2011-2024, covering the evolution from naive CIOH to wallet fingerprinting with ML.

- **Academic researchers**: Meiklejohn et al. ("A Fistful of Bitcoins"), Moser & Narayanan ("Resurrecting Address Clustering"), Kappos et al. ("How to Peel a Million"), Reid & Harriman (2011), Ron & Shamir (2012).

- **privacidadbitcoin.com** - Spanish-language Bitcoin privacy education. Community entropy calculation reference that helped identify a counting error in our original implementation.

See [`research-boltzmann-entropy.md`](./docs/research-boltzmann-entropy.md) for the full research reference and [`privacy-engine.md`](./docs/privacy-engine.md) for the technical documentation.

## Authors

- **Copexit** - Development & Architecture
- **Arkad** ([@multicripto](https://x.com/multicripto)) - Co-author (Research & UX)

## License

MIT
