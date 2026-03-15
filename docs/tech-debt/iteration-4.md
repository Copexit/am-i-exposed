# Tech Debt Cleanup - Iteration 4

**Date:** 2026-03-15
**Status:** Complete - 830 tests pass, 0 lint errors, build succeeds

## Changes Made

### HIGH PRIORITY

#### 1. Dead sessionStorage cache module deleted
- **Deleted** `src/lib/api/cache.ts` (~86 lines) - superseded by idb-cache.ts

#### 2. OG/Twitter image template deduplication (~630 lines saved)
- **Created** `src/app/og-template.tsx` with shared `createOgImageResponse(title, subtitle)`
- **Rewrote** 10 files across about/faq/glossary/methodology/setup-guide from ~70 lines each to ~15 lines

#### 3. scoreToGrade deduplication
- **Exported** `scoreToGrade` from `src/lib/scoring/score.ts`
- **Removed** duplicate from `wallet-audit.ts`

#### 4. Cached-client withIdbCache helper
- **Extracted** `withIdbCache<T>()` helper in cached-client.ts
- All 8 methods now delegate to it instead of repeating cache-or-fetch pattern

### MEDIUM PRIORITY

#### 5. feeRate() deduplicated
- **Added** `calcFeeRate()` to `src/lib/format.ts`
- **Removed** local copies from TxSummary, TxFlowDiagram, CoinJoinStructure

#### 6. vsize calculation deduplicated
- **Added** `calcVsize()` to `src/lib/format.ts`
- **Replaced** `Math.ceil(tx.weight / 4)` in 5 files (9 occurrences)

#### 7. Historical price methods deduplicated
- **Extracted** `getHistoricalCurrencyPrice()` in mempool.ts
- USD/EUR methods now delegate to shared function

### LOW PRIORITY

#### 8. Removed unused _grade parameter from matchPathways
#### 9. TaintPathDiagram uses truncateId() instead of raw .slice()
#### 10. Deleted dead getCachedResultWithCurrentSettings from analysis-cache.ts

## Files Changed
- 1 file deleted, 1 file created, 18 files modified
- Net reduction: ~700+ lines of duplicated code
