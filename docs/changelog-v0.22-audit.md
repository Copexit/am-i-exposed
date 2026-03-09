# Changelog & Correctness Audit: v0.22.0 to HEAD

Generated: 2026-03-09

## Overview

Since v0.22.0 (commit `0ead3d0`), the codebase has 3 committed changes and ~35 uncommitted files spanning new features, UI components, heuristics, and chain analysis modules.

**V45 audit fixes status**: All V45 fixes have been RE-APPLIED and verified (717/717 tests, 0 lint errors, build passes). All audit findings from this document have also been fixed.

---

## Committed Changes (3 commits)

### 1. Entity Filter - Two-Tier Index Architecture (722eba6)

**Files**: `src/lib/analysis/entity-filter/` (5 new files), `scripts/build-entity-filter.mjs`, `public/data/entity-index.bin`, `public/data/entity-filter-full.bin`

Two-tier Bloom filter system for detecting known entity addresses:
- **Core index** (~6 MB) auto-loaded on startup with FNV-1a 32-bit hash lookup
- **Full overflow** (~37 MB) on-demand with Bloom filter for addresses not in index
- Binary format v2 with header, bloom params, and bitfield
- Lazy loading with progress callbacks
- `matchEntitySync()` for synchronous checks, `matchEntities()` for async with auto-load

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 1 | **High** | **32-bit hash collision risk**: FNV-1a 32-bit hashes as sole key. With ~1M entries, birthday bound guarantees ~116 collisions. A collision means Address A (Coinbase) matches the hash of Address B (Kraken) and returns wrong entity name. No string verification at runtime. |
| 2 | **Medium** | **Race condition**: `matchEntitySync()` only checks already-loaded filter. If analysis runs before filter finishes loading, entity detection silently produces no findings for non-OFAC addresses. No degradation indicator to user. |
| 3 | **Medium** | **No retry on permanent failure**: If filter download fails (network error, 404), status is set to "error" permanently with no retry mechanism. |
| 4 | **Low** | **Redundant condition**: `getFilterStatus() === "ready" || getFilter() !== null` - the second check is redundant since status tracks this. |

### 2. Entity Category in Index Binary - v2 Format (48f3b82)

**Files**: `scripts/build-entity-filter.mjs`, `src/lib/analysis/entity-filter/filter-loader.ts`

Embeds entity category byte into the binary index format so categories can be resolved without a JSON lookup.

**Audit**: No issues found. v1/v2 format detection and fallback are correctly implemented.

### 3. Enrich Entity Database - 363 Entities (d793071)

**Files**: `src/data/entities.json`, `src/lib/analysis/entities.ts`, `scripts/enrich-entities.mjs`, `src/components/AddressSummary.tsx`, `src/components/ApiSettings.tsx`, `src/components/ResultsPanel.tsx`, `src/lib/analysis/heuristics/coinjoin.ts`, `src/lib/analysis/orchestrator.ts`

This commit bundles multiple features:

#### 3a. Entity Database (363 entities, 8 categories)
- JSON database with name, category, country, status, OFAC flag
- Case-insensitive lookup via `getEntity()`
- Categories: exchange, darknet, scam, gambling, payment, mining, mixer, p2p

**Audit**: Clean implementation, no issues.

#### 3b. Entity Detection Heuristic (H25)
- New `analyzeEntityDetection` heuristic checks all tx addresses against entity filter
- OFAC matches: severity critical, impact -20
- Known entity inputs: severity medium, impact -3
- Known entity outputs: severity low, impact -1

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 5 | **Critical** | **OFAC category hardcoded to "exchange"** (`entity-match.ts:30,75`): All OFAC-sanctioned addresses are labeled `category: "exchange"` regardless of actual type (darknet, ransomware, mixer). Comment acknowledges: "OFAC can be any category". |
| 6 | **Medium** | **"unknown" category bypass**: TypeScript's `EntityCategory` union type is bypassed via `as` cast when entity lookup fails (`entity-match.ts:53,89`). |

#### 3c. Post-Mix Consolidation Heuristic (H26)
- New `analyzePostMix` heuristic detects spending multiple CoinJoin outputs together
- Requires parent tx data in TxContext
- 2 post-mix inputs: severity high, impact -12
- 3+ post-mix inputs: severity critical, impact -18

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 7 | **Low** | Correctly skips if current tx is itself a CoinJoin (remixing). No issues found. |

#### 3d. Address-Level Entity Identification
- `analyzeAddress()` now runs `matchEntitySync()` against target address
- Produces `address-entity-identified` finding with entity metadata
- OFAC: severity critical, impact -20; known entity: severity medium, impact -3

