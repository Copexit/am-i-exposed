# Tech Debt Cleanup - Iteration 3

**Date:** 2026-03-15
**Status:** Complete - 830 tests pass, 0 lint errors, build succeeds

## Changes Made

### HIGH PRIORITY

#### 1. PSBT detectScriptType bug fix
- **Fixed** `src/lib/bitcoin/psbt.ts` - `"v0_p2pkh"` -> `"p2pkh"`, `"v0_p2sh"` -> `"p2sh"`
- These names now match mempool.space API convention used everywhere else

#### 2. OP_RETURN filtering standardized
- **Added** `getValuedOutputs()` and `getAddressedOutputs()` to `src/lib/analysis/heuristics/tx-utils.ts`
- **Updated** 11 files to use these helpers instead of inline filters:
  - `getValuedOutputs`: round-amount, exchange-pattern, entropy, coinjoin-premix, bip47-notification, peel-chain-trace, entity-match
  - `getAddressedOutputs`: change-detection, consolidation, unnecessary-input, peel-chain
- Skipped files with additional conditions beyond the standard patterns

### MEDIUM PRIORITY

#### 3. parseAndDerive deduplication
- **Refactored** `parseAndDerive()` in descriptor.ts to call `parseXpub()` internally (~30 lines removed)

#### 4. bytesToHex consolidation
- **Updated** psbt.ts to use `@scure/base` hex encoder, matching descriptor.ts approach

#### 5. formatSatsOrBtc promoted to shared format.ts
- **Moved** from anonymity-set.ts to `src/lib/format.ts` as shared export

### LOW PRIORITY

#### 6. hexToBigInt inlined
- Removed one-liner wrapper in descriptor.ts, inlined at call site

#### 7. getDustThreshold removed from barrel export
- Removed unused re-export from heuristics/index.ts

## Files Modified
- 17 files modified
- Net reduction: ~60 lines of duplicated code + 1 bug fix
