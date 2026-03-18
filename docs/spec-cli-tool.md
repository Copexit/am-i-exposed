# CLI Tool - Requirements & Roadmap

Build a Node.js CLI that wraps the existing am-i-exposed privacy analysis engine. Enables terminal usage, AI agent integration, and programmatic consumption without maintaining a second implementation.

---

## What

A CLI tool (`am-i-exposed`) that provides the full analysis engine from the command line:

1. **Scan transactions** - run all 25 tx heuristics + cross-heuristic rules + entity detection
2. **Scan addresses** - run 6 address heuristics + entity identification + temporal/fingerprint analysis
3. **Scan wallets** - xpub/zpub/descriptor derivation + wallet-level privacy audit
4. **Scan PSBTs** - analyze unsigned transactions BEFORE broadcasting (the killer agent use case)
5. **Boltzmann analysis** - entropy, efficiency, link probability matrix via Rust WASM
6. **Chain tracing** - multi-hop backward/forward analysis with entity proximity, taint, clustering

Published as `am-i-exposed` on npm. Runnable via `npx am-i-exposed <command>`.

## Why

The engine is already built - 32 tx heuristics, 12 chain modules, Boltzmann in Rust/WASM, entity matching with 364+ entities, wallet auditing. But it's locked inside a Next.js web app. A CLI unlocks:

- **AI agents**: Claude, GPT, custom agents can call `am-i-exposed scan psbt <file> --json` to evaluate transaction privacy before broadcasting. This is something no other tool offers.
- **Power users**: bitcoiners who live in the terminal, especially those using Sparrow, Bitcoin Core, or JoinMarket.
- **Automation**: CI pipelines, wallet software, privacy auditing scripts.
- **Composability**: pipe output to jq, combine with other tools, build workflows.

---

## Architecture

### Zero code duplication

The core engine in `src/lib/` is ~85% decoupled from React/browser. The CLI imports directly from `src/lib/` via the `@/` tsconfig path alias. All 844+ existing tests continue to cover the shared engine.

### What's already CLI-ready (zero changes needed)

| Module | File | Export | Pure? |
|--------|------|--------|-------|
| TX orchestrator | `src/lib/analysis/orchestrator.ts` | `analyzeTransaction(tx, rawHex?, onStep?, ctx?)` | Yes |
| Address orchestrator | `src/lib/analysis/orchestrator.ts` | `analyzeAddress(address, utxos, txs, onStep?)` | Yes |
| Pre-send analysis | `src/lib/analysis/address-orchestrator.ts` | `analyzeDestination(address, utxos, txs)` | Yes |
| Cross-heuristic rules | `src/lib/analysis/cross-heuristic.ts` | `applyCrossHeuristicRules(findings)` | Yes |
| TX classification | `src/lib/analysis/cross-heuristic.ts` | `classifyTransactionType(findings)` | Yes |
| Scoring | `src/lib/scoring/score.ts` | `calculateScore(findings, mode?)` | Yes |
| Wallet audit | `src/lib/analysis/wallet-audit.ts` | `auditWallet(addresses)` | Yes |
| Recommendations | `src/lib/recommendations/primary-recommendation.ts` | `selectRecommendations(ctx)` | Yes |
| Mempool client | `src/lib/api/mempool.ts` | `createMempoolClient(baseUrl, options?)` | Yes |
| Fetch with retry | `src/lib/api/fetch-with-retry.ts` | `fetchWithRetry(url, options)` | Yes |
| PSBT parser | `src/lib/bitcoin/psbt.ts` | `parsePSBT(input)`, `isPSBT(input)` | Yes |
| Descriptor parser | `src/lib/bitcoin/descriptor.ts` | `parseXpub(str)`, `deriveOneAddress(parsed, chain, index)` | Yes |
| Address validation | `src/lib/bitcoin/address-type.ts` | `getAddressType(addr)` | Yes |
| Entity matching | `src/lib/analysis/entity-filter/entity-match.ts` | `matchEntities(tx)`, `matchEntitySync(addr)` | Yes |
| Backward trace | `src/lib/analysis/chain/recursive-trace.ts` | `traceBackward(tx, depth, minSats, fetcher, ...)` | Yes |
| Forward trace | `src/lib/analysis/chain/recursive-trace.ts` | `traceForward(tx, depth, minSats, fetcher, ...)` | Yes |
| Entity proximity | `src/lib/analysis/chain/entity-proximity.ts` | `analyzeEntityProximity(tx, backward, forward)` | Yes |
| Taint analysis | `src/lib/analysis/chain/taint.ts` | `analyzeBackwardTaint(tx, layers)` | Yes |
| Clustering | `src/lib/analysis/chain/clustering.ts` | `buildCluster(tx, layers)` | Yes |
| Spending patterns | `src/lib/analysis/chain/spending-patterns.ts` | `analyzeSpendingPatterns(tx, layers)` | Yes |
| Linkability | `src/lib/analysis/chain/linkability.ts` | `buildLinkabilityMatrix(tx)` | Yes |
| JoinMarket analysis | `src/lib/analysis/chain/joinmarket.ts` | `analyzeJoinMarket(tx)` | Yes |
| Peel chain trace | `src/lib/analysis/chain/peel-chain-trace.ts` | `tracePeelChain(tx, ...)` | Yes |
| Temporal analysis | `src/lib/analysis/chain/temporal.ts` | `analyzeTemporalCorrelation(txs)` | Yes |
| Prospective analysis | `src/lib/analysis/chain/prospective.ts` | `analyzeFingerprintEvolution(addr, txs)` | Yes |
| CoinJoin quality | `src/lib/analysis/chain/coinjoin-quality.ts` | `evaluateCoinJoinQuality(tx, ...)` | Yes |
| Format utilities | `src/lib/format.ts` | `formatSats()`, `fmtN()`, `formatBtc()` | Yes |
| Constants | `src/lib/constants.ts` | `WHIRLPOOL_DENOMS`, `DUST_THRESHOLD`, etc. | Yes |
| Types | `src/lib/types.ts` | `Finding`, `ScoringResult`, `Grade`, `Severity`, `TxType` | Yes |