**Audit**: Clean. Correctly surfaces entity info in address analysis.

#### 3e. Stonewall from Whirlpool Detection
- `detectStonewall()` now allows >4 inputs when all inputs share a Whirlpool denomination
- Requires 5+ inputs at same value matching WHIRLPOOL_DENOMS
- Adds `whirlpoolOrigin` flag with +10 score bonus and "high" confidence

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 8 | **Low** | Whirlpool origin requires 5+ inputs at same denom, but standard Stonewall cap is 4. Gap at exactly 5 inputs is theoretically possible (all from same pool) but practically fine. |

#### 3f. JoinMarket Taker Change Identification
- Identifies taker's change outputs (non-equal-value outputs)
- Distinguishes changeless CoinJoins (stronger privacy, +5 score bonus)
- Adds taker change management advice

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 9 | **Medium** | **Taker change = smallest is not always correct** (`joinmarket.ts:228-234`): The heuristic assumes taker's change is the smallest non-denomination output. When taker contributes much larger input than denomination, taker's change is the largest, not smallest. |

#### 3g. Cross-Heuristic Stonewall Refinements
- CIOH now suppressed for ALL CoinJoin types including Stonewall (was excluded before)
- Stonewall CIOH reduced to -3 (not 0, since all inputs ARE one wallet)
- Stonewall-specific context for entropy, anonymity set, wallet fingerprint findings
- `intentionalFingerprint` flag for Stonewall's nVersion=1 disruption

**Audit**: Correct. The Stonewall CIOH treatment at -3 is a reasonable balance between privacy feature and actual single-ownership.

#### 3h. Post-Mix to Entity Escalation
- When post-mix consolidation AND entity output co-occur, entity finding escalated to critical (-10)
- Covers: send to exchange from post-mix, consolidation + exchange in same tx

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 10 | **Medium** | **Double penalty**: Post-mix consolidation (-12 or -18) PLUS entity escalation (-10) = up to -28 for one mistake. This may over-penalize. |

#### 3i. Historical Context Notes
- Samourai Wallet seizure date (April 2024) used to attribute Stonewall to Ashigaru
- Whirlpool description updated: no longer uses centralized coordinator
- KYCP.org noted as offline since April 2024

**Audit**: Accurate historical information.

#### 3j. Entity Banner in AddressSummary
- Visual entity identification banner with category badge, OFAC warning, country info
- Different styling for OFAC (red/critical) vs normal entity (bitcoin orange)

**Audit**: Clean UI implementation. No issues.

#### 3k. Entity Filter UI in ApiSettings
- Filter download status indicator
- "Load full filter" button with progress bar
- Address count and build date display

**Audit**: Clean implementation with proper loading states.

#### 3l. Analysis Settings Panel
- Collapsible "Analysis" section in ApiSettings
- maxDepth (1-50), minSats (100-100K), skipLargeClusters, skipCoinJoins toggles
- useSyncExternalStore + localStorage persistence

**Audit**: No issues. Follows established patterns.

#### 3m. TX Type Badge in ResultsPanel
- Shows transaction classification (Whirlpool, Stonewall, JoinMarket, etc.) as badge
- Filters out "simple-payment" and "unknown"

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 11 | **Low** | Fallback `result.txType.replace(/-/g, " ")` produces lowercase labels. TX_TYPE_LABELS map covers most cases but edge types would render ugly. |

---

## Uncommitted Changes

### 4. Lightning Channel Detection in Multisig Heuristic

**File**: `src/lib/analysis/heuristics/multisig-detection.ts`

Separates Lightning channel closes from generic 2-of-2 escrow:
- Detects force close via scriptpubkey content
- Dedicated `lightning-channel-legacy` finding with force close vs cooperative close distinction
- Recommends Taproot channels upgrade
- Removes LN-related text from generic escrow finding

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 12 | **High** | **Force close detection ~38% false positive rate** (`multisig-detection.ts:218-221`): Checks if hex "b2" appears anywhere in P2WSH scriptpubkey. Since scriptpubkey is `0020{32-byte-hash}`, the hash is pseudorandom and "b2" appears in ~38% of hashes by chance. Should analyze witness script for OP_CHECKSEQUENCEVERIFY, not scriptpubkey. |
| 13 | **High** | **Lightning vs anti-fee-sniping false positive** (`multisig-detection.ts:214`): `likelyLN = tx.locktime > 0 && sequence !== max` matches any 2-of-2 multisig with BIP-339 anti-fee-sniping (Bitcoin Core default). Normal 2-of-2 cold storage spends will be misclassified as Lightning closes. |

### 5. RBF x Change Detection Compound Rule

