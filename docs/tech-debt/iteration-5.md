# Tech Debt Cleanup - Iteration 5

**Date:** 2026-03-15
**Status:** Complete - 830 tests pass, 0 lint errors, build succeeds

## Changes Made

### HIGH PRIORITY

#### 1. useSyncExternalStore factory
- **Created** `src/hooks/createLocalStorageStore.ts` - generic factory for localStorage-backed stores
- **Refactored** 4 hooks to use factory: useBookmarks, useRecentScans, useCustomApi, useDevMode
- ~100 lines of duplicated subscribe/getSnapshot/cache boilerplate eliminated

#### 2. Test fixtures consolidated
- **Updated** 3 test files to import from shared `tx-factory.ts`:
  - useGraphExpansion.test.ts, mempool.test.ts, post-mix.test.ts
- Removed local makeTx/makeVinObj/makeVoutObj duplicates

#### 3. Severity maps consistency
- **Added** missing `low` key to `SEVERITY_COLORS` and `SEVERITY_DOT` in severity.ts
- All 4 maps now have all 5 severity levels

### MEDIUM PRIORITY

#### 4. Fiat-rounding wrappers removed
- **Removed** 4 trivial wrappers from round-amount.ts (getMatchingRoundUsd/Eur, isRoundUsd/EurAmount)
- **Updated** change-detection.ts and test file to use `getMatchingRoundFiat` directly

#### 5. Dead re-exports cleaned
- **Removed** unused `applyCrossHeuristicRules` re-export from orchestrator.ts

#### 6. Error handling consistency
- **Added** console.error to orchestrator.ts catch blocks, matching address-orchestrator.ts

#### 7. IIFE extracted to useMemo
- **Refactored** xpub address count computation in page.tsx from inline IIFE to useMemo

#### 8. Dead onSubmit removed from useKeyboardNav
- **Removed** unused onSubmit option, ref, and Enter key handler

## Files Changed
- 1 file created, 14 files modified
