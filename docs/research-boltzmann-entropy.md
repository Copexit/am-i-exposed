# Boltzmann Entropy Research Reference

This document summarizes the foundational research behind our entropy implementation (H5) and provides a comprehensive reference for Bitcoin transaction privacy analysis.

## The Boltzmann Framework

**Origin:** LaurentMT (~2015), creator of the OXT.me Boltzmann tool.

The Boltzmann framework defines transaction entropy as:

```
E = log2(N)
```

where N is the number of valid interpretations (input-to-output mappings) of a transaction. Higher entropy means more ambiguity for an adversary attempting to trace fund flows.

Key concepts:
- **Intrinsic entropy**: The theoretical maximum entropy based on transaction structure alone
- **Actual entropy**: The effective entropy after accounting for deterministic links (where an output can only be funded by one specific input)
- **Link probability matrix**: For each (input, output) pair, the probability that the input funded that output, computed by summing over all valid interpretations

LaurentMT's original implementation enumerated all valid sub-mappings, computed the probability matrix, and derived Shannon entropy from it. This was computationally expensive but exact.

**Source:** LaurentMT, "Bitcoin Transactions & Privacy" (Parts 1-3), gist.github.com/LaurentMT

---

## The Partition Formula

For equal-value CoinJoin transactions (where all n outputs have the same value), the number of valid interpretations can be computed exactly using integer partitions:

```
N = sum over all integer partitions (s1, s2, ..., sk) of n:
    n!^2 / (prod(si!^2) * prod(mj!))
```

where:
- `(s1, s2, ..., sk)` is a partition of n (the parts sum to n)
- `mj` = multiplicity of each distinct part size

### Worked Example: n=5 (Whirlpool)

The 7 integer partitions of 5:

| Partition | prod(si!^2) | Multiplicities | prod(mj!) | Term = 14400 / (prod * mult) |
|---|---|---|---|---|
| [5] | (5!)^2 = 14400 | {5:1} | 1! = 1 | 1 |
| [4,1] | (4!)^2 * (1!)^2 = 576 | {4:1, 1:1} | 1 | 25 |
| [3,2] | (3!)^2 * (2!)^2 = 144 | {3:1, 2:1} | 1 | 100 |
| [3,1,1] | (3!)^2 * (1!)^4 = 36 | {3:1, 1:2} | 2! = 2 | 200 |
| [2,2,1] | (2!)^4 * (1!)^2 = 16 | {2:2, 1:1} | 2! = 2 | 450 |
| [2,1,1,1] | (2!)^2 * (1!)^6 = 4 | {2:1, 1:3} | 3! = 6 | 600 |
| [1,1,1,1,1] | (1!)^10 = 1 | {1:5} | 5! = 120 | 120 |

n!^2 = (5!)^2 = 14400.

For partition [1,1,1,1,1] (5 parts of size 1):
- prod(si!^2) = (1!)^10 = 1
- Multiplicities: {1: 5}, so prod(mj!) = 5! = 120
- Term = 14400 / (1 * 120) = 120

For partition [2,1,1,1] (one part of 2, three parts of 1):
- prod(si!^2) = (2!)^2 * (1!)^6 = 4
- Multiplicities: {2: 1, 1: 3}, so prod(mj!) = 1! * 3! = 6
- Term = 14400 / (4 * 6) = 600

For partition [2,2,1]:
- prod(si!^2) = (2!)^4 * (1!)^2 = 16
- Multiplicities: {2: 2, 1: 1}, so prod(mj!) = 2! * 1! = 2
- Term = 14400 / (16 * 2) = 450

For partition [3,1,1]:
- prod(si!^2) = (3!)^2 * (1!)^4 = 36
- Multiplicities: {3: 1, 1: 2}, so prod(mj!) = 1! * 2! = 2
- Term = 14400 / (36 * 2) = 200

For partition [3,2]:
- prod(si!^2) = (3!)^2 * (2!)^2 = 144
- Multiplicities: {3: 1, 2: 1}, so prod(mj!) = 1
- Term = 14400 / 144 = 100

For partition [4,1]:
- prod(si!^2) = (4!)^2 * (1!)^2 = 576
- Multiplicities: {4: 1, 1: 1}, so prod(mj!) = 1
- Term = 14400 / 576 = 25

For partition [5]:
- prod(si!^2) = (5!)^2 = 14400
- Multiplicities: {5: 1}, so prod(mj!) = 1
- Term = 14400 / 14400 = 1

**Total N = 120 + 600 + 450 + 200 + 100 + 25 + 1 = 1,496**

---

## Reference Values Table