### What needs adapter patches (3 modules)

#### 1. Entity filter loader - filesystem access

**Problem**: `src/lib/analysis/entity-filter/filter-loader.ts` lines 25-27 hardcode `/data/entity-index.bin` paths and use browser `fetch()` to load them.

**Solution**: Add a `configureDataLoader()` export that accepts a custom fetch function. ~15 lines, fully backwards-compatible.

```typescript
// Add to filter-loader.ts (backwards-compatible)
let fetchOverride: ((url: string) => Promise<ArrayBuffer | null>) | null = null;

export function configureDataLoader(opts: {
  fetchFn?: (url: string) => Promise<ArrayBuffer | null>;
}) {
  fetchOverride = opts.fetchFn ?? null;
}
```

The internal `fetchArrayBuffer()` function checks `fetchOverride` before falling back to browser `fetch()`. The web app never calls `configureDataLoader()` and behaves identically. The CLI calls it at startup with a function that reads `.bin` files from the bundled `cli/data/` directory via `fs.readFileSync()`.

#### 2. Cached client - bypass entirely

**Problem**: `src/lib/api/cached-client.ts` line 18 imports `getAnalysisSettings()` from a React hooks file that uses `useSyncExternalStore` and `localStorage`.

**Solution**: The CLI bypasses `cached-client.ts` entirely. It imports `createMempoolClient()` from `src/lib/api/mempool.ts` directly. Zero changes to existing code. See the "Filesystem Cache" section under Roadmap v1.1 for future caching.

#### 3. Boltzmann WASM - Node.js target

**Problem**: Boltzmann runs in a browser Web Worker (`public/workers/boltzmann.worker.js`) that uses `fetch()` with blob URLs, `import()` dynamic loading, and `self.postMessage`.

**Solution**: Build a second WASM target with `wasm-pack build --target nodejs`. This generates CommonJS bindings that use `require()` to load the `.wasm` file and work natively in Node.js - no Worker needed.

The Rust crate is unchanged. The `--target nodejs` flag is the only difference. New build script:

```bash
# scripts/build-boltzmann-wasm-node.sh
cd boltzmann-rs
wasm-pack build --target nodejs --release --out-dir ../cli/wasm
```

CLI wrapper (`cli/src/adapters/boltzmann-node.ts`) imports the generated bindings and calls `compute_boltzmann()` directly (no chunked DFS needed for a CLI - just run to completion).

---

## Project Structure

```
cli/
  package.json              # npm package: am-i-exposed
  tsconfig.json             # Extends root, drops "dom" lib, targets Node 20+
  src/
    index.ts                # #!/usr/bin/env node - commander entry point
    commands/
      scan-tx.ts            # scan tx <txid>
      scan-address.ts       # scan address <addr>
      scan-xpub.ts          # scan xpub <zpub|xpub|descriptor>
      scan-psbt.ts          # scan psbt <file|base64>
      boltzmann.ts          # boltzmann <txid>
      chain-trace.ts        # chain-trace <txid>
    adapters/
      settings.ts           # Static settings from CLI flags (replaces useAnalysisSettings)
      boltzmann-node.ts     # WASM-in-Node wrapper (replaces Web Worker)
    output/
      formatter.ts          # Human-readable colored terminal output
      json.ts               # Structured JSON envelope
      colors.ts             # chalk severity color mapping
    util/
      data-dir.ts           # Resolves bundled data/ path via import.meta.url
      progress.ts           # ora spinner, suppressed with --json
  data/                     # Symlink -> ../public/data/ (entity .bin files, ~92MB)
  wasm/                     # Node.js WASM bindings (built by wasm-pack --target nodejs)
  skill.md                  # AI agent integration doc
```

---

## CLI Commands - Full Specification

### Global Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | false | Structured JSON output. Suppresses spinner, colors, and human-readable formatting. |
| `--network <net>` | `mainnet` | Network: `mainnet`, `testnet4`, or `signet` |
| `--api <url>` | `https://mempool.space/api` | Custom mempool API URL. Auto-detects local APIs for longer timeouts. |
| `--no-color` | false | Disable colored output. Also respects `NO_COLOR` env var per spec. |
| `--no-entities` | false | Skip entity filter loading. Faster startup, no entity detection. |
| `--version` | - | Print version and exit |

Network flag adjusts API base URL automatically:
- `mainnet` -> `https://mempool.space/api`
- `testnet4` -> `https://mempool.space/testnet4/api`
- `signet` -> `https://mempool.space/signet/api`

Custom `--api` overrides these defaults.

---

### `am-i-exposed scan tx <txid>`

Analyze a single transaction against all 25 heuristics.

**Arguments:**
- `<txid>` - 64-character hex transaction ID (required)

**Flags:**
| Flag | Default | Description |
|------|---------|-------------|
| `--chain-depth <N>` | 0 | Include chain analysis (backward/forward trace) up to N hops. 0 = tx-only. |
| `--min-sats <N>` | 1000 | Minimum satoshi value to follow when tracing (filters dust paths) |

