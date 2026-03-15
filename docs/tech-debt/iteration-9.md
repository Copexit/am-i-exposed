# Tech Debt Cleanup - Iteration 9

**Date:** 2026-03-15
**Status:** Complete - 830 tests pass, 0 lint errors, build succeeds

## Changes Made

### Dead Code Removed
1. **Deleted** `src/components/CrossPromo.tsx` - never imported or rendered
2. **Deleted** `src/components/viz/ClusterTimeline.tsx` - never imported or rendered
3. **Removed** unused `ackXpubPrivacy()` from XpubPrivacyWarning.tsx
4. **Removed** dead `INLINE_DISMISS_KEY` from TipToast.tsx (session key never set)

### Duplicate Code Consolidated
5. **Created** `src/lib/bitcoin/hex.ts` - shared `bytesToHex()` replacing identical private functions in psbt.ts and descriptor.ts

### String Literal Extraction
6. **Extracted** `LANGUAGE_STORAGE_KEY` constant in i18n/config.ts

### Exports Narrowed (17 unused type exports made module-private)
7. De-exported interfaces across 8 files:
   - useChainTrace.ts: ChainTraceParams, ChainTraceResult, ChainAnalysisParams
   - useBoltzmann.ts: BoltzmannState
   - useWalletAnalysis.ts: WalletAnalysisState
   - peel-chain-trace.ts: PeelChainHop, PeelChainTrace
   - spending-patterns.ts: SpendingPatternResult
   - joinmarket.ts: SubsetSumResult, TakerMakerResult
   - taint.ts: TaintResult, TaintBreakdown, TaintSource
   - recursive-trace.ts: TraceResult
   - pathway-matcher.ts: RelevantPathway

## Files Changed
- 2 files deleted, 1 file created, 12 files modified
