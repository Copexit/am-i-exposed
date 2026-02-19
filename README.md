# Am I Exposed?

**The on-chain privacy scanner you were afraid to run.**

Paste a Bitcoin address or transaction ID. Get a privacy score 0-100. Find out what the blockchain knows about you.

*Because Chainalysis already checked.*

---

## Why this exists

In April 2024, [OXT.me](https://oxt.me) and [KYCP.org](https://kycp.org) went offline following the arrest of the Samourai Wallet developers. OXT was the gold standard for Boltzmann entropy analysis. KYCP made CoinJoin privacy assessment accessible to ordinary users. Both are gone.

As of today, there is no publicly available tool that combines entropy estimation, wallet fingerprinting detection, CoinJoin pattern recognition, and dust attack warnings in a single interface. **am-i.exposed** fills that gap.

For the full technical deep-dive  - every heuristic, scoring weight, academic reference, threat model, and competitor analysis  - see [`privacy_engine.md`](./privacy_engine.md).

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

There is no am-i.exposed backend. No analytics. No cookies. No tracking. The static site is served from GitHub Pages and has zero visibility into what you analyze. See the [Operational Security Concerns](./privacy_engine.md#operational-security-concerns) section of the privacy engine docs for the full threat model.

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
| **Entropy estimation** | Simplified Boltzmann  - how many valid input-output mappings exist |
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

See [`testing.md`](./testing.md) for example transactions and expected scores.

## License

MIT