**Pipeline:**
1. Validate txid format (64 hex chars)
2. Create `MempoolClient` via `createMempoolClient(apiUrl)`
3. Load entity filter via `configureDataLoader()` (unless `--no-entities`)
4. Fetch tx: `client.getTransaction(txid)`
5. Fetch raw hex: `client.getTxHex(txid)`
6. Build TxContext:
   - Fetch parent tx for `vin[0]` (peel chain detection)
   - Fetch all parent txs (entity detection, post-mix analysis)
   - Fetch output address tx counts (change detection via fresh addresses)
7. Run `analyzeTransaction(tx, rawHex, onStep, ctx)` - returns `ScoringResult`
8. If `--chain-depth > 0`:
   - Run `traceBackward(tx, depth, minSats, client)`
   - Run `traceForward(tx, depth, minSats, client)`
   - Run chain analysis modules: `analyzeEntityProximity()`, `analyzeBackwardTaint()`, `buildCluster()`, `analyzeSpendingPatterns()`
   - Merge chain findings into result
9. Run `selectRecommendations({ findings, grade, txType, ... })`
10. Format output (human-readable or JSON)

**Imports used:**
```typescript
import { analyzeTransaction } from "@/lib/analysis/orchestrator";
import { createMempoolClient } from "@/lib/api/mempool";
import { selectRecommendations } from "@/lib/recommendations/primary-recommendation";
import { traceBackward, traceForward } from "@/lib/analysis/chain/recursive-trace";
import { analyzeEntityProximity } from "@/lib/analysis/chain/entity-proximity";
import { analyzeBackwardTaint } from "@/lib/analysis/chain/taint";
```

**Human-readable output:**
```
am-i-exposed v0.33.0

Transaction: 323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2
Network:     mainnet
Type:        Whirlpool CoinJoin
Inputs:      5 (250,000 sats total)
Outputs:     5 (245,000 sats total)
Fee:         5,000 sats (2.0 sat/vB)

Score: 95/100   Grade: A+

FINDINGS (8):
  [GOOD]     Whirlpool CoinJoin detected (0.05 BTC pool)            +30
             5 equal outputs at known Whirlpool denomination.
  [GOOD]     High anonymity set (5 participants)                      +5
             All outputs are indistinguishable.
  [GOOD]     BIP69 compliant ordering                                 +3
             Deterministic lexicographic ordering detected.
  [LOW]      Common input ownership (5 addresses)                      0
             Suppressed: CoinJoin context.
  ...

RECOMMENDATION:
  Maintain UTXO separation - do not consolidate post-mix outputs.
  Tools: Sparrow Wallet (sparrowwallet.com)
```

Severity indicators: `[GOOD]` green, `[LOW]` blue, `[MEDIUM]` yellow, `[HIGH]` orange, `[CRITICAL]` red.

**JSON output (`--json`):**
```json
{
  "version": "0.33.0",
  "input": {
    "type": "txid",
    "value": "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2"
  },
  "network": "mainnet",
  "score": 95,
  "grade": "A+",
  "txType": "whirlpool-coinjoin",
  "txInfo": {
    "inputs": 5,
    "outputs": 5,
    "fee": 5000,
    "size": 720,
    "weight": 1653,
    "confirmed": true,
    "blockHeight": 750000
  },
  "findings": [
    {
      "id": "h4-whirlpool-coinjoin",
      "severity": "good",
      "title": "Whirlpool CoinJoin detected (0.05 BTC pool)",
      "description": "5 equal outputs at a known Whirlpool denomination...",
      "recommendation": "Maintain UTXO separation...",
      "scoreImpact": 30,
      "confidence": "deterministic",
      "params": {
        "denomination": 5000000,
        "equalOutputs": 5
      }
    }
  ],
  "recommendation": {
    "id": "post-coinjoin-hygiene",
    "urgency": "when-convenient",
    "headline": "Maintain UTXO separation",
    "detail": "Do not consolidate post-mix outputs...",
    "tools": [
      { "name": "Sparrow Wallet", "url": "https://sparrowwallet.com" }
    ]
  },
  "chainAnalysis": null
}
```

When `--chain-depth > 0`, the `chainAnalysis` field contains:
```json
{
  "chainAnalysis": {
    "backward": {
      "depth": 3,
      "txsFetched": 47,
      "layers": [
        { "depth": 1, "txCount": 5 },
        { "depth": 2, "txCount": 18 },
        { "depth": 3, "txCount": 24 }
      ]
    },
    "forward": {
      "depth": 3,
      "txsFetched": 32,
      "layers": [...]
    },
    "findings": [
      {
        "id": "entity-proximity-input-depth-2",
        "severity": "high",
        "title": "Known entity within 2 hops (inputs): Binance",
        "scoreImpact": -8
      }
    ]
  }
}
```

---

### `am-i-exposed scan address <addr>`

Analyze an address for privacy exposure.

**Arguments:**
- `<addr>` - Bitcoin address (any format: P2PKH, P2SH, P2WPKH, P2WSH, P2TR)

**Pipeline:**
1. Validate address format via `getAddressType(addr)` - reject if "unknown"
2. Validate network consistency (bc1 for mainnet, tb1 for testnet)
3. Fetch in parallel:
   - `client.getAddress(addr)` - address stats
   - `client.getAddressUtxos(addr)` - unspent outputs
   - `client.getAddressTxs(addr)` - transaction history
4. Run `analyzeAddress(addressData, utxos, txs, onStep)` - returns `ScoringResult`
5. Run `selectRecommendations()` for actionable output
6. Format output