| n | Interpretations (N) | Entropy E = log2(N) |
|---|---|---|
| 2 | 3 | 1.58 bits |
| 3 | 16 | 4.00 bits |
| 4 | 131 | 7.03 bits |
| 5 | 1,496 | 10.55 bits |
| 6 | 22,482 | 14.46 bits |
| 7 | 426,833 | 18.70 bits |
| 8 | 9,934,563 | 23.24 bits |
| 9 | ~277,006,192 | ~28.05 bits |

Note: The partition formula accounts for many-to-many mappings (one input funding multiple outputs). The classic permutation model (n!) only counts one-to-one mappings and significantly undercounts: e.g. for n=5, permutations give 120 vs. 1,496 from the partition formula.

---

## Implementation Notes

Our implementation in `entropy.ts` uses `boltzmannEqualOutputs(n)` which generates all integer partitions of n and applies the formula above. This is exact for n <= 50 (at most ~204,226 partitions for n=50).

For n > 50, we fall back to an asymptotic approximation.

For mixed-value transactions (non-CoinJoin), we use assignment-based enumeration which is a lower bound but reasonable for typical transactions.

---

## Deterministic Links

A deterministic link exists when an output can only be funded by one specific input (or set of inputs). CoinJoin Sudoku (Kristov Atlas) showed that even in CoinJoin transactions, some input-output links may have probability 1.0, meaning the CoinJoin provides zero privacy for those specific participants.

Detection: If the link probability matrix has any entry LP = 1.0, that link is deterministic. Our current implementation does not compute the full link probability matrix, but the entropy calculation implicitly accounts for deterministic links (they reduce the number of valid interpretations).

---

## Steganographic Transactions

LaurentMT's essay "Hell is Other People" introduced the concept of steganographic transactions - transactions designed to look like something they're not:

- **PayJoin (BIP78)**: Looks like a normal payment but the receiver contributes an input, breaking CIOH
- **Stonewall**: Simulated 2-party CoinJoin from a single wallet (4 outputs: 2 equal + 2 change)
- **STONEWALLx2**: Real collaborative CoinJoin with the Stonewall structure
- **Ricochet**: Adds intermediate hops to increase the distance between CoinJoin and exchange deposit

These techniques exploit the fact that chain analysis relies on heuristics. If a transaction is designed to violate the assumptions of those heuristics, the analysis produces false results.

---

## The Asymmetric Game

Privacy-Enhancing Technologies (PETs) face a harder challenge than chain analysts:

- Analysts benefit from **Bayesian updating**: each new heuristic narrows the possibility space
- Privacy tools must defeat **all** heuristics simultaneously - one slip undoes everything
- A single participant in a CoinJoin with poor OPSEC can compromise other participants' privacy
- Temporal analysis, network-level surveillance, and exchange KYC provide independent correlation channels

This asymmetry is why entropy alone is insufficient as a privacy metric. High entropy is necessary but not sufficient for privacy.

---

## Wallet Fingerprinting History

Chain analysis evolved from naive CIOH clustering (2011-2013) through increasingly sophisticated techniques:

1. **2011-2013**: Reid & Harriman, Ron & Shamir - first academic address clustering via CIOH
2. **2013**: Maxwell proposes CoinJoin as a countermeasure
3. **2015**: LaurentMT defines the Boltzmann framework; Meiklejohn et al. scale clustering
4. **2017**: Wallet fingerprinting via nLockTime, nSequence emerges (Bitcoin Core's anti-fee-sniping)
5. **2019**: Low-R signature grinding (Bitcoin Core 0.17+) becomes a reliable fingerprint
6. **2020s**: ML-based clustering, BIP69 detection, Taproot adoption begins neutralizing fingerprints

**Sources:**
- Spiral BTC, "The Scroll #3: A Brief History of Wallet Clustering"
- OXT Research / ErgoBTC, "Understanding Bitcoin Privacy with OXT" (Parts 1-4)
- 0xB10C, wallet fingerprinting empirical analysis

---

## Credits

This implementation and research compilation would not be possible without:

- **LaurentMT** - Creator of the Boltzmann entropy framework
- **Greg Maxwell** - Inventor of CoinJoin (2013)
- **OXT Research / ErgoBTC** - Educational series on Bitcoin privacy
- **Kristov Atlas** - CoinJoin Sudoku research
- **Spiral BTC** - Historical survey of chain analysis
- **privacidadbitcoin.com** - Spanish-language Bitcoin privacy education

---

*This document is part of the am-i.exposed project. See also: `privacy-engine.md` for the full heuristic reference, `archive/README.md` for archived research articles.*
