# Research Archive

Locally saved copies of key research articles referenced by the am-i.exposed privacy engine. These are preserved for offline reference and long-term availability.

## OXT Research - "Understanding Bitcoin Privacy with OXT"

A comprehensive 4-part educational series on Bitcoin transaction privacy, originally published on the OXT Research blog (2021). Written by ErgoBTC.

| Part | Title | Topics | Archive URL |
|---|---|---|---|
| 1/4 | Introduction to Bitcoin Privacy | UTXOs, transaction structure, change detection heuristics | [archive.ph/1xAw7](https://archive.ph/1xAw7) |
| 2/4 | Transaction Graphs & Clustering | Transaction graphs, CIOH, wallet clustering, entity identification | [archive.ph/TDvjy](https://archive.ph/TDvjy) |
| 3/4 | Entropy & Boltzmann Analysis | Entropy E = log2(N), Boltzmann framework, CoinJoin interpretations, link probability | [archive.ph/suxyq](https://archive.ph/suxyq) |
| 4/4 | Defensive Measures | Whirlpool, STONEWALL, PayJoin (BIP47/BIP78), privacy best practices | [archive.ph/Aw6zC](https://archive.ph/Aw6zC) |

These articles directly informed our heuristic implementations (H1-H5, H8, H11) and user-facing explanations.

## Additional Archived Materials

- `Como calcular la entropia en CoinJoin.pdf` - Spanish-language reference on computing CoinJoin entropy using the Boltzmann partition formula. Source: privacidadbitcoin.com. Contains worked examples and reference values that helped identify the permutation vs. partition counting bug in our original entropy implementation.

---

*Files in this directory are archived for research purposes. See `../research-boltzmann-entropy.md` for a comprehensive research summary, and `../privacy-engine.md` for the full technical reference.*