**Imports used:**
```typescript
import { analyzeAddress } from "@/lib/analysis/orchestrator";
import { getAddressType } from "@/lib/bitcoin/address-type";
```

**JSON output schema** - same envelope as `scan tx`, with additional fields:
```json
{
  "input": { "type": "address", "value": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" },
  "addressInfo": {
    "type": "p2pkh",
    "txCount": 56713,
    "fundedTxoCount": 67762,
    "spentTxoCount": 0,
    "balance": 7216234
  }
}
```

---

### `am-i-exposed scan xpub <descriptor>`

Wallet-level privacy audit via extended public key or output descriptor.

**Arguments:**
- `<descriptor>` - xpub, ypub, zpub, or output descriptor (`wpkh(xpub.../84'/0'/0'/*)`)

**Flags:**
| Flag | Default | Description |
|------|---------|-------------|
| `--gap-limit <N>` | 20 | Number of consecutive unused addresses before stopping |
| `--chains <list>` | `0,1` | BIP32 chains to scan. 0=external (receive), 1=internal (change) |

**Pipeline:**
1. Parse descriptor via `parseXpub(descriptor)`
2. Derive addresses: external chain (0) and internal chain (1) up to gap limit
3. For each derived address, fetch: address data, transactions, UTXOs
   - Rate limiting: batch of 3 requests, 500ms delay between batches (for hosted APIs)
   - Self-hosted/Umbrel APIs: batch of 5, no delay
4. Determine gap: stop scanning a chain after `--gap-limit` consecutive addresses with 0 transactions
5. Run `auditWallet(walletAddressInfo)` - returns `WalletAuditResult`
6. Format output with wallet summary stats

**Imports used:**
```typescript
import { parseXpub, deriveOneAddress } from "@/lib/bitcoin/descriptor";
import { auditWallet } from "@/lib/analysis/wallet-audit";
import type { WalletAddressInfo, WalletAuditResult } from "@/lib/analysis/wallet-audit";
```

**Progress output** (human-readable mode):
```
Scanning wallet...
  External chain: 45 addresses scanned (22 active, gap 20 reached)
  Internal chain: 38 addresses scanned (18 active, gap 20 reached)
  Fetching transaction history... 40/40 addresses
```

**JSON output schema:**
```json
{
  "input": { "type": "xpub", "value": "zpub6r..." },
  "walletInfo": {
    "activeAddresses": 40,
    "totalTxs": 127,
    "totalUtxos": 15,
    "totalBalance": 2450000,
    "reusedAddresses": 3,
    "dustUtxos": 1,
    "externalScanned": 45,
    "internalScanned": 38
  },
  "score": 62,
  "grade": "C",
  "findings": [
    {
      "id": "wallet-address-reuse",
      "severity": "high",
      "title": "3 of 40 addresses reused",
      "scoreImpact": -10,
      "params": { "reusedCount": 3, "totalReceived": 40, "ratio": 8 }
    }
  ]
}
```

---

### `am-i-exposed scan psbt <input>`

Analyze an unsigned/partially-signed transaction BEFORE broadcasting. This is the killer feature for AI agent integration.

**Arguments:**
- `<input>` - File path to a `.psbt` file, or raw base64 PSBT string

**Pipeline:**
1. Detect input type:
   - If file exists on disk: read contents via `fs.readFileSync()`
   - Otherwise: treat as raw base64 string
2. Parse PSBT via `parsePSBT(input)` - returns a pseudo-`MempoolTransaction`
3. Run `analyzeTransaction(parsed.tx)` on the parsed transaction structure
4. Include PSBT-specific metadata:
   - Estimated fee (if available from PSBT inputs)
   - Estimated vsize
   - Number of inputs/outputs
   - Signing status (fully signed, partially signed, unsigned)
   - Input types detected
5. Format output

**Imports used:**
```typescript
import { parsePSBT, isPSBT } from "@/lib/bitcoin/psbt";
import { analyzeTransaction } from "@/lib/analysis/orchestrator";
```

**Important**: This command does NOT need network access (unless `--chain-depth` is added later). The PSBT contains all the transaction data needed for heuristic analysis. This makes it fast and privacy-preserving - nothing is sent anywhere.

**JSON output schema:**
```json
{
  "input": { "type": "psbt", "value": "<file_path_or_base64_truncated>" },
  "psbtInfo": {
    "inputs": 2,
    "outputs": 3,
    "estimatedFee": 1500,
    "estimatedVsize": 234,
    "signingStatus": "unsigned",
    "inputTypes": ["p2wpkh", "p2wpkh"]
  },
  "score": 45,
  "grade": "D",
  "findings": [...]
}
```

**Agent use case example:**
```bash
# Agent crafts a transaction, saves as PSBT, checks privacy before broadcasting
am-i-exposed scan psbt /tmp/proposed-tx.psbt --json | jq '.grade'
# If grade is D or F, modify the transaction (coin selection, outputs) and re-check
```

---

### `am-i-exposed boltzmann <txid>`

Compute Boltzmann entropy and Link Probability Matrix for a transaction.

**Arguments:**
- `<txid>` - 64-character hex transaction ID

**Flags:**
| Flag | Default | Description |
|------|---------|-------------|
| `--timeout <seconds>` | 300 | Maximum computation time (5 minutes default, matching web UI) |
| `--intrafees-ratio <float>` | 0.005 | Max CoinJoin intrafees ratio for dual-run analysis |

