# Tech Debt Cleanup - Iteration 12 (Final)

**Date:** 2026-03-15
**Status:** Complete - 822 tests pass, 0 lint errors (3 warnings in excluded files), build succeeds

## Changes Made

### Dead Export Cleanup (12 items)
- De-exported 11 types/constants only used within their own files across 10 files
- Deleted dead `probColorRgba()` function from linkabilityColors.ts (18 lines)

### Documentation Accuracy (9 corrections)
Updated `docs/development-guide.md` to reflect codebase reality:
- Removed references to deleted components (MaintenanceGuide, PrivacyPathways)
- Removed references to deleted modules (bdd.ts, queue.ts, cache.ts, payjoin.ts)
- Fixed file references (entity-loader -> filter-loader, queue -> rate-limiter)
- Updated heuristic counts (32 -> 31 total, 26 -> 25 registered, 14 -> 13 chain)
- Removed PayJoin suppression from cross-heuristic docs
- Removed "Full Boltzmann entropy" from remaining ideas (already implemented)

### Final Audit (clean)
- No `as any` in production code
- No unused dependencies
- No dead source files
- No em dashes
- 3 remaining lint warnings all in files excluded from modification

## Files Changed
- 11 files modified
