# ADR: Groundtruth Library for Privacy Analysis QA

**Status:** Proposed
**Date:** 2026-03-15

## Problem

am-i.exposed has 31 heuristics, 14 chain analysis modules, entity matching against 364 services, and cross-heuristic suppression rules. Changes to any of these can silently break analysis accuracy for real-world transactions. There is no expert-verified reference dataset to catch regressions.

Manual QA by Arkad (expert researcher) catches issues, but findings are recorded as prose in HackMD and Signal - not machine-parseable, not runnable as tests, and not version-controlled.

## Decision

Build a **groundtruth library**: a structured, version-controlled dataset of expert-verified transactions, addresses, and wallets with expected analysis outcomes. Use this dataset to power automated E2E regression tests.

### Architecture

```
tests/groundtruth/
  vectors.json          # All test vectors (structured)
  README.md             # How to add/update vectors
```

### Vector Format

Each entry in `vectors.json` follows this schema:

```json
{
  "vectors": [
    {
      "id": "peel-chain-basic",
      "input": "6fe858...",
      "type": "txid",
      "network": "mainnet",
      "expectedGrade": ["C", "D"],
      "expectedScoreRange": [25, 65],
      "mustHaveFindings": ["chain-peel-chain"],
      "mustNotHaveFindings": [],
      "expectedTxType": "peel-chain",
      "expectedEntities": {},
      "tags": ["chain-analysis", "peel-chain"],
      "source": "arkad-2026-03-15",
      "notes": "Expert-confirmed peel chain detection"
    }
  ]
}
```

### Required Fields Per Vector

| Field | Why | Example |
|-------|-----|---------|
| `id` | Unique human-readable identifier | `"joinmarket-misclassified"` |
| `input` | txid, address, or xpub | `"56a79e4a..."` |
| `type` | Input type | `"txid"` / `"address"` / `"xpub"` |
| `network` | Bitcoin network | `"mainnet"` / `"testnet4"` / `"signet"` |
| `expectedGrade` | Acceptable grades (array) | `["C", "D"]` |
| `expectedScoreRange` | `[min, max]` inclusive | `[40, 60]` |
| `mustHaveFindings` | Finding IDs that MUST appear | `["h2-change-same-address", "h3-cioh"]` |
| `mustNotHaveFindings` | Finding IDs that must NOT appear | `["h4-coinjoin-wabisabi"]` |
| `expectedTxType` | Transaction classification | `"joinmarket-coinjoin"` |
| `expectedEntities` | Entity names keyed by address | `{ "bc1q7cyr...": "Crypto.com" }` |
| `tags` | Categorization for filtering | `["coinjoin", "entity-label"]` |
| `source` | Who verified and when | `"arkad-2026-03-15"` |
| `notes` | Expert context (not tested) | `"Peel chain with batch spending"` |

### Test Runner

A Vitest test file reads `vectors.json` and for each vector:

1. Fetches the transaction/address data (cached in fixtures to avoid API dependency)
2. Runs the full analysis pipeline (`analyzeTransaction` / address orchestrator)
3. Asserts:
   - Grade is in `expectedGrade` array
   - Score is within `expectedScoreRange`
   - All `mustHaveFindings` IDs are present
   - No `mustNotHaveFindings` IDs are present
   - `expectedTxType` matches (if specified)
   - `expectedEntities` match entity detection results (if specified)
4. Reports mismatches with full context (actual grade, score, findings list)

### API Data Caching

To avoid hitting mempool.space during CI and to ensure deterministic results:

- First run fetches live data and saves to `tests/groundtruth/fixtures/{txid}.json`
- Subsequent runs use cached fixtures
- Fixtures are committed to git (they're immutable - confirmed txs don't change)
- A script refreshes fixtures when needed: `pnpm groundtruth:refresh`

### Categories of Test Vectors

**Correct analysis (regression anchors):**
- Transactions where the current analysis is expert-verified as accurate
- These should never regress - any grade/finding change is a test failure

**Known bugs (expected failures):**
- Vectors marked with `"status": "known-bug"` that document current inaccuracies
- Tests run but failures are expected - when fixed, flip status to `"fixed"`