**Pipeline:**
1. Fetch tx from API
2. Extract input values (`vin[*].prevout.value`) and output values (`vout[*].value`)
3. Filter zero-value outputs (OP_RETURN)
4. Load Node.js WASM bindings from `cli/wasm/`
5. Call `compute_boltzmann(inputValues, outputValues, fee, intrafees, timeoutMs)`
6. Format result

**Rust WASM API** (`compute_boltzmann` in `boltzmann-rs/src/lib.rs`):
```rust
pub fn compute_boltzmann(
    input_values: &[i64],   // satoshi amounts
    output_values: &[i64],  // satoshi amounts
    fee: i64,               // tx fee in sats
    max_cj_intrafees_ratio: f64,  // 0.0 or 0.005
    timeout_ms: u32,        // computation deadline
) -> BoltzmannResult
```

Returns `BoltzmannResult`:
```rust
pub struct BoltzmannResult {
    pub mat_lnk_combinations: Vec<Vec<u64>>,    // raw count matrix [nOut][nIn]
    pub mat_lnk_probabilities: Vec<Vec<f64>>,   // probability matrix [nOut][nIn]
    pub nb_cmbn: u64,                            // total valid interpretations
    pub entropy: f64,                            // bits: log2(nb_cmbn)
    pub efficiency: f64,                         // nb_cmbn / perfect_cj_cmbn
    pub nb_cmbn_prfct_cj: u64,                  // combinations for perfect CoinJoin
    pub deterministic_links: Vec<(usize, usize)>, // (output_idx, input_idx)
    pub timed_out: bool,
    pub elapsed_ms: u32,
    pub n_inputs: usize,
    pub n_outputs: usize,
    pub fees: i64,
    pub intra_fees_maker: i64,
    pub intra_fees_taker: i64,
}
```

**Human-readable output:**
```
am-i-exposed Boltzmann Analysis

Transaction: 323df21f...29dec2
Inputs:      5 (250,000 sats total)
Outputs:     5 (245,000 sats total)
Fee:         5,000 sats

Entropy:     11.32 bits
Efficiency:  1.00 (100% - perfect CoinJoin structure)
Combinations: 5,120

Deterministic links: 0 (none - all links are probabilistic)

Link Probability Matrix:
           in[0]   in[1]   in[2]   in[3]   in[4]
out[0]     0.200   0.200   0.200   0.200   0.200
out[1]     0.200   0.200   0.200   0.200   0.200
out[2]     0.200   0.200   0.200   0.200   0.200
out[3]     0.200   0.200   0.200   0.200   0.200
out[4]     0.200   0.200   0.200   0.200   0.200

Computation: 12ms (no timeout)
```

**JSON output:**
```json
{
  "input": { "type": "txid", "value": "323df21f..." },
  "boltzmann": {
    "entropy": 11.32,
    "efficiency": 1.0,
    "nbCombinations": 5120,
    "nbCombinationsPerfectCj": 5120,
    "deterministicLinks": [],
    "timedOut": false,
    "elapsedMs": 12,
    "nInputs": 5,
    "nOutputs": 5,
    "fee": 5000,
    "matrix": {
      "probabilities": [[0.2, 0.2, ...], ...],
      "combinations": [[1024, 1024, ...], ...]
    }
  }
}
```

**Limits**: Transactions with >8 inputs AND >8 outputs may take minutes or hit the timeout. The web UI auto-runs only for <=8x8.

---

### `am-i-exposed chain-trace <txid>`

Multi-hop transaction graph analysis.

**Arguments:**
- `<txid>` - 64-character hex transaction ID

**Flags:**
| Flag | Default | Description |
|------|---------|-------------|
| `--direction <dir>` | `both` | `backward`, `forward`, or `both` |
| `--depth <N>` | 3 | Maximum hops to trace |
| `--min-sats <N>` | 1000 | Minimum value to follow (filters dust) |
| `--skip-coinjoins` | false | Stop tracing at CoinJoin transactions |

**Pipeline:**
1. Fetch starting tx
2. Load entity filter (for entity barrier detection during tracing)
3. If backward: `traceBackward(tx, depth, minSats, client, signal, onProgress, existingParents, entityBarrier)`
4. If forward: `traceForward(tx, depth, minSats, client, signal, onProgress, undefined, entityBarrier)`
5. Run analysis modules on discovered layers:
   - `analyzeEntityProximity(tx, backwardLayers, forwardLayers)` - known entities within N hops
   - `analyzeBackwardTaint(tx, backwardLayers)` - proportional value flow tracking
   - `buildCluster(tx, allLayers)` - CIOH transitivity clusters
   - `analyzeSpendingPatterns(tx, allLayers)` - post-CoinJoin consolidation, ricochet, KYC patterns
6. Format output

**Imports used:**
```typescript
import { traceBackward, traceForward } from "@/lib/analysis/chain/recursive-trace";
import { analyzeEntityProximity } from "@/lib/analysis/chain/entity-proximity";
import { analyzeBackwardTaint } from "@/lib/analysis/chain/taint";
import { buildCluster } from "@/lib/analysis/chain/clustering";
import { analyzeSpendingPatterns } from "@/lib/analysis/chain/spending-patterns";
```

The `TraceFetcher` interface used by `traceBackward`/`traceForward`:
```typescript
interface TraceFetcher {
  getTransaction(txid: string): Promise<MempoolTransaction>;
  getTxOutspends(txid: string): Promise<MempoolOutspend[]>;
}
```
This matches `createMempoolClient()` return type exactly - no adapter needed.

