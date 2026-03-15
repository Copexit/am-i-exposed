# Tech Debt Cleanup - Iteration 7

**Date:** 2026-03-15
**Status:** Complete - 830 tests pass, 0 lint errors, build succeeds

## Changes Made

### GraphExplorer.tsx internal cleanup
1. **Extracted** `getEdgeMaxProb()` and `edgePath()` helpers (deduplicated ~20 lines)
2. **Extracted** `GraphIcon` component (inline SVG duplicated in toolbar + fullscreen header)
3. **Extracted** `HEAT_TIERS` constant for score thresholds in `getNodeColor()`
4. **Named** auto-scroll margin magic numbers as `SCROLL_MARGIN_X`/`SCROLL_MARGIN_Y`

### Type safety: Sankey layout types
5. **Created** `src/components/viz/shared/sankeyTypes.ts` with `SankeyComputedNode`/`SankeyComputedLink`
6. **Replaced** 11 `as unknown as` casts in TxFlowDiagram.tsx (7) and CoinJoinStructure.tsx (4)

### Dead exports removed
7. **Un-exported** `AUTO_COMPUTE_MAX_TOTAL`, `createWorker`, `mergePartialResults` from boltzmann-pool.ts
8. **Removed** dead `ENTITY_LAST_UPDATED` export from entities.ts

### Bug fix
9. **Fixed** unnecessary `null as unknown as MempoolAddress` cast in useWalletAnalysis.ts

## Files Changed
- 1 file created (sankeyTypes.ts), 6 files modified
