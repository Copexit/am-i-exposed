# am-i-exposed

Bitcoin privacy scanner for the command line. Analyze transactions, addresses, wallets, and PSBTs for chain analysis exposure.

```bash
npx am-i-exposed scan tx <txid> --json
```

32 transaction heuristics, 12 chain analysis modules, Boltzmann entropy (Rust/WASM), entity matching against 364+ known entities (30M+ addresses). All analysis runs locally.

[Web App](https://am-i.exposed) | [Agent Docs](https://am-i.exposed/agents/) | [Source](https://github.com/Copexit/am-i-exposed)

## Install

```bash
npm install -g am-i-exposed
```

Requires Node.js >= 20. Or use `npx am-i-exposed` without installing.

## Commands

```bash
# Transaction privacy scan (25 heuristics + entity detection)
am-i-exposed scan tx <txid> --json

# Address exposure analysis
am-i-exposed scan address <addr> --json

# Wallet audit via xpub/zpub/descriptor
am-i-exposed scan xpub <zpub> --json

# PSBT analysis BEFORE broadcasting (zero network access)
am-i-exposed scan psbt <file_or_base64> --json

# Boltzmann entropy + link probability matrix
am-i-exposed boltzmann <txid> --json

# Multi-hop chain tracing (entity proximity, taint)
am-i-exposed chain-trace <txid> --depth 3 --json

# MCP server for AI agents (Claude Desktop, Cline, etc.)
am-i-exposed mcp
```

## Flags

| Flag | Description |
|------|-------------|
| `--json` | Structured JSON output |
| `--fast` | Skip parent tx context (~6s instead of ~10s) |
| `--network <net>` | `mainnet` / `testnet4` / `signet` |
| `--api <url>` | Custom mempool API (self-hosted, Umbrel) |
| `--no-cache` | Disable SQLite response caching |
| `--no-entities` | Skip entity filter loading |

## JSON Output

All commands with `--json` return:

```json
{
  "score": 95,
  "grade": "A+",
  "txType": "whirlpool-coinjoin",
  "findings": [
    {
      "id": "h4-whirlpool",
      "severity": "good",
      "title": "Whirlpool CoinJoin detected",
      "scoreImpact": 30,
      "confidence": "deterministic"
    }
  ],
  "recommendation": {
    "urgency": "when-convenient",
    "headline": "Maintain UTXO separation"
  }
}
```

## Grades

| Grade | Score | Meaning |
|-------|-------|---------|
| **A+** | 90-100 | Excellent privacy |
| **B** | 75-89 | Good privacy |
| **C** | 50-74 | Moderate exposure |
| **D** | 25-49 | Poor privacy |
| **F** | 0-24 | Severe exposure |

## Agent Integration

### CLI (any agent)

```bash
npx am-i-exposed scan tx <txid> --json | jq '.grade'
```

### MCP Server (Claude Desktop, Claude Code, Cline)

```json
{
  "mcpServers": {
    "bitcoin-privacy": {
      "command": "npx",
      "args": ["-y", "am-i-exposed", "mcp"]
    }
  }
}
```

5 tools: `scan_transaction`, `scan_address`, `scan_psbt`, `scan_wallet`, `compute_boltzmann`

### Agent Workflows

**Pre-broadcast check** - analyze a PSBT before signing:
```bash
am-i-exposed scan psbt /tmp/tx.psbt --json
# If .grade is D or F, modify coin selection and retry
```

**Transaction forensics** - scan with chain tracing:
```bash
am-i-exposed scan tx <txid> --json --chain-depth 3
# Check .findings for entity proximity and taint
```

**Wallet audit** - check for address reuse and UTXO hygiene:
```bash
am-i-exposed scan xpub <zpub> --json --gap-limit 30
# .walletInfo.reusedAddresses should be 0
```

## Performance

| Mode | Time |
|------|------|
| `--fast --no-entities` | ~5s |
| Normal scan | ~10s |
| Cached (repeat) | ~1.5s |
| PSBT (offline) | <1s |
| Boltzmann | 2-15ms |

## What It Detects

**CoinJoin** - Whirlpool, WabiSabi, JoinMarket, Stonewall, generic equal-output

**Change detection** - address type mismatch, round amounts, unnecessary inputs, fresh addresses

**Wallet fingerprinting** - nLockTime, nSequence, BIP69, fee rate patterns, witness structure

**Entity detection** - 364 known entities (exchanges, darknet, mixers, gambling, mining) across 30M+ addresses

**Chain analysis** - backward/forward tracing, entity proximity, taint flow, UTXO clustering

**Structural** - peel chains, consolidations, batch payments, dust attacks, OP_RETURN metadata

**Entropy** - Boltzmann link probability matrix, wallet efficiency, deterministic link detection

## Privacy

- No addresses or transactions are logged or persisted
- Entity detection uses bundled data (~92 MB), no external APIs
- PSBT analysis requires zero network access
- Only mempool.space API is contacted for blockchain data
- Self-host with `--api http://your-node:8999/api`
- All analysis runs locally

## License

MIT
