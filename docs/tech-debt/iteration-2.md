# Tech Debt Cleanup - Iteration 2

**Date:** 2026-03-15
**Status:** Complete - 830 tests pass, 0 lint errors, build succeeds
**Test count change:** 844 -> 830 (14 tests removed with deleted dead code)

## Changes Made

### HIGH PRIORITY

#### 1. Dead code removal - DeepAnalysisButton + useDeepAnalysis + queue.ts (~480 lines deleted)
- **Deleted** `src/components/DeepAnalysisButton.tsx` (92 lines) - never imported
- **Deleted** `src/hooks/useDeepAnalysis.ts` (234 lines) - only used by deleted component
- **Deleted** `src/lib/api/queue.ts` (163 lines) - only used by deleted hook
- **Deleted** `src/lib/api/__tests__/queue.test.ts` (120 lines) - tests for dead module
- **Updated** `src/hooks/useWalletAnalysis.ts` to use `isLocalApi` from client.ts instead of `isLocalInstance` from deleted queue.ts

#### 2. Dead code removal - bdd.ts (~137 lines deleted)
- **Deleted** `src/lib/analysis/chain/bdd.ts` - never imported outside tests
- **Deleted** `src/lib/analysis/chain/__tests__/bdd.test.ts`

#### 3. Consolidated "is local URL?" implementations (3 -> 1)
- **Expanded** `isLocalApi()` in client.ts to cover all private ranges (::1, 172.16-31.*)
- **Updated** url-diagnostics.ts to import from client.ts instead of maintaining its own regex

### MEDIUM PRIORITY

#### 4. Reduced redundant localStorage reads in cached-client.ts
- Each method now reads `enableCache` once instead of twice per call

#### 5. Lightweight isCoinJoinTx() for chain modules
- **Added** `isCoinJoinTx()` to coinjoin.ts - structural check without constructing Finding objects
- **Updated** 6 chain modules to use it instead of full `analyzeCoinJoin().findings.some()`

#### 6. Entity proximity backward/forward deduplication
- **Extracted** `buildEntityProximityFinding()` and `entitySeverityAndImpact()` helpers
- Reduced ~150 lines of near-identical code to ~50

#### 7. sumImpact() helper
- **Added** to `src/lib/scoring/score.ts`
- **Replaced** 10 inline `.reduce()` calls across 4 files

### LOW PRIORITY

#### 8. Dead export removal - getOutputAge
- Removed from forward.ts and its tests

#### 9. Removed traceFetcher wrapper closures
- useChainTrace.ts and useAnalysis.ts now pass `api` directly

## Files Changed
- 6 files deleted (~750 lines of dead code removed)
- 14 files modified
