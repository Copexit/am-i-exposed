# ADR: Boltzmann WASM - Link Probability Matrix

**Status:** Accepted
**Date:** 2026-03-13

## Problem

The project has two simplified implementations for transaction entropy and linkability:

1. **`entropy.ts`** (H5 heuristic) - Computes entropy bits using the Boltzmann partition formula for equal-output CoinJoins and assignment-based enumeration for mixed-value transactions. Capped at 8 inputs/outputs, 10K iterations. Provides a scalar entropy value but not the full probability matrix.

2. **`linkability.ts`** (chain analysis module) - Simplified linkability matrix: exact brute-force for <=4 inputs/outputs (nOut^nIn), value-proportional heuristic for 5-8, null for >8. **Critically flawed**: normalizes each row to sum to 1.0, treating linkability as a probability distribution. In reality, Boltzmann rows can sum to >100% because a single valid interpretation can link one input to multiple outputs simultaneously.

Neither implements the **real** Boltzmann Link Probability Matrix (LPM) as defined by LaurentMT. The real LPM is the definitive tool for understanding transaction privacy - it answers "what is the probability that input I funded output O?" for every (input, output) pair.

## Decision

Implement the real Boltzmann LPM algorithm in Rust, compiled to WebAssembly (WASM), running in a Web Worker with configurable timeout. Display results as an interactive heat map on the results page.

The existing TypeScript implementations (`entropy.ts`, `linkability.ts`) remain unchanged - they provide fast synchronous findings during the main analysis. The WASM Boltzmann is a complementary deep analysis that runs asynchronously after the main analysis completes.

---

## The Boltzmann Algorithm

### Theory (LaurentMT, 2015)

The Boltzmann framework was created by LaurentMT and published as a three-part series:

- [Part 1: Entropy](https://gist.github.com/LaurentMT/e758767ca4038ac40aaf) - Defines transaction entropy as E = log2(N), where N is the number of valid interpretations. Introduces intrinsic, actual, and maximum entropy. Shows that ~85% of Bitcoin transactions have zero entropy (only one valid interpretation).

- [Part 2: Linkability](https://gist.github.com/LaurentMT/d361bca6dc52868573a2) - Defines the Link Probability as LP(i, o, tx) = #CombinationsWithLink(i,o) / #Combinations(tx). Introduces the Link Probability Matrix (LPM) and extends the framework to transaction chains and graphs.

- [Part 3: Attacks](https://gist.github.com/LaurentMT/e8644d5bc903f02613c6) - Demonstrates CoinJoin attacks via LPM fingerprinting. Shows the DarkWallet LPM fingerprint and the "Hell is other people" attack where one participant's poor privacy degrades others'.

### What is a "Valid Interpretation"?

A valid interpretation (or "complete mapping") is a partition of ALL inputs AND ALL outputs into groups where each group's input sum matches its output sum (within fee tolerance). This is a many-to-many mapping, not a one-to-one assignment.

For example, a transaction with inputs [I1=10M, I2=1.38M] and outputs [O1=100k, O2=9.85M, O3=100k, O4=1.27M] with fee=60k has 3 valid interpretations:

**Interpretation 1:** {I1 -> O1, O2} and {I2 -> O3, O4}
- I1 (10M) funds O1 (100k) + O2 (9.85M) = 9.95M, leaving 50k for fees
- I2 (1.38M) funds O3 (100k) + O4 (1.27M) = 1.37M, leaving 10k for fees

**Interpretation 2:** {I1 -> O2, O3} and {I2 -> O1, O4}
- I1 (10M) funds O2 (9.85M) + O3 (100k) = 9.95M, leaving 50k for fees
- I2 (1.38M) funds O1 (100k) + O4 (1.27M) = 1.37M, leaving 10k for fees

**Interpretation 3:** {I1 -> O1, O2, O3, O4} and {I2 -> nothing}
- I1 (10M) funds all outputs = 11.32M... wait, that exceeds I1. Actually:
- {I1+I2 -> O1, O2, O3, O4}: both inputs fund all outputs together

This gives N=3, so entropy E = log2(3) = 1.585 bits.

### The Link Probability Matrix

For each (input, output) pair, count how many of the N valid interpretations include a link between them:

```
LP[i][j] = #interpretations_containing_link(i,j) / N
```

For the DarkWallet example above:

```
         I1      I2
O1    [  1.0,   1/3  ]    O1 linked to I1 in all 3, to I2 in 1
O2    [  1/3,   1.0  ]    O2 linked to I2 in all 3, to I1 in 1
O3    [  2/3,   2/3  ]    O3 linked to both in 2 of 3
O4    [  2/3,   2/3  ]    O4 linked to both in 2 of 3
```

### Why Rows Can Sum to >100%

This is the critical insight that the existing `linkability.ts` gets wrong. In Interpretation 3 above, I1 is linked to O1, O2, O3, AND O4 simultaneously. When we count co-occurrences across all interpretations, a single input can be linked to multiple outputs in the same interpretation. The row for O3 sums to 2/3 + 2/3 = 4/3 > 1.0.

Normalizing rows to sum to 1.0 (as `linkability.ts` does) fundamentally misrepresents the algorithm's output. It treats the LPM as if each input funds exactly one output per interpretation, which is false for many-to-many mappings.

### Deterministic Links

When LP[i][j] = 1.0, the link between input i and output j exists in ALL valid interpretations. No matter how the adversary interprets the transaction, this specific link is certain. In the DarkWallet example, I1->O1 and I2->O2 are deterministic links (LP = 1.0).

### Intrafees

CoinJoin coordinators may charge fees (intrafees). When analyzing with intrafees enabled:
- **Maker fee**: amount the coordinator takes from each participant
- **Taker fee**: amount paid by the participant who initiated the round

Intrafees expand the solution space by allowing input-output sum differences beyond just the mining fee. The algorithm runs twice - once without intrafees, once with - and takes the result with more combinations.

### Perfect CoinJoin Entropy

For equal-output CoinJoins (e.g., Whirlpool), the number of valid interpretations can be computed analytically using the integer partition formula (see `docs/research-boltzmann-entropy.md` for the full derivation):

| Participants | Interpretations (N) | Entropy E = log2(N) |
|---|---|---|
| 2 | 3 | 1.58 bits |
| 3 | 16 | 4.00 bits |
| 4 | 131 | 7.03 bits |
| 5 | 1,496 | 10.55 bits |
| 6 | 22,482 | 14.46 bits |
| 7 | 426,833 | 18.70 bits |

---

## Algorithm Design

The implementation follows the reference implementations:
- **Java (canonical):** [Archive-Samourai-Wallet/boltzmann-java](https://github.com/Archive-Samourai-Wallet/boltzmann-java) (develop branch)
- **TypeScript (port):** [Dojo-Open-Source-Project/boltzmann](https://github.com/Dojo-Open-Source-Project/boltzmann) (master branch)

The algorithm has 4 phases:

### Phase 1: Aggregate Preparation

Compute the power set of input and output indexes. Each subset is represented as a bitmask with a precomputed sum of its constituent values.

`matchAggByVal()` finds all matching (input-subset, output-subset) pairs where the value sums are compatible:
- Without intrafees: `0 <= input_sum - output_sum <= fees`
- With intrafees: `-feesMaker <= input_sum - output_sum <= feesTaker`

### Phase 2: Input Decomposition Tree

`computeInAggCmbn()` builds a decomposition tree of valid input-subset pairs. For each input aggregate `i`, find pairs `(i, j)` where:
- `(i & j) == 0` (non-overlapping bitmasks - no input appears in both subsets)
- `i > j` (prevent counting symmetric pairs twice)
- Both `i` and `j` are in the matched aggregate set from Phase 1

Stored as a HashMap keyed by parent aggregate `i | j` (the union bitmask).

### Phase 3: Stack-Based DFS Enumeration

`computeLinkMatrix()` is the core algorithm. It uses a stack-based depth-first search (not recursion, to avoid stack overflow in WASM) to enumerate all valid complete mappings.

Each stack frame contains:
- `il`: left input sub-aggregate bitmask
- `ir`: right input sub-aggregate bitmask (to be decomposed further)
- `d_out`: output combination state - tracks which output splits are compatible with the current input decomposition

The root task starts with `il=0, ir=all_inputs_mask` and `d_out` containing the full output set.

For each task:
1. Try decompositions of `ir` from the Phase 2 tree
2. For each valid decomposition pair `(nIl, nIr)`: run `runTask()` to find compatible output splits, push new task
3. When all decompositions exhausted: pop task, run `onTaskCompleted()` to back-propagate combination counts into `dLinks` accumulator

The `dLinks` map stores `(input_mask, output_mask) -> multiplier` pairs representing how many times each link configuration appears across all valid interpretations.

### Phase 4: Matrix Finalization

`finalizeLinkMatrix()` converts the `dLinks` map into the final link count matrix:

For each `(ir_mask, ol_mask, multiplier)` in dLinks:
1. Create a temporary matrix where all cells corresponding to (bit in ir_mask, bit in ol_mask) are set to 1
2. Scale the temporary matrix by the multiplier
3. Accumulate into the final `matLnkCombinations` matrix

Then normalize: `matLnkProbabilities[o][i] = matLnkCombinations[o][i] / nbCmbn`

Note: matrix dimensions are `[nOut][nIn]` (outputs as rows, inputs as columns), matching the reference implementations.

---

## Why Rust/WASM

The Boltzmann link matrix enumeration is NP-hard for mixed-value transactions. The search space grows exponentially with the number of inputs and outputs (2^nIn * 2^nOut possible subset pairs). For transactions with 10+ inputs/outputs, the computation can take seconds to minutes.

**Why not JavaScript?**
- JavaScript is too slow for the inner loop (bitmask operations, HashMap lookups, stack management)
- A 5-input, 7-output CoinJoin with intrafees (Test 4 in our suite) produces 95 valid interpretations. A 9-input, 4-output nondeterministic tx (Test 14) produces 438. These are manageable, but larger transactions can have millions.
- JavaScript lacks efficient u32/u64 bitmask operations (bitwise ops on 32-bit integers, but the algorithm needs them heavily)

**Why Rust?**
- Compiles to compact WASM (~50-100 KB)
- Near-native execution speed for integer and bitmask operations
- No garbage collection pauses during enumeration
- Strong type system catches bitmask logic errors at compile time
- The crate is also usable as a native library (dual `cdylib` + `rlib` targets) for testing and benchmarking

**Why Web Worker?**
- WASM computation runs on a separate thread, keeping the UI responsive
- Configurable timeout prevents browser hangs on pathologically complex transactions
- Worker can be terminated instantly if the user navigates away

**Pre-built binaries:**
- WASM binaries are committed to `public/wasm/boltzmann/` (same pattern as entity filter `.bin` files)
- No Rust toolchain needed in CI or for other contributors
- `scripts/build-boltzmann-wasm.sh` rebuilds when needed

---

## Why Not Replace the Existing TS Implementation

The WASM Boltzmann does not replace `entropy.ts` or `linkability.ts`:

1. **`entropy.ts`** runs synchronously during the main analysis pass, providing instant entropy findings (H5). It handles equal-output CoinJoins analytically and estimates mixed-value entropy with capped enumeration. This keeps the analysis fast (<1s total).

2. **`linkability.ts`** provides simplified linkability findings for the chain analysis module. It is "good enough" for quick assessments and runs in the same synchronous pass.

3. **WASM Boltzmann** is a deep analysis tool that:
   - Runs asynchronously after the main analysis completes
   - Takes seconds to minutes for complex transactions
   - Produces the full probability matrix (not just a scalar entropy)
   - Is shown in a dedicated heat map component, not merged into existing findings

This separation follows the principle: fast approximate results immediately, exact deep results on demand.

---

## Architecture

```
boltzmann-rs/                          Rust crate (monorepo root)
  src/
    lib.rs                             WASM entry point (wasm-bindgen)
    types.rs                           BoltzmannResult, serialization
    analyze.rs                         Top-level orchestration + intrafees
    subset_sum.rs                      Phases 1-2: aggregate matching + decomposition tree
    backtrack.rs                       Phases 3-4: DFS enumeration + matrix finalization
    partition.rs                       Equal-output fast path (integer partitions)
  tests/
    known_txs.rs                       17 test cases from reference implementations

scripts/build-boltzmann-wasm.sh        wasm-pack build + cleanup
public/wasm/boltzmann/                 Pre-built .wasm + .js + .d.ts

src/workers/boltzmann.worker.ts        Web Worker loading WASM
src/hooks/useBoltzmann.ts              React hook managing worker lifecycle
src/components/viz/LinkabilityHeatmap.tsx  Heat map visualization
```

**Data flow:**
1. User scans a transaction (main analysis runs synchronously as before)
2. For txid-level analysis, `useBoltzmann` hook auto-computes for small txs or shows a "Compute" button for larger ones
3. Hook creates/reuses a singleton Web Worker
4. Worker loads WASM module (lazy, cached), calls `compute_boltzmann()`
5. WASM enumerates valid interpretations, builds link matrix, returns result
6. Hook receives result via `postMessage`, updates state
7. `LinkabilityHeatmap` renders the probability matrix as a color-coded grid

**Auto-compute thresholds:**
- <= 8 inputs AND <= 8 outputs: auto-compute (30s timeout)
- <= 12 inputs AND <= 12 outputs: show "Compute" button (60s timeout)
- Larger: show button + warning about computation time
- Equal-output CoinJoins: always auto-compute (analytic formula is instant)

---

## Test Suite

17 test cases sourced from the TypeScript reference implementation's `vectors.test.ts` and LaurentMT's gists. Key cases:

| # | Description | nIn x nOut | nbCmbn | Entropy |
|---|---|---|---|---|
| 1 | Consolidation (zero entropy) | 6x2 | 1 | 0 |
| 2 | Equal-value swap | 2x2 | 2 | 1.0 |
| 3 | DarkWallet CoinJoin (canonical) | 2x4 | 3 | 1.585 |
| 4 | 4-participant CoinJoin (no intrafees) | 5x7 | 1 | 0 |
| 4b | Same tx with intrafees | 5x7 | 95 | 6.570 |
| 5-6 | Synthetic mixed-value | 2x4 | 3, 5 | 1.585, 2.322 |
| 7-12 | Perfect CoinJoin P2-P7 | NxN | 3 to 426,833 | 1.585 to 18.703 |
| 13 | 3-input mixed | 3x5 | 28 | 4.807 |
| 14 | Complex nondeterministic | 9x4 | 438 | 8.775 |
| 15 | "Hell is other people" (LaurentMT) | 2x4 | 3 | 1.585 |
| 16 | Trivial 1-in, 2-out | 1x2 | 1 | 0 |
| 17 | Timeout behavior | 7x7 | partial | N/A |

Every test case verifies: exact nbCmbn, entropy to 10 decimal places, exact matLnkCombinations matrix (integer values), matLnkProbabilities to 10 decimal places, deterministic link detection, and correct matrix dimensions ([nOut][nIn]).

---

## References

- LaurentMT, "Bitcoin Transactions & Privacy (Part 1)" - https://gist.github.com/LaurentMT/e758767ca4038ac40aaf
- LaurentMT, "Bitcoin Transactions & Privacy (Part 2)" - https://gist.github.com/LaurentMT/d361bca6dc52868573a2
- LaurentMT, "Bitcoin Transactions & Privacy (Part 3)" - https://gist.github.com/LaurentMT/e8644d5bc903f02613c6
- Java reference implementation: https://github.com/Archive-Samourai-Wallet/boltzmann-java
- TypeScript reference implementation: https://github.com/Dojo-Open-Source-Project/boltzmann
- Existing project research: `docs/research-boltzmann-entropy.md`
- Gavenda et al., "Analysis of Input-Output Mappings in CoinJoin Transactions with Arbitrary Values" (ESORICS 2025, arXiv 2510.17284)

## Consequences

- Adds ~50-100 KB WASM binary to the static export
- Requires Rust toolchain only for WASM rebuilds (pre-built binaries committed to git)
- New heat map visualization in the Deep Analysis zone (Zone 11 of ResultsPanel)
- Users with older browsers lacking Web Worker support see graceful "unsupported" message
- Existing entropy/linkability findings continue to work as before - no breaking changes