**Progress output:**
```
Tracing backward from 323df21f...29dec2
  Depth 1: 5 transactions fetched (5 new)
  Depth 2: 18 transactions fetched (13 new)
  Depth 3: 47 transactions fetched (24 new, 5 entity barriers hit)

Tracing forward from 323df21f...29dec2
  Depth 1: 5 transactions fetched
  Depth 2: 12 transactions fetched
  Depth 3: 32 transactions fetched

CHAIN FINDINGS (4):
  [HIGH]     Known entity within 2 hops (inputs): Binance            -8
  [MEDIUM]   Taint concentration: 65% of input value traceable        -5
  [MEDIUM]   Cluster size: 12 addresses linked via CIOH               -3
  [LOW]      Post-CoinJoin partial spend detected at depth 2          -2
```

**JSON output:**
```json
{
  "input": { "type": "txid", "value": "323df21f..." },
  "trace": {
    "backward": {
      "depth": 3,
      "txsFetched": 47,
      "aborted": false,
      "layers": [
        { "depth": 1, "txCount": 5 },
        { "depth": 2, "txCount": 18 },
        { "depth": 3, "txCount": 24 }
      ]
    },
    "forward": {
      "depth": 3,
      "txsFetched": 32,
      "aborted": false,
      "layers": [...]
    },
    "findings": [
      {
        "id": "entity-proximity-input-depth-2",
        "severity": "high",
        "title": "Known entity within 2 hops (inputs): Binance",
        "scoreImpact": -8
      }
    ],
    "entities": [
      { "name": "Binance", "category": "exchange", "hops": 2, "direction": "backward" }
    ],
    "clusterSize": 12
  }
}
```

---

## Types Reference

These are the exact types from `src/lib/types.ts` that the CLI output conforms to:

```typescript
type Severity = "critical" | "high" | "medium" | "low" | "good";
type Grade = "A+" | "B" | "C" | "D" | "F";
type ConfidenceLevel = "deterministic" | "high" | "medium" | "low";

interface Finding {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  scoreImpact: number;
  params?: Record<string, string | number>;
  remediation?: Remediation;
  confidence?: ConfidenceLevel;
}

interface ScoringResult {
  score: number;       // 0-100
  grade: Grade;
  findings: Finding[];
  txType?: TxType;
}

type TxType =
  | "whirlpool-coinjoin" | "wabisabi-coinjoin" | "joinmarket-coinjoin"
  | "generic-coinjoin" | "stonewall" | "simplified-stonewall" | "tx0-premix"
  | "bip47-notification" | "ricochet" | "consolidation" | "exchange-withdrawal"
  | "batch-payment" | "self-transfer" | "peel-chain" | "coinbase"
  | "simple-payment" | "unknown";
```

Wallet audit result from `src/lib/analysis/wallet-audit.ts`:

```typescript
interface WalletAuditResult {
  score: number;
  grade: Grade;
  findings: Finding[];
  activeAddresses: number;
  totalTxs: number;
  totalUtxos: number;
  totalBalance: number;      // sats
  reusedAddresses: number;
  dustUtxos: number;
}
```

Recommendation from `src/lib/recommendations/primary-recommendation.ts`:

```typescript
interface PrimaryRec {
  id: string;
  urgency: "immediate" | "soon" | "when-convenient";
  headlineKey: string;
  headlineDefault: string;
  detailKey: string;
  detailDefault: string;
  tool?: { name: string; url: string };
  tools?: { name: string; url: string }[];
  guideLink?: string;
}
```

---

## Scoring Model

Same scoring model as the web app (see `docs/privacy-engine.md` for full reference):

- **Base score**: 70 (tx mode), 93 (address mode), 70 (wallet mode)
- **Impact**: Each finding has a `scoreImpact` (-35 to +30)
- **Final score**: `clamp(0, 100, base + sum(impacts))`
- **Grade thresholds**: A+ >= 90, B >= 75, C >= 50, D >= 25, F < 25

---

## Heuristic Registry

### Transaction Heuristics (25 steps)

| ID | Label | Source Function |
|----|-------|----------------|
| `coinbase` | Coinbase detection | `analyzeCoinbase` |
| `h1` | Round amounts | `analyzeRoundAmounts` |
| `h2` | Change detection | `analyzeChangeDetection` |
| `h3` | Common input ownership | `analyzeCioh` |
| `h4` | CoinJoin detection | `analyzeCoinJoin` |
| `h5` | Transaction entropy | `analyzeEntropy` |
| `h6` | Fee fingerprinting | `analyzeFees` |
| `h7` | OP_RETURN metadata | `analyzeOpReturn` |
| `h11` | Wallet fingerprinting | `analyzeWalletFingerprint` |
| `anon` | Anonymity sets | `analyzeAnonymitySet` |
| `timing` | Timing analysis | `analyzeTiming` |
| `script` | Script type analysis | `analyzeScriptTypeMix` |
| `dust` | Dust output detection | `analyzeDustOutputs` |
| `h17` | Multisig/escrow detection | `analyzeMultisigDetection` |
| `peel` | Peel chain detection | `analyzePeelChain` |
| `consolidation` | Consolidation patterns | `analyzeConsolidation` |
| `unnecessary` | Unnecessary inputs | `analyzeUnnecessaryInput` |
| `tx0` | CoinJoin premix (tx0) | `analyzeCoinJoinPremix` |
| `bip69` | BIP69 ordering | `analyzeBip69` |
| `bip47` | BIP47 notification detection | `analyzeBip47Notification` |
| `exchange` | Exchange pattern detection | `analyzeExchangePattern` |
| `coinsel` | Coin selection patterns | `analyzeCoinSelection` |
| `witness` | Witness data analysis | `analyzeWitnessData` |
| `postmix` | Post-mix consolidation | `analyzePostMix` |
| `entity` | Known entity detection | `analyzeEntityDetection` |
| `ricochet` | Ricochet detection | `analyzeRicochet` |

