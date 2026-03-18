# am-i-exposed - Bitcoin Privacy Scanner CLI

Analyze Bitcoin transactions, addresses, wallets, and PSBTs for chain analysis exposure. Runs 32 transaction heuristics, 12 chain analysis modules, Boltzmann entropy computation (Rust/WASM), and entity matching against 364+ known entities.

All analysis runs locally. Only mempool.space API calls are made for blockchain data. PSBT analysis requires zero network access.

## Installation

```bash
npm install -g am-i-exposed
# or run without installing:
npx am-i-exposed <command>
```

Requires Node.js >= 20.

## Commands

### Scan Transaction

```bash
am-i-exposed scan tx <txid> [--json] [--network mainnet|testnet4|signet] [--api <url>] [--chain-depth N] [--min-sats N]
```

Runs all 32 transaction heuristics including CoinJoin detection, change detection, wallet fingerprinting, entity detection, entropy analysis, and more. Returns a privacy score (0-100), grade (A+/B/C/D/F), findings array, and transaction type classification.

**When to use:** Evaluate the privacy of any confirmed or mempool transaction. Use `--chain-depth 3` to also trace the transaction graph for entity proximity and taint analysis.

### Scan Address

```bash
am-i-exposed scan address <addr> [--json] [--network mainnet|testnet4|signet] [--api <url>]
```

Analyzes address reuse, UTXO hygiene, spending patterns, entity identification, temporal correlation, and fingerprint evolution.

**When to use:** Evaluate whether an address has been exposed to chain analysis. Check before sending funds to an address.

### Scan Wallet (xpub/zpub)

```bash
am-i-exposed scan xpub <zpub|xpub|descriptor> [--json] [--gap-limit N] [--network mainnet|testnet4|signet]
```

Derives addresses from extended public key or output descriptor, scans each for activity, and runs a wallet-level privacy audit covering address reuse, UTXO hygiene, toxic change, consolidation history, and script type consistency.

**When to use:** Audit an entire wallet's privacy posture. Especially useful before consolidation or migration.

### Scan PSBT (Pre-Broadcast)

```bash
am-i-exposed scan psbt <file_path_or_base64> [--json]
```

Analyzes an unsigned or partially signed transaction BEFORE broadcasting. Requires zero network access - all analysis is performed on the PSBT data directly. This is the key feature for AI agents crafting transactions.

**When to use:** Check if a transaction you're about to broadcast will have good privacy. If grade is D or F, modify coin selection and retry.

### Boltzmann Analysis

```bash
am-i-exposed boltzmann <txid> [--json] [--timeout N] [--intrafees-ratio N]
```

Computes Boltzmann entropy (bits), wallet efficiency (0-100%), link probability matrix, and deterministic links using a Rust/WASM implementation. Requires 2+ inputs.

**When to use:** Deep analysis of how linkable inputs and outputs are. Higher entropy = better privacy. Efficiency shows how close to a perfect CoinJoin structure.

### Chain Trace

```bash
am-i-exposed chain-trace <txid> [--json] [--direction backward|forward|both] [--depth N] [--min-sats N] [--skip-coinjoins]
```

Multi-hop transaction graph analysis. Traces backward (input provenance) and/or forward (output destinations) up to N hops. Runs entity proximity detection, taint analysis, clustering, and spending pattern analysis on the discovered graph.

**When to use:** Investigate where funds came from or where they went. Detect known entities (exchanges, mixers, darknet markets) within N hops.

## Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Structured JSON output (suppresses spinner and colors) |
| `--network <net>` | `mainnet` (default), `testnet4`, or `signet` |
| `--api <url>` | Custom mempool API URL |
| `--no-entities` | Skip entity filter loading (faster startup) |
| `--no-color` | Disable colored output |

## JSON Output Schema

All commands with `--json` return a consistent envelope:

```json
{
  "version": "0.33.0",
  "input": { "type": "txid|address|xpub|psbt", "value": "..." },
  "network": "mainnet",
  "score": 95,
  "grade": "A+",
  "txType": "whirlpool-coinjoin",
  "findings": [
    {
      "id": "h4-whirlpool-coinjoin",
      "severity": "good|low|medium|high|critical",
      "title": "Human-readable finding title",
      "description": "Detailed explanation",
      "recommendation": "Actionable advice",
      "scoreImpact": 30,
      "confidence": "deterministic|high|medium|low",
      "params": { "key": "value" }
    }
  ],
  "recommendation": {
    "id": "post-coinjoin-hygiene",
    "urgency": "immediate|soon|when-convenient",
    "headline": "...",
    "detail": "...",
    "tools": [{ "name": "Sparrow Wallet", "url": "https://sparrowwallet.com" }]
  }
}
```

### Grades

| Grade | Score Range | Meaning |
|-------|------------|---------|
| A+ | >= 90 | Excellent privacy |
| B | 75-89 | Good privacy |
| C | 50-74 | Moderate exposure |
| D | 25-49 | Poor privacy |
| F | < 25 | Severe exposure |

### Severity Levels

| Severity | Meaning |
|----------|---------|
| `critical` | Deterministic privacy failure (e.g., address reuse across 90+ txs) |
| `high` | Strong heuristic match (e.g., obvious change output, known entity) |
| `medium` | Moderate concern (e.g., round amounts, script type mixing) |
| `low` | Minor observation (e.g., wallet fingerprint, BIP69 ordering) |
| `good` | Positive privacy practice (e.g., CoinJoin detected, uniform scripts) |

### Transaction Types

The `txType` field classifies the transaction:

`whirlpool-coinjoin`, `wabisabi-coinjoin`, `joinmarket-coinjoin`, `generic-coinjoin`, `stonewall`, `simplified-stonewall`, `tx0-premix`, `bip47-notification`, `ricochet`, `consolidation`, `exchange-withdrawal`, `batch-payment`, `self-transfer`, `peel-chain`, `coinbase`, `simple-payment`, `unknown`

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Runtime error (network failure, API error, timeout) |
| 2 | Invalid input (bad txid, invalid address, unparseable PSBT) |

## Agent Workflows

### Pre-broadcast privacy check

```bash
# 1. Craft transaction, export as PSBT
# 2. Check privacy before broadcasting
am-i-exposed scan psbt /tmp/proposed-tx.psbt --json

# 3. Parse result
# If .grade is "D" or "F" - modify coin selection, add outputs, or use CoinJoin
# If .grade is "A+" or "B" - safe to broadcast
```

### Transaction forensics

```bash
# Quick scan
am-i-exposed scan tx <txid> --json

# Deep scan with 3-hop chain trace
am-i-exposed scan tx <txid> --json --chain-depth 3

# Check .findings for entity proximity, taint, clustering
# Check .txType for transaction classification
```

### Wallet health audit

```bash
am-i-exposed scan xpub <zpub> --json --gap-limit 30

# Key fields to check:
# .walletInfo.reusedAddresses - should be 0
# .walletInfo.dustUtxos - should be 0
# .grade - should be B or better
```

### Privacy-optimal coin selection

```bash
# For each candidate PSBT:
am-i-exposed scan psbt candidate1.psbt --json | jq '.score'
am-i-exposed scan psbt candidate2.psbt --json | jq '.score'
# Select the PSBT with the highest score, then sign and broadcast
```

### Boltzmann comparison

```bash
# Compare entropy of different transactions
am-i-exposed boltzmann <txid1> --json | jq '.boltzmann.entropy'
am-i-exposed boltzmann <txid2> --json | jq '.boltzmann.entropy'
# Higher entropy = more ambiguous = better privacy
```

### Entity proximity check

```bash
am-i-exposed chain-trace <txid> --json --depth 3 --direction backward

# Check .trace.findings for entity proximity warnings
# Check if known exchanges, mixers, or flagged entities are within N hops
```

## Privacy Notes

- No addresses or transaction IDs are logged or persisted by the CLI
- Entity detection uses bundled data files (~92MB), no external APIs
- PSBT analysis requires zero network access
- Only mempool.space API is used for blockchain data (or your custom --api endpoint)
- All analysis runs locally on your machine
