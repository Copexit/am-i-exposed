# Tech Debt Cleanup - Iteration 6

**Date:** 2026-03-15
**Status:** Complete - 830 tests pass, 0 lint errors, build succeeds

## Changes Made

### HIGH PRIORITY

#### 1. Removed unused dependency i18next-browser-languagedetector
- Removed from package.json and pnpm-lock.yaml (~15KB bundle savings)

#### 2. Typed severity maps with Record<Severity, string>
- All 4 maps in severity.ts now use proper Severity type instead of Record<string, string>

#### 3. Chain modules OP_RETURN filtering standardized
- Replaced 10 inline `!o.scriptpubkey.startsWith("6a")` filters with `getSpendableOutputs()` in:
  - backward.ts (2), spending-patterns.ts (5), coinjoin-quality.ts (1), forward.ts (2)

#### 4. Hardcoded dust threshold replaced
- 3 literal `1000` values in backward.ts replaced with `DUST_THRESHOLD` constant

### MEDIUM PRIORITY

#### 5. Unused imports/variables cleaned
- TxFlowDiagram.tsx: removed unused probColorRgba, calcVsize, createPath
- ChartTooltip.tsx: removed stale eslint-disable directive

#### 6. Hardcoded hex colors replaced with SVG_COLORS
- GraphExplorer.tsx ENTITY_CATEGORY_COLORS now uses SVG_COLORS references where applicable

#### 7. Extracted useFullscreen hook
- Created `src/hooks/useFullscreen.ts` - manages expanded state, Escape key, body scroll
- Applied in GraphExplorer.tsx and TxFlowDiagram.tsx

## Files Changed
- 1 file created, 10 files modified, package.json/lockfile updated