After individual heuristics: `applyCrossHeuristicRules()` runs CoinJoin suppression, Stonewall detection, and compound logic.

### Address Heuristics (6 steps)

| ID | Label | Source Function |
|----|-------|----------------|
| `h8` | Address reuse | `analyzeAddressReuse` |
| `h9` | UTXO analysis | `analyzeUtxos` |
| `h10` | Address type | `analyzeAddressType` |
| `spending` | Spending patterns | `analyzeSpendingPattern` |
| `recurring` | Recurring payment detection | `analyzeRecurringPayment` |
| `highactivity` | High activity detection | `analyzeHighActivityAddress` |

Plus post-heuristic steps: entity identification, temporal correlation, fingerprint evolution.

### Chain Analysis Steps (6 steps, on-demand)

| ID | Label | Source Function |
|----|-------|----------------|
| `chain-backward` | Input provenance | `traceBackward()` + `analyzeBackward()` |
| `chain-forward` | Output destinations | `traceForward()` + `analyzeForward()` |
| `chain-cluster` | Address clustering | `buildCluster()` |
| `chain-spending` | Spending patterns | `analyzeSpendingPatterns()` |
| `chain-entity` | Entity proximity | `analyzeEntityProximity()` |
| `chain-taint` | Taint flow | `analyzeBackwardTaint()` |

---

## Entity Data

### What ships with the CLI

All entity data files are bundled in the npm package (~92MB total):

| File | Size | Contents |
|------|------|----------|
| `entity-index.bin` | ~0.4 MB | Core index: 1M addresses, budget-allocated by priority |
| `entity-index-full.bin` | ~57 MB | Full index: ~10M named addresses |
| `entity-filter-full.bin` | ~35 MB | Bloom filter: ~20M overflow addresses (boolean match only) |

364+ entities across 8 categories: exchange, darknet, scam, gambling, payment, mining, mixer, p2p.

### Loading strategy

At CLI startup (unless `--no-entities`):
1. `configureDataLoader({ fetchFn })` with filesystem reader pointing to `cli/data/`
2. Load core index synchronously (0.4 MB - instant)
3. Load full index + bloom on demand (first entity lookup triggers lazy load)

### EIDX binary format (v2)

```
Header (20 bytes):
  magic: "EIDX" (4 bytes)
  version: u16
  nameCount: u16
  entryCount: u32
  reserved: 8 bytes

Name table (variable):
  For each entity: null-terminated name string + 1 category byte

Entry table (6 bytes each):
  hash4: u32 (FNV-1a of address, truncated to 32 bits)
  entityId: u16 (index into name table)

Entries are sorted by hash4 for binary search.
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Runtime error (network failure, API error, timeout) |
| 2 | Invalid input (bad txid format, invalid address, unparseable PSBT) |

---

## Dependencies

### CLI-specific (`cli/package.json`)
- **`commander`** (~50KB, 0 deps) - CLI framework with subcommand tree
- **`chalk`** (v5, ESM) - terminal colors
- **`ora`** - progress spinner

### Shared from root (via `@/` alias)
- `@noble/curves` (v2.0.1) - secp256k1
- `@noble/hashes` (v2.0.1) - SHA256, RIPEMD160
- `@scure/base` (v2.0.0) - Base58Check
- `@scure/bip32` (v2.0.1) - HD key derivation
- `@scure/btc-signer` (v2.0.1) - PSBT parsing

### NOT needed by CLI
- React, Next.js, Tailwind, motion, visx, lucide-react, qrcode.react, i18next

---

## npm Package Configuration

```json
{
  "name": "am-i-exposed",
  "version": "0.33.0",
  "description": "Bitcoin privacy scanner - analyze transactions, addresses, and wallets for chain analysis exposure",
  "type": "module",
  "bin": {
    "am-i-exposed": "./dist/index.js"
  },
  "files": [
    "dist/",
    "data/",
    "wasm/",
    "skill.md"
  ],
  "engines": {
    "node": ">=20"
  },
  "keywords": [
    "bitcoin",
    "privacy",
    "chain-analysis",
    "boltzmann",
    "coinjoin",
    "cli"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/Copexit/am-i-exposed"
  }
}
```

---

## tsconfig

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "noEmit": false,
    "declaration": true,
    "lib": ["ES2022"],
    "paths": {
      "@/*": ["../src/*"]
    }
  },
  "include": [
    "src/**/*.ts",
    "../src/lib/**/*.ts",
    "../src/data/**/*.ts"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "../src/hooks/**",
    "../src/components/**",
    "../src/app/**",
    "../src/context/**"
  ]
}
```

**Key**: Drops `"dom"` from `lib`. This catches any accidental browser API usage in `src/lib/` at compile time. Known safe: `TextDecoder`, `fetch`, `AbortSignal` are all available in Node.js 20+ and typed via `@types/node`.

---

## skill.md Specification

The `skill.md` file ships with the npm package and documents the CLI for AI agent integration.

