# Tech Debt Cleanup - Iteration 8

**Date:** 2026-03-15
**Status:** Complete - 830 tests pass, 0 lint errors, build succeeds

## Changes Made

### Constants and Magic Numbers
1. **Renamed** shadowing `DUST_THRESHOLD` in wallet-audit.ts to `P2WPKH_DUST_LIMIT` (546 vs global 1000)
2. **Extracted** `MIN_COINJOIN_DENOM = 10_000` in coinjoin.ts (3 uses)
3. **Extracted** `EXTREME_DUST_SATS = 600` in dust-output.ts (2 uses)
4. **Extracted** `MAPPING_ITERATION_LIMIT = 10_000` in entropy.ts

### Dead Code Removal
5. **Un-exported** `estimateJoinMarketAnonSet` from joinmarket.ts (internal only)
6. **Removed** dead `dustOutputs` alias in dust-output.ts
7. **De-exported** 11 unused type exports across chain analysis and API modules:
   - BackwardAnalysisResult, ForwardAnalysisResult, ClusterRiskTier, EntityProximityResult, EntityHit
   - CoinJoinQualityResult, FingerprintEvolution, LinkabilityCell, LinkabilityResult
   - CacheEntry, FetchRetryOptions, CachedAnalysisResult

### Shared Utilities
8. **Added** `roundTo(n, digits)` to format.ts
9. **Replaced** 5 inline `Math.round(x * 1000) / 1000` patterns in entropy.ts, boltzmann-enhance.ts, linkability.ts
10. **Fixed** boltzmann efficiency rounding inconsistency (`Math.round(x * 10000) / 100` -> `roundTo(x * 100, 2)`)

## Files Changed
- 10 files modified
