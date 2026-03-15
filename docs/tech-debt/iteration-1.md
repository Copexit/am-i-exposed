# Tech Debt Cleanup - Iteration 1

**Date:** 2026-03-15
**Status:** Complete - 844 tests pass, 0 lint errors, build succeeds

## Changes Made

### HIGH PRIORITY

#### 1. Extract `analyzeSync` to shared utility
- **Created** `src/lib/analysis/analyze-sync.ts` with shared `analyzeTransactionSync()`
- **Updated** `src/components/viz/GraphExplorer.tsx` and `src/components/GraphNodeAnalysis.tsx` to import from shared module
- **Impact:** Eliminated identical 20-line function duplicated in 2 components

#### 2. Extract coinbase guard to `isCoinbase()` utility
- **Added** `isCoinbase(tx)` to `src/lib/analysis/heuristics/tx-utils.ts`
- **Updated** 15 heuristic files to use the utility instead of inline `tx.vin.some((v) => v.is_coinbase)`:
  - round-amount, exchange-pattern, consolidation, wallet-fingerprint, witness-analysis, bip47-notification, coinjoin-premix, post-mix, anonymity-set, unnecessary-input, bip69, entity-detection, change-detection, multisig-detection, script-type-mix

### MEDIUM PRIORITY

#### 3. Extract SEVERITY_COLORS/SEVERITY_DOT to shared module
- **Created** `src/lib/severity.ts` with `SEVERITY_COLORS`, `SEVERITY_DOT`, `SEVERITY_TEXT`, `SEVERITY_BG`
- **Updated** RecoveryFlow, guide/page.tsx, ChainAnalysisPanel to import from shared module
- **Fixed** ChainAnalysisPanel to use semantic tokens instead of raw Tailwind colors

#### 4. Deduplicate RISK_CONFIG
- **Exported** `RISK_CONFIG` from `DestinationAlert.tsx`
- **Removed** duplicate `DESTINATION_ONLY_CONFIG` from `page.tsx`, replaced with import

#### 5. Deduplicate getMatchingRoundUsd/getMatchingRoundEur
- **Added** shared `getMatchingRoundFiat()` in round-amount.ts
- **Made** USD/EUR versions thin wrappers
- **Removed** unused `ROUND_USD_VALUES` alias

#### 6. Centralize SATS_PER_BTC constant
- **Added** `SATS_PER_BTC` to `src/lib/constants.ts`
- **Updated** format.ts, round-amount.ts, bdd.ts to import from constants
- **Replaced** magic `1e8` and `100_000_000` literals

#### 7. Use formatBtc() instead of inline formatting
- **Updated** anonymity-set.ts and coinjoin-premix.ts to use `formatBtc()` from `@/lib/format`

### LOW PRIORITY

#### 8. Remove dead SMALL_OUTPUT_THRESHOLD
- **Removed** unused `SMALL_OUTPUT_THRESHOLD` from constants.ts
- **Simplified** `DUST_THRESHOLD = 1000` (removed deprecation indirection)

#### 9. TxBreakdownPanel use truncateId
- **Replaced** manual `txid.slice()` with `truncateId()` utility

## Skipped (with rationale)

- **Finding 9 (isRoundSatAmount):** Different denomination lists - replacing would change behavior
- **Finding 11 (applyCrossHeuristicRulesForTest):** Actually used in 17 test invocations - not dead
- **Finding 1 (OP_RETURN filtering):** Large scope, deferred to later iteration
- **Finding 10 (dead bdd.ts module):** Potentially useful, deferred

## Files Modified
- 24 files modified, 2 files created
- Net reduction: ~120 lines of duplicated code
