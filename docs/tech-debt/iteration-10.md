# Tech Debt Cleanup - Iteration 10

**Date:** 2026-03-15
**Status:** Complete - 830 tests pass, 0 lint errors, build succeeds

## Changes Made

### Dead Components Removed (1,283 lines)
1. **Deleted** `src/components/WalletGuide.tsx` (526 lines) - replaced by /guide page
2. **Deleted** `src/components/MaintenanceGuide.tsx` (135 lines) - replaced by /guide page
3. **Deleted** `src/components/PrivacyPathways.tsx` (622 lines) - replaced by /guide page

### Circular Dependency Fixed
4. **Moved** `BoltzmannWorkerResult` interface from useBoltzmann.ts to boltzmann-pool.ts
5. **Removed** duplicate `BoltzmannProgress` interface from useBoltzmann.ts
6. **Updated** 9 files to import from the lib layer instead of the hook layer

### Type Safety
7. **Eliminated** 4 redundant `as Entity[]` casts in entities.ts (cast once at module level)
8. **Removed** redundant `as number` and `as BoltzmannWorkerResult` casts in boltzmann-pool.ts

### Audit (clean)
- No `as any` in production code (only in test mocks)
- No console.log in production code
- No TODO/FIXME/HACK referencing completed work
- No empty catch blocks without comments
- No commented-out code blocks

## Files Changed
- 3 files deleted (~1,283 lines), 12 files modified