Structure:
```markdown
# am-i-exposed - Bitcoin Privacy Scanner CLI

## Installation
npm install -g am-i-exposed
# or: npx am-i-exposed <command>

## Commands
[Each command with exact syntax, description, flags]

## JSON Output Schema
[Schema for each command type]

## Common Agent Workflows

### Pre-broadcast privacy check
1. Export unsigned PSBT from wallet
2. Run: am-i-exposed scan psbt <file> --json
3. Check .grade - if D or F, modify coin selection
4. Repeat until acceptable grade

### Transaction forensics
1. Run: am-i-exposed scan tx <txid> --json --chain-depth 3
2. Check .findings for entity proximity
3. Check .chainAnalysis.entities for known entities in path

### Wallet health audit
1. Run: am-i-exposed scan xpub <zpub> --json --gap-limit 30
2. Check .walletInfo.reusedAddresses
3. Check findings for dust, toxic change, consolidation issues

### Privacy-optimal coin selection
1. Get wallet UTXOs
2. For each candidate PSBT, run: am-i-exposed scan psbt <candidate> --json
3. Select the PSBT with highest score
4. Sign and broadcast

## Exit Codes
0 = success, 1 = runtime error, 2 = invalid input

## Notes
- All analysis runs locally. Only mempool.space API calls are made (for tx/address data).
- Entity detection uses bundled data files (~92MB), no external APIs.
- PSBT analysis requires zero network access.
- Boltzmann analysis may take up to 5 minutes for large transactions.
```

---

## Testing Strategy

### Unit tests (`cli/__tests__/`)
- `adapters/boltzmann-node.test.ts` - WASM loads in Node.js, computes known test vectors (same 23 vectors from `boltzmann-rs/`)
- `output/formatter.test.ts` - human-readable formatting matches expected patterns
- `output/json.test.ts` - JSON envelope schema validation

### Integration tests (mock API, no network)
- `commands/scan-tx.test.ts` - fixture txs from `docs/testing-reference.md`, mock mempool client
- `commands/scan-address.test.ts` - fixture address data
- `commands/scan-psbt.test.ts` - real PSBT base64 strings

### Smoke tests (live network, optional)
- Test with known txids:
  - Whirlpool: `323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2` - expect A+
  - WabiSabi: `fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e` - expect A+
  - Satoshi genesis: `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` - expect F (address scan)
  - Dust attack: `655c533bf059721cec9d3d70b3171a07997991a02fedfa1c9b593abc645e1cc5` - expect F
  - Simple P2PKH: `0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4` - expect C

---

## CI / Build Pipeline

### Build commands
```bash
cd cli && pnpm install
cd cli && pnpm build           # tsc -> dist/
cd cli && pnpm build:wasm      # wasm-pack --target nodejs -> wasm/
cd cli && pnpm test            # vitest
```

### GitHub Actions (new jobs, parallel with existing web CI)
```yaml
cli-build:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20 }
    - run: pnpm install --frozen-lockfile
    - run: cd cli && pnpm build
    - run: cd cli && pnpm test

cli-wasm:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
      with: { targets: wasm32-unknown-unknown }
    - uses: cargo-bins/cargo-binstall@main
    - run: cargo binstall wasm-pack -y
    - run: cd cli && pnpm build:wasm
```

---

## Roadmap

### v1.0 - Core CLI (this spec)
- [x] Project structure, tsconfig, package.json
- [x] Entity filter adapter (`configureDataLoader`)
- [x] `scan tx` command
- [x] `scan address` command
- [x] `scan psbt` command
- [x] `scan xpub` command
- [x] `boltzmann` command (Node.js WASM)
- [x] `chain-trace` command
- [x] Human-readable output formatter
- [x] JSON output mode
- [x] `skill.md` for AI agents
- [x] CI integration
- [x] npm publish (pipeline ready, `npm pack` verified at 82.4 MB)

### v1.1 - Filesystem Cache
Cache API responses to avoid redundant requests, especially for chain traces and xpub scans.

**Design:**
- Cache directory: `~/.am-i-exposed/cache/`
- Confirmed transactions: infinite TTL (immutable), stored as `tx/<txid>.json`
- Tx hex: infinite TTL, `hex/<txid>.hex`
- Outspends: 1h TTL, `outspends/<txid>.json`
- Address data/UTXOs: adaptive TTL (10 min to 12h based on tx_count)
- `--no-cache` flag to disable
- `am-i-exposed cache clear` command to purge
- `am-i-exposed cache stats` command to show size/entries

This is particularly valuable for:
- Chain traces at depth 3+ where the same parent txs appear in multiple paths
- Xpub scans with 50+ addresses
- Repeated analysis of the same transaction

### v1.2 - Standalone Binary
Bundle the CLI into a standalone binary via `bun compile` or `pkg` - no Node.js installation required.

### v1.3 - MCP Server
Expose the CLI as a Model Context Protocol server, enabling AI agents to connect directly rather than shelling out to the CLI.

### v2.0 - Watch Mode & Daemon
- `am-i-exposed watch <addr>` - monitor an address for new transactions, analyze each one
- `am-i-exposed daemon` - long-running process that listens for analysis requests via IPC/HTTP

---

## What NOT to do

- Don't rewrite the engine in Rust. It's I/O-bound (API calls), not CPU-bound. The only CPU-heavy part (Boltzmann) is already Rust.
- Don't duplicate heuristics. Every heuristic is imported directly from `src/lib/`.
- Don't add i18n to the CLI. English only. The heuristics already embed plain English strings.
- Don't bundle React/Next.js dependencies. The CLI has its own `package.json`.
- Don't use interactive prompts or TUI. Keep it simple: arguments in, results out. Pipe-friendly.
- Don't log or persist user addresses/txids (same privacy rules as the web app).
- Don't auto-update entity data. Bundle what ships with the version. Users update by installing a new version.
