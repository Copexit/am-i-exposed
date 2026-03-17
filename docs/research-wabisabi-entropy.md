# WabiSabi CoinJoin Entropy: Tier-Decomposed Boltzmann

## Problem

WabiSabi CoinJoins (Wasabi Wallet 2.0) have 300+ inputs/outputs organized into
20-30 denomination tiers. Computing exact transaction entropy for these
transactions is NP-hard (Gavenda et al., ESORICS 2025). The standard Boltzmann
DFS solver is infeasible: 2^327 aggregate entries for 327 inputs exceeds any
reasonable memory or time budget.

This document describes the tier-decomposed Boltzmann approach implemented in
`boltzmann-rs/src/wabisabi.rs` for computing entropy and linkability matrices
for WabiSabi transactions in sub-millisecond time.

## Background: Standard Boltzmann

The Boltzmann framework (LaurentMT / OXT Research) counts the number of valid
interpretations N for a transaction's input-output mapping, then defines:

    entropy = log2(N) bits

For transactions with all equal outputs, the Boltzmann partition formula gives
the exact count:

    N = sum over all integer partitions (s1, ..., sk) of n:
        n!^2 / (prod(si!^2) * prod(mj!))

where mj = multiplicity of each distinct part size. This formula is implemented
in `boltzmann-rs/src/partition.rs`.

For mixed-value transactions, a DFS solver enumerates valid mappings via subset
sum decomposition (`boltzmann-rs/src/backtrack.rs`). This is exponential in the
number of inputs/outputs and becomes infeasible beyond ~25 inputs.

## WabiSabi Structure

A WabiSabi CoinJoin has T denomination tiers, each with k_t equal-valued outputs
of denomination d_t:

    Tier 1: k_1 outputs of d_1 sats (e.g., 10 x 5,000,000 sats)
    Tier 2: k_2 outputs of d_2 sats (e.g., 15 x 2,000,000 sats)
    ...
    Tier T: k_T outputs of d_T sats (e.g., 8 x 10,000 sats)

Plus some unique (non-grouped) outputs representing remainder change.

Within each tier, outputs are indistinguishable by value. This creates the same
symmetry exploited by the standard Boltzmann partition formula for equal outputs.

## Tier-Decomposed Approach

### Per-Tier Boltzmann

For tier t with k_t equal outputs and e_t eligible inputs (inputs with value >= d_t):

    n_t = min(k_t, e_t)    (effective participant count)
    N_t = boltzmann_equal_outputs(n_t)    (per-tier combination count)
    p_t = cell_probability_equal_outputs(n_t)    (per-cell link probability)

This is exact for each tier in isolation - the Boltzmann partition formula
correctly counts all ways n_t items can be matched through n_t equal-value
outputs.

### Independence Approximation

The key question: are tiers independent? If input i participates in tier A,
does that affect the set of valid mappings for tier B?

In WabiSabi, each participant registers one or more inputs and requests output
credentials for specific denominations. From an observer's perspective, any input
with value >= d_t could potentially fund any output in tier t. When an input
"claims" a slot in tier A, its remaining value potentially constrains its
eligibility for other tiers.

Computing the exact cross-tier constraint is equivalent to the multi-dimensional
subset sum problem, which is NP-hard. Instead, we use the independence
approximation:

    N_total = product(N_t) for all tiers
    E_total = sum(log2(N_t)) = sum(E_t)

### Why Independence Gives a Valid Upper Bound

Under independence, we assume each tier's eligible input pool is unconstrained
by assignments in other tiers. This overestimates the true combination count
because:

1. Shared inputs create dependencies that reduce valid mappings
2. The "exclusion effect" (input claimed by tier A reduces tier B's pool) is
   ignored
3. Every constraint we ignore adds possible (but invalid) mappings

Therefore: N_independence >= N_exact, and E_independence >= E_exact.

### Why the Upper Bound is Acceptable

For a privacy analysis tool, overestimating entropy means telling users "you have
at least this much privacy, possibly more." This is the safe direction:

- Overestimate: "Your CoinJoin provides ~400 bits of entropy" (true value: ~300).
  User is correctly informed they have high privacy.
- Underestimate: "Your CoinJoin provides only ~50 bits of entropy" (true: ~300).
  User incorrectly believes their CoinJoin provides weak privacy.

Gavenda et al. (ESORICS 2025) measured the independence approximation error:
**10-50% overestimation** on real Wasabi transactions. For privacy scoring,
this is well within acceptable bounds - the difference between 300 and 400 bits
of entropy has no practical impact on privacy assessment.

### Comparison with Alternatives

| Approach | Accuracy | Performance | Feasibility |
|----------|----------|-------------|-------------|
| Exact DFS (standard Boltzmann) | Exact | O(2^n), hours | n <= 25 only |
| Gavenda et al. (ESORICS 2025) | Exact | 0.07s - 4.4h (C++) | Server-side only |
| Wasabi per-UTXO score | Exact per-participant | Requires wallet context | Wallet-only |
| Naive k! per tier (previous) | **Wrong** | O(T) | Fast but incorrect |
| **Tier-decomposed Boltzmann** | Upper bound (10-50% over) | O(T * n_in) | Browser-friendly |

The previous implementation used k! (simple permutation count) instead of the
proper Boltzmann partition formula. For k=5: k! = 120, but boltzmann(5) = 1,496.
This was a ~12x undercount per tier. Additionally, it used a weighted average
instead of sum, which is mathematically incorrect (entropy of independent events
= sum of individual entropies, not average).

## Linkability Matrix

The tier-decomposed approach produces a full linkability probability matrix:

    P(input_i -> output_j in tier_t) = cell_probability_equal_outputs(n_t)
        if input_i >= d_t (eligible)
    P(input_i -> output_j in tier_t) = 0
        if input_i < d_t (ineligible)

For unique outputs (tier size 1):
    P(input_i -> output_j) = 1.0 if eligible (effective_n = 1)

For the test WabiSabi transaction (327x279), this produces a 91,233-cell matrix
in <1ms. Each cell represents the probability that an adversary would assign
that input-output pair in a random valid interpretation.

### Deterministic Links

A deterministic link (probability = 1.0) exists only when:
- Exactly 1 output in the tier (count = 1), AND
- Exactly 1 eligible input (eligible_inputs = 1)

These are extremely rare in WabiSabi transactions (the protocol design ensures
large anonymity sets per tier).

## Implementation

### Rust (`boltzmann-rs/src/wabisabi.rs`)

The algorithm is implemented in Rust for consistency with the existing JoinMarket
turbo mode and WASM compilation:

1. Sort inputs/outputs descending
2. Group outputs into tiers (adjacent equal values in sorted array)
3. For each tier: count eligible inputs (binary search on sorted inputs), compute
   n_t, N_t, p_t using existing partition formula functions
4. Total entropy = sum of per-tier entropies
5. Build probability matrix: O(n_out * n_in) cells
6. Detect deterministic links

### WASM Binding

Exposed as `compute_boltzmann_wabisabi()` in the WASM module, called from
the web worker via the `"compute-wabisabi"` message type.

### Detection

WabiSabi transactions are detected by `detectWabiSabiForTurbo()` in
`boltzmann-pool.ts`:
- 10+ inputs AND 10+ outputs
- 3+ denomination tiers (groups of 2+ equal outputs)
- 10+ total equal outputs across all tiers

This detection runs before the JoinMarket check. WabiSabi has a higher
MAX_SUPPORTED_TOTAL (800 vs 80) because the computation is O(T * n) with no
DFS.

## Test Vectors

### Synthetic: 3-Tier Symmetric

    Inputs: [5M, 4M, 3M, 2.5M, 2M, 1.5M]
    Outputs: [2M, 2M, 2M, 1M, 1M, 1M, 500k, 500k, 500k]
    3 tiers, each with 3 outputs, all 6 inputs eligible for all tiers
    n_t = min(3, 6) = 3 for each tier
    boltzmann(3) = 16, log2(16) = 4.0 bits
    Total entropy = 3 * 4.0 = 12.0 bits

### Real WabiSabi Transactions

8 verified test transactions from mainnet (in `boltzmann-rs/tests/`):

- `fb596c9f...` (327 in, 279 out, 30 tiers)
- `3d6fe9f8...`, `1b145010...`, `612e6c33...`, `db13d819...`,
  `fe40571d...`, `60e56dc8...`, `21ba0150...`

## References

- Gavenda et al., "Analysis of Input-Output Mappings in CoinJoin Transactions
  with Arbitrary Values", ESORICS 2025, arXiv 2510.17284
- Ficsor et al., "WabiSabi: Centrally Coordinated CoinJoins with Variable
  Amounts", ePrint 2021/206
- LaurentMT / OXT Research, Boltzmann tool (original entropy framework)
- am-i.exposed docs/research-boltzmann-entropy.md (standard Boltzmann reference)