**Edge cases:**
- Ordinal inscriptions, Runes, multisig, coinbase, large batched txs
- Stress the heuristic engine with unusual structures

### Separation of Concerns

The groundtruth library tests **analysis accuracy** only:
- Is the grade correct?
- Are the right findings detected?
- Are entities labeled correctly?

It does NOT test:
- Recommendation wording (tracked via copy review / i18n)
- UI rendering (tracked via Playwright visual tests)
- API performance (tracked via benchmarks)

Recommendation text feedback from the expert is valuable but belongs in GitHub issues or a separate copy review document, not in test vectors.

### Workflow for Adding Vectors

1. Expert (Arkad) scans a transaction and records expected behavior
2. Expert submits via GitHub issue using a structured template, or adds directly to `vectors.json`
3. Developer verifies the vector runs correctly (or marks as `known-bug`)
4. Vector is committed with cached fixture data
5. CI runs the full groundtruth suite on every PR

### Score Drift

Some vectors involve forward chain analysis (outspends, child txs). As new transactions are mined, outputs get spent and analysis results can change. Mitigation:

- Cache fixture data at a point in time (pinned snapshot)
- Use wider score ranges for vectors sensitive to chain state (`[25, 65]` not `[42, 42]`)
- Periodically refresh fixtures and re-verify with expert

## Initial Vector Set (from Arkad's March 2026 Review)

### Transactions - Correct Analysis

| id | txid | Expected | Notes |
|----|------|----------|-------|
| `change-to-input-addr` | `56a79e4a6215...` | Change sent back to input address detected | Expert confirmed |
| `consolidation-warning` | `cd1192e85444...` | CIOH / consolidation detected | Expert confirmed |
| `peel-chain-basic` | `6fe85838b535...` | Peel chain detected with good remediation | Expert confirmed |
| `consolidation-source-mix` | `555d75e6dcb9...` | Multi-source consolidation flagged | Expert confirmed |
| `peel-chain-batch` | `48090f669675...` | "Magnificent" peel chain analysis | Expert confirmed |
| `wabisabi-post-mix` | `dc48f27ab794...` | WabiSabi labeled, post-mix consolidation warning | Expert confirmed |

### Transactions - Bugs / Improvements Needed

| id | txid | Issue |
|----|------|-------|
| `joinmarket-as-wabisabi` | `77ebbf479988...` | JoinMarket tx misclassified as WabiSabi |
| `ordinal-not-identified` | `84248c919507...` | Ordinal inscription tx not explicitly identified |
| `runes-tx` | `230d998fc3f1...` | Runes transaction - needs explicit detection |
| `multisig-vs-consolidation` | `add65fc09977...` | Multisig should outweigh consolidation finding |
| `self-send-missing` | `2f2fa6c37730...` | Possible self-send not detected |
| `payjoin-wallet-recs` | `5070088587ad...` | Missing Ashigaru and Bull Bitcoin from PayJoin wallet recommendations |

### Addresses - Bugs

| id | address | Issue |
|----|---------|-------|
| `binance-not-in-graph` | `bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h` | Labeled on address scan but not in tx graph |
| `crypto-com-as-coinbase` | `bc1q7cyrfmck2ffu2ud3rn5l5a8yv6f0chkp0zpemf` | Labeled as Coinbase, actually Crypto.com |
| `exchange-batch-false-a+` | `3A9ntGWTx4qcbrDMUdkbJ41TrYkTXgeboK` | Graded A+ but is exchange batch change (should be lower) |

## Consequences

- **Positive:** Every PR is tested against expert-verified real-world transactions. Heuristic changes that break known-good analysis are caught before merge.
- **Positive:** Known bugs are documented as test vectors, making them impossible to forget.
- **Positive:** New expert feedback has a clear path to become a permanent test case.
- **Negative:** Fixture data adds ~50-200KB per vector to the repo (acceptable).
- **Negative:** Forward analysis vectors may drift over time (mitigated by score ranges and periodic refresh).