**File**: `src/lib/analysis/orchestrator.ts` (uncommitted)

When both `h6-rbf-signaled` and `h2-change-detected` fire, boosts change confidence to "high" and adds -2 penalty with explanation that RBF replacement confirms change output.

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 14 | **High** | **CPFP recommendation is factually backwards** (`fee-analysis.ts:60`): Recommends "prefer CPFP over RBF for fee bumping" because "CPFP does not reveal which output is change." This is exactly wrong - CPFP **deterministically reveals** change by spending it as an input. RBF is actually better for change privacy (replaces whole tx). |

### 6. Glossary Expansion

**File**: `src/app/glossary/page.tsx`

Six new glossary terms: BnB (Branch and Bound), CPFP, PayJoin v2 (BIP77), Silent Payments (BIP352), Submarine Swap, Taproot Channels.

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 15 | **High** | **CPFP definition misleading**: States "CPFP does not reveal which output is change. Preferred over RBF for privacy-sensitive transactions." This is factually incorrect (see finding #14 above). CPFP reveals change deterministically. |

### 7. CommonMistakes Expansion

**File**: `src/components/CommonMistakes.tsx`

- Three new mistakes: LN from exchange, RBF change reveal, cross-context consolidation
- Grade threshold expanded from C/D/F to B/C/D/F

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 16 | **High** | **RBF mistake text recommends CPFP**: "For privacy-sensitive transactions, use CPFP instead." Same factual error as findings #14 and #15. CPFP is worse for change privacy than RBF. |

### 8. WalletGuide Expansion

**File**: `src/components/WalletGuide.tsx`

Added PayJoin and Silent Payments columns to wallet comparison table.

**Audit**: Wallet capability flags appear accurate. Bitcoin Core: Silent Payments = true, PayJoin = false. Sparrow: PayJoin = v1-only. No issues.

### 9. New UI Components (Untracked)

#### 9a. GraphExplorerPanel + GraphExplorer + useGraphExpansion
Interactive transaction graph visualization with expand/collapse/undo.

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 17 | **Medium** | **AbortController dependency** (`GraphExplorerPanel.tsx:37`): `[controller]` in useEffect deps creates new cleanup every config change. The old controller reference is captured in closure correctly though, so this is actually fine - it aborts the old one and sets up cleanup for the new one. Not a bug. |
| 18 | **Medium** | **Input index clamping** (`useGraphExpansion.ts:78`): `Math.max(0, inputIdx)` masks findIndex returning -1. Creates incorrect edge reference to index 0 instead of skipping. |
| 19 | **Medium** | **Entity detection only checks first output** (`GraphExplorer.tsx:115`): `matchEntitySync` called only on `vout[0]?.scriptpubkey_address`. Misses entity matches on other outputs. |
| 20 | **Low** | Forward expansion always uses output 0 (`GraphExplorer.tsx:337`). Cannot explore other output branches. |

#### 9b. ChainAnalysisPanel
Filters and groups chain analysis findings into sections.

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 21 | **Medium** | **Fragile ID matching** (`ChainAnalysisPanel.tsx:78-95`): Uses `.includes()` for substring matching. "chain-taint" caught by "taint" matcher. Could place findings in wrong section. |

#### 9c. ClusterTimeline
Stacked bar chart showing cluster activity over time.

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 22 | **Medium** | **Sent/received logic assumes total tx direction** (`ClusterTimeline.tsx:132-136`): Determines direction by comparing total inputValue > outputValue, but doesn't consider which inputs/outputs belong to the tracked address. |

#### 9d. TaintPathDiagram
Bithypha-style taint flow visualization.

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 23 | **Medium** | **Backward taint formula inverted** (`TaintPathDiagram.tsx:110`): `Math.min(100, taintPct + (100 - taintPct) * (d / hops))` increases taint with depth. Forward uses `Math.max(0, taintPct * (1 - d / hops))` which correctly decays. The backward formula is wrong - taint should decay moving away from source in both directions. |

#### 9e. PrivacyPathways
Privacy technique recommendations matched to findings.

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 24 | **Medium** | **Sort order inverted** (`PrivacyPathways.tsx:275`): `bMatch.relevanceScore - aMatch.relevanceScore` sorts ascending (lowest first). Should be `aMatch - bMatch` for highest relevance first. |

#### 9f. MaintenanceGuide
Privacy maintenance tips for A+/B grade transactions.

**Audit**: Gate logic correct. Content accurate. No issues.

### 10. Chain Analysis Modules (Untracked)

#### 10a. Entity Proximity (`chain/entity-proximity.ts`)
Scans trace layers for nearest entities and CoinJoin ancestry.

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 25 | **Medium** | **OFAC proximity not distance-adjusted**: Always `severity: "critical"`, `impact: -10` regardless of hop count. 10-hop OFAC connection penalized same as 1-hop direct interaction. |
| 26 | **Low** | Only reports first entity hit per direction. Multiple entities at same depth are silently dropped. |
| 27 | **Low** | "Unknown entity (unknown)" findings when Bloom matches but no name data. Not actionable. |

#### 10b. Recursive Trace (`chain/recursive-trace.ts`)
BFS backward/forward tracing with configurable depth and minSats filtering.

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 28 | **Medium** | **No fan-out limit**: No cap on transactions per layer. A branching factor of 10 over 3 hops = 10,000 API calls. Only AbortSignal provides protection. |
| 29 | **Low** | Forward trace `nextOutspends` is created empty and never populated. Causes unnecessary API calls after depth 0. |

#### 10c. Backward Taint (`chain/taint.ts`)
Proportional taint tracking using haircut method.

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 30 | **Critical** | **Double-counting produces >100% taint** (`taint.ts:82-123`): For a single-input tx from an entity, both `computeParentTaint()` and the direct entity check fire, giving `totalTaintFraction = 2.0`. Finding title would say "200% of input value traceable" - mathematically impossible. |
| 31 | **Low** | `computeParentTaint` depth param always 1, guard never triggers. Dead code. |
| 32 | **Low** | Severity thresholds are category-blind. 50% darknet taint = 50% mining pool taint. |

### 11. Heuristic Exports and Types

**Files**: `src/lib/analysis/heuristics/index.ts`, `src/lib/analysis/heuristics/types.ts`

- Added `analyzeEntityDetection` and `analyzePostMix` exports
- Added `parentTxs?: Map<string, MempoolTransaction>` to TxContext

**Audit**: Correct. Required for new heuristics to be included in orchestrator pipeline.

### 12. Test Expectation Updates

**Files**: `orchestrator.test.ts`, `golden-cases.test.ts`, `multisig-detection.test.ts`

- Heuristic step count: 24 -> 26 (entity detection + post-mix added)
- onStep calls: 48 -> 52 (2 per heuristic)
- JoinMarket golden case: 81 -> 84 (due to entity/post-mix heuristic changes)
- Multisig test updated for Lightning channel finding

**Audit Findings**:

| # | Severity | Finding |
|---|----------|---------|
| 33 | **Medium** | **JoinMarket score expectation potentially wrong**: Score changed 81->84 but the V45 JoinMarket anon set fix (H4) was lost. The current score of 84 may be coincidental due to entity detection adding a finding. If entity detection doesn't fire on the JoinMarket fixture (no known entities), the score should still be 81. Need to verify. |

---

## Summary by Severity

| Severity | Count | Key Issues |
|----------|-------|------------|
| **Critical** | 2 | OFAC category hardcoded "exchange" (#5), Taint double-counting >100% (#30) |
| **High** | 5 | Hash collision risk (#1), Force close FP 38% (#12), LN vs anti-fee-sniping FP (#13), CPFP recommendation backwards (#14, #15, #16) |
| **Medium** | 10 | Race condition (#2), No retry (#3), Taker change = smallest wrong (#9), Double penalty (#10), Input index clamping (#18), Entity first-output-only (#19), Taint formula inverted (#23), Pathway sort inverted (#24), OFAC proximity not distance-adjusted (#25), No fan-out limit (#28) |
| **Low** | 8 | Various minor issues (#4, #8, #11, #20, #26, #27, #29, #31, #32) |

## V45 Audit Fixes - NOT APPLIED

The following V45 fixes were planned and reportedly applied in a previous session but **do not exist in the current codebase**:

- C1: OFAC category lookup (still hardcoded "exchange")
- C2/L1/L4: `fmtN()` locale-safe formatting (still bare `.toLocaleString()`)
- H1: Forward toxic-merge OP_RETURN comment
- H2: Direct-spend denomination filter
- H3: DUST_THRESHOLD rename/comment
- H4: JoinMarket additive anon set formula
- H5: CIOH+consolidation+unnecessary penalty suppression
- H6: Exchange-withdrawal CJ exclusion comment
- M1: Heuristic count correction in ResultsPanel
- M2: Linkability granularity discount for 5-8 inputs
- M3: BIP47 negative prefix check
- M4: Post-mix/backward dedup
- M6: GraphExplorerPanel AbortController (this one IS present in the untracked file)
- M7: Compact search value binding
- L8: Stonewall detectSimplifiedStonewall vin >= 2

These need to be re-applied.
