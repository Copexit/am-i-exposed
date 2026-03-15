# Tech Debt Cleanup - Iteration 11

**Date:** 2026-03-15
**Status:** Complete - 822 tests pass, 0 lint errors (3 warnings in excluded files), build succeeds
**Test count change:** 830 -> 822 (8 tests removed with deleted dead code/test files)

## Changes Made

### Dead Code Removed (~360 lines)
1. **Deleted** `src/lib/recommendations/pathway-matcher.ts` (106 lines) - no imports
2. **Deleted** `src/lib/api/analysis-api.ts` (203 lines) - no production consumers
3. **Deleted** `src/lib/api/__tests__/analysis-api.test.ts` (59 lines)
4. **Deleted** `src/lib/analysis/entity-filter/osint-types.ts` (51 lines) - only used by type test
5. **Removed** OSINT types test section from filter-types.test.ts (46 lines)

### Lint Warnings Reduced (21 -> 3)
6. **ESLint config** - added `varsIgnorePattern: "^_"`, `caughtErrorsIgnorePattern: "^_"`, added scripts/screenshots to ignores
7. **useGraphExpansion.ts** - fixed 2 missing dependency warnings (state.maxNodes)
8. **viz-smoke.test.tsx** - fixed 7 no-unused-vars warnings
9. **ShareButtons.tsx** - un-exported internal getShareUrl
10. **6 script files** - prefixed unused vars with `_`

## Files Changed
- 4 files deleted, ~15 files modified
- Remaining 3 lint warnings are in files excluded from modification (other agent's territory)
