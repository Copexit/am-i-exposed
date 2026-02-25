# Privacy Engine - Technical Reference

## Overview

This document describes the privacy analysis engine behind **am-i.exposed**, an open-source, client-side Bitcoin privacy scanner. It is intended for cypherpunks, privacy researchers, wallet developers, and anyone who wants to understand exactly how their Bitcoin transactions are being analyzed - by us, and by adversaries.

The engine implements 16 heuristics (H1-H16) that evaluate the on-chain privacy of Bitcoin addresses and transactions. These are the same techniques - sometimes simplified, sometimes extended - that chain surveillance firms use to cluster addresses, trace fund flows, and deanonymize users.

**Why this tool exists now.** In April 2024, OXT.me and KYCP.org ("Know Your Coin Privacy") went offline following the arrest of the Samourai Wallet developers. OXT.me was the gold standard for Boltzmann entropy analysis of Bitcoin transactions, created by LaurentMT as part of OXT Research. KYCP.org provided CoinJoin analysis and entropy calculations accessible to ordinary users. Both are gone. As of today, there is no publicly available tool that combines Boltzmann entropy estimation, wallet fingerprinting detection, and multi-transaction graph analysis in a single interface. am-i.exposed fills that gap.

Everything runs client-side. No server ever sees your query and your results together. The code is open source. Verify, don't trust.

---

## Threat Model

### Adversaries

**Chain surveillance firms** - Chainalysis, Elliptic, CipherTrace (now Mastercard), Crystal Blockchain, Scorechain, and others. These companies operate full-node infrastructure, run proprietary clustering algorithms at scale, and sell deanonymization services to law enforcement, exchanges, and financial institutions. They maintain databases mapping address clusters to real-world identities. Their heuristics are more sophisticated than ours - they have access to off-chain data, proprietary intelligence feeds, and years of accumulated cluster data - but the on-chain heuristics they rely on are the same ones documented here.

**Exchanges with KYC requirements** - Any exchange that collects identity documents can link deposit and withdrawal addresses to your government ID. When combined with chain analysis, this creates an anchor point from which all connected transactions can be traced. Even if you acquire bitcoin through non-KYC means, sending to or receiving from a KYC-linked address can compromise your privacy.

**Blockchain explorers logging IP-to-query correlations** - Services like blockchain.com, blockchair.com, and even mempool.space log queries. If you search for your own address from your home IP, you have created a correlation between your IP address and your Bitcoin address. This is a metadata leak that exists entirely outside the blockchain itself. The explorer operator, anyone with access to their logs, and any network-level observer between you and the server can see which addresses you are interested in.

### What adversaries are trying to do

1. **Cluster addresses** - Group addresses controlled by the same entity. The Common Input Ownership Heuristic (H3) is the primary tool, but change detection (H2), address reuse (H8), and dust attacks (H9/H12) all contribute.

2. **Link identities** - Connect address clusters to real-world identities. This requires at least one "anchor point" - a KYC exchange deposit, a merchant payment, a donation page, a forum post containing an address.

3. **Trace fund flows** - Follow the movement of bitcoin from source to destination, even across multiple hops. Change detection, CIOH, and temporal analysis enable this.

4. **Assess privacy tool usage** - Determine whether a user has employed CoinJoins, PayJoins, or other privacy-enhancing techniques, and attempt to undo the privacy gains through post-mix analysis.

5. **Profile behavior** - Identify spending patterns, transaction timing, wallet software, and financial activity that can be correlated with other data sources.

---

## Heuristics

Each heuristic is described with its technical mechanism, privacy implications, detection method, scoring impact, and relevant references. Scoring impacts are applied as modifiers to a base score of 70.

---

### H1: Round Amount Detection

**Technical description**

A transaction output is flagged as a "round amount" if its value matches common round BTC denominations or round satoshi values. We check for:

- Round BTC values: 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0 BTC and other powers and multiples
- Round satoshi amounts: 1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000, 10000000, 50000000, 100000000 sats
- Any output value where `value % 10000 == 0` (multiples of 10,000 sats)

The check is performed against all transaction outputs.

**Why it matters for privacy**

When a user sends a payment, they typically choose a round amount - "send 0.1 BTC" or "send $500 worth." The change output, by contrast, is whatever is left over after subtracting the payment and the fee. Change is almost never round.

This means that if a transaction has two outputs and one is a round amount, an observer can confidently identify which output is the payment and which is the change. This breaks the ambiguity that protects the sender's privacy, because the change output goes back to the sender's wallet and can be traced forward through subsequent spending.

**How we detect it**

```
For each output in the transaction:
  value_btc = output.value / 100_000_000
  if value_btc matches known round BTC denominations OR
     output.value matches known round sat amounts OR
     output.value % 10000 == 0:
    flag as round amount
```

We also check for "nearly round" amounts where the fee was subtracted from the payment (e.g., a "send max" that produces slightly less than 0.1 BTC).

**Scoring impact:** -5 to -15

- Single round output in a 2-output transaction: -15 (payment direction is obvious)
- Round output in a multi-output transaction (3+ outputs): -5 (less certain which is change)
- Multiple round outputs (ambiguity preserved to some degree): -10

**References**
- Meiklejohn et al., "A Fistful of Bitcoins: Characterizing Payments Among Men with No Names" (2013) - identifies round amounts as a payment indicator
- Nick, "Data-Driven De-Anonymization in Bitcoin" (2015)

---

### H2: Change Detection

**Technical description**

Change detection attempts to identify which output in a transaction returns funds to the sender. This is one of the most consequential heuristics because correctly identifying change allows an adversary to follow the money through multiple hops. We implement four sub-heuristics:

**Sub-heuristic 2a: Address type mismatch**

If all inputs are spent from one address type (e.g., P2WPKH / bc1q) and one output matches that type while another does not, the matching output is likely change. Wallets typically generate change addresses of the same type as their receiving addresses.

```
input_types = set of address types across all inputs
for each output:
  if output.address_type in input_types:
    candidate_change.add(output)
  else:
    candidate_payment.add(output)
```

**Sub-heuristic 2b: Round payment amount leaves non-round change**

If one output is a round amount and the other is not, the non-round output is likely change. This overlaps with H1 but is scored here in the context of change identification specifically.

**Sub-heuristic 2c: Unnecessary input heuristic**

If a transaction has multiple inputs and a single input alone would have been sufficient to fund the payment output (plus fee), then the additional inputs are likely from the same wallet. This heuristic relies on the assumption that wallets select UTXOs automatically and sometimes include more than strictly necessary. The output that could have been funded by one input alone is likely the payment; the other output is likely change.

```
largest_input = max(input.value for input in tx.inputs)
for each output:
  if output.value + estimated_fee <= largest_input:
    // This output could have been funded by one input alone.
    // The other inputs were unnecessary - they are from the same wallet.
```

**Sub-heuristic 2d: Output ordering**

Some wallet software consistently places the change output in a specific position. Historically, many wallets placed change last (index 1 in a 2-output transaction). BIP69-compliant wallets sort outputs lexicographically, which randomizes position based on value and script. Bitcoin Core randomizes output order. A wallet that always puts change at the same index leaks information.

**Why it matters for privacy**

Change detection is the backbone of transaction tracing. If an adversary can identify which output is change, they know which output returns to the sender's wallet. They can then follow that change output into subsequent transactions, building a chain of custody. Break change detection, and you break most tracing.

**Scoring impact:** -5 to -30

- Self-send detected (all outputs return to sender, all inputs match): -30 or -25
- Medium confidence change detection (one sub-heuristic matches clearly): -10
- Low confidence: -5

**References**
- Meiklejohn et al., "A Fistful of Bitcoins: Characterizing Payments Among Men with No Names" (2013) - foundational change detection heuristics
- Bitcoin Wiki, "Privacy" - change avoidance section

---

### H3: Common Input Ownership Heuristic (CIOH)

**Technical description**

If a transaction spends multiple inputs, all of those inputs are assumed to be controlled by the same entity. This is the foundational clustering heuristic - the single most powerful tool in the chain surveillance arsenal. It works because constructing a valid Bitcoin transaction requires signatures from the private keys controlling each input. Under normal circumstances, only the wallet owner has access to all of those keys.

```
if len(tx.inputs) > 1:
  cluster = set()
  for input in tx.inputs:
    cluster.add(input.address)
  // All addresses in 'cluster' are now assumed to belong to the same entity
```

This heuristic is applied transitively. If address A appears in a multi-input transaction with address B, and address B appears in a different multi-input transaction with address C, then A, B, and C are all clustered together. Surveillance firms build massive cluster databases this way, containing millions of addresses per cluster for large services like exchanges.

**Critical exceptions where CIOH does not hold:**

- **CoinJoin transactions** - Multiple users contribute inputs to a single transaction. CIOH is deliberately broken. This is the entire point of CoinJoin.
- **PayJoin (P2EP / BIP78)** - The sender and the recipient both contribute inputs. CIOH is deliberately violated to poison the heuristic.
- **Dual-funded Lightning channel opens** - Two parties contribute inputs to open a channel cooperatively.
- **Batched payments by exchanges** - Some exchanges batch many customer withdrawals into one transaction. The inputs come from exchange hot wallets, not individual users.

**Why it matters for privacy**

CIOH alone enables the majority of address clustering. A single multi-input transaction can link dozens of addresses to the same entity. Combined with a single KYC anchor point, an entire wallet's history can be deanonymized. Users who consolidate UTXOs are especially vulnerable - they are voluntarily linking all of their addresses in a single transaction.

**Scoring impact:** -3 to -45

- Single-input transaction: 0 (no CIOH exposure)
- 2-4 unique input addresses: -3 per address (up to -12)
- 5-9 unique input addresses: -15
- 10-19 unique input addresses: -25
- 20-49 unique input addresses: -35
- 50+ unique input addresses: -45
- Exception: CoinJoin pattern detected (H4): 0 (suppressed)

**References**
- Nakamoto, "Bitcoin: A Peer-to-Peer Electronic Cash System" (2008), Section 10 - "Some linking is still unavoidable with multi-input transactions, which necessarily reveal that their inputs were owned by the same owner."
- Meiklejohn et al., "A Fistful of Bitcoins: Characterizing Payments Among Men with No Names" (2013) - formalizes and applies CIOH at scale
- Ron and Shamir, "Quantitative Analysis of the Full Bitcoin Transaction Graph" (2013)

---

### H4: CoinJoin Detection

**Technical description**

CoinJoin is a collaborative transaction protocol where multiple users combine their inputs and outputs into a single transaction. When done correctly, an observer cannot determine which inputs funded which outputs. CoinJoin is the single most effective on-chain privacy technique available today.

We detect three major CoinJoin implementations:

**Whirlpool (Samourai / Sparrow)**

- Exactly 5 inputs and 5 outputs (Whirlpool uses fixed participant counts)
- All 5 outputs have equal value
- Standard pool denominations: 50,000 sats (0.0005 BTC), 100,000 sats (0.001 BTC), 1,000,000 sats (0.01 BTC), 5,000,000 sats (0.05 BTC), 50,000,000 sats (0.5 BTC)
- No toxic change in the CoinJoin transaction itself (change is handled in a separate TX0 premix transaction)

```
if len(tx.outputs) == 5:
  output_values = [o.value for o in tx.outputs]
  if len(set(output_values)) == 1:  // all equal
    if output_values[0] in WHIRLPOOL_DENOMINATIONS:
      flag as Whirlpool CoinJoin
```

**Wasabi Wallet (WabiSabi)**

- Large number of inputs (typically 50-150)
- Many equal-value outputs forming the anonymity set
- Additional outputs of varying values (change, coordinator fee)
- Post-2.0 Wasabi uses the WabiSabi protocol allowing variable denominations and multiple equal-output groups

```
if len(tx.inputs) >= 10 and len(tx.outputs) >= 10:
  value_counts = Counter(o.value for o in tx.outputs)
  most_common_value, count = value_counts.most_common(1)[0]
  if count >= 5 and count / len(tx.outputs) > 0.3:
    flag as probable Wasabi CoinJoin
```

**JoinMarket**

- Maker/taker model: one taker initiates the CoinJoin, multiple makers provide liquidity
- Unequal inputs (different makers have different UTXOs)
- Equal outputs for the CoinJoin amount, plus change outputs for makers
- Fewer participants than Wasabi, but higher flexibility in amounts
- Identifiable by the characteristic pattern of equal-value outputs mixed with varied change outputs

**Why it matters for privacy**

CoinJoins are the ONLY positive privacy signal in on-chain analysis. A well-executed CoinJoin breaks the transaction graph by creating ambiguity about which inputs funded which outputs. After a CoinJoin, an adversary tracking funds encounters an exponential increase in possible interpretations. This is why CoinJoin detection is the only heuristic that increases the privacy score.

CoinJoin is not a silver bullet. Post-mix behavior matters enormously. If a user performs a CoinJoin and then immediately consolidates the outputs, or sends them all to a single address, the privacy gains are destroyed. Toxic change from premix transactions can also link back to the user's pre-CoinJoin identity if handled carelessly.

**Scoring impact:** +15 to +30

- Whirlpool-pattern CoinJoin detected: +25 to +30
- Wasabi/WabiSabi-pattern CoinJoin detected: +20 to +25
- JoinMarket-pattern CoinJoin detected: +15 to +20
- Possible CoinJoin (ambiguous but suggestive pattern): +10 to +15

**References**
- Maxwell, "CoinJoin: Bitcoin privacy for the real world" (2013) - original proposal on bitcointalk
- Ficsor (nopara73), "ZeroLink: The Bitcoin Fungibility Framework" (2017) - Wasabi's protocol design
- Belcher, "Design for a CoinJoin Implementation with Fidelity Bonds" - JoinMarket design
- OXT Research, CoinJoin detection methodology

---

### H5: Boltzmann Entropy

**Technical description**

Transaction entropy measures the number of valid interpretations of a transaction - that is, how many different mappings of inputs to outputs are consistent with the transaction's structure. Higher entropy means more ambiguity for an adversary. Entropy E = log2(N), where N is the number of valid interpretations.

Full Boltzmann analysis, as defined by LaurentMT, counts all valid input-to-output partitions. For equal-value CoinJoin transactions, the interpretation count can be computed exactly using integer partitions of n.

We use a two-path approach:

**Path A - Equal-value outputs (Boltzmann partition formula):**

When all spendable outputs share the same value (common in Whirlpool, WabiSabi, and other CoinJoin protocols), the number of valid interpretations is computed using integer partitions:

```
N = sum over all integer partitions (s1, s2, ..., sk) of n:
    n!^2 / (prod(si!^2) * prod(mj!))
```

where:
- n = number of equal outputs (or number of inputs that can fund them, whichever is smaller)
- (s1, s2, ..., sk) is a partition of n (s1 + s2 + ... + sk = n, each si >= 1)
- mj = multiplicity of each distinct part size in the partition

**Reference values:**

| n (equal outputs) | Interpretations (N) | Entropy (bits) |
|---|---|---|
| 2 | 3 | 1.58 |
| 3 | 16 | 4.00 |
| 4 | 131 | 7.03 |
| 5 | 1,496 | 10.55 |
| 6 | 22,482 | 14.46 |
| 7 | 426,833 | 18.70 |
| 8 | 9,934,563 | 23.24 |
| 9 | ~277,006,192 | ~28.05 |

For n=5 (Whirlpool pool size), the partition formula gives 1,496 valid interpretations = 10.55 bits of entropy. This is the mathematically correct value per the Boltzmann model.

Note: The classic permutation model (n! = 120 for n=5) undercounts because it only considers one-to-one assignments. The partition model correctly accounts for the possibility that multiple outputs could be funded by the same input, yielding significantly more valid interpretations.

**Worked example (n=5 Whirlpool):**

The integer partitions of 5 are: [5], [4,1], [3,2], [3,1,1], [2,2,1], [2,1,1,1], [1,1,1,1,1].

For partition [1,1,1,1,1] (5 parts of size 1): N_term = 5!^2 / (1!^10 * 5!) = 14400/120 = 120
For partition [2,1,1,1] (one part of 2, three parts of 1): N_term = 5!^2 / (2!^2 * 1!^6 * 1! * 3!) = 14400/24 = 600
... and so on for all 7 partitions. The sum = 1,496.

**Path B - Mixed values (assignment-based enumeration):**

For transactions with mixed output values (<= 8x8), we enumerate which input funds which output. A mapping is valid if each input can cover the sum of outputs assigned to it. This is a lower bound of the true Boltzmann count but is reasonable for non-CoinJoin transactions.

For large mixed-value transactions (> 8x8), we use structural estimation based on the largest group of equal outputs, applying the Boltzmann partition formula to that group.

**Entropy interpretation:**
- 0 bits: Deterministic transaction. Only one valid interpretation exists.
- 1-3 bits: Low entropy. A few possible interpretations, limited ambiguity.
- 4-8 bits: Moderate entropy. Meaningful ambiguity exists.
- 9-15 bits: High entropy. Typical of Whirlpool 5x5 CoinJoins (8.97 bits).
- 15+ bits: Very high entropy. Larger CoinJoins (7x7+, WabiSabi).

**Why it matters for privacy**

Entropy is the most rigorous measure of transaction privacy. Unlike heuristics that flag specific patterns, entropy quantifies the actual ambiguity an adversary faces when analyzing a transaction. A transaction with high entropy is genuinely difficult to trace, regardless of other heuristic signals.

This is why OXT.me's Boltzmann tool was so valuable - and why its loss in April 2024 was so significant. It gave users a mathematically grounded privacy metric.

**Scoring impact:** -5 to +15

- 0 bits entropy (deterministic, no ambiguity): -5
- 1-3 bits (some ambiguity, but limited): 0
- 4-7 bits (moderate ambiguity): +5 to +10
- 8+ bits (high entropy, CoinJoin territory): +10 to +15

**References**
- LaurentMT, "Bitcoin Transactions & Privacy" (Parts 1-3) - foundational entropy framework, gist.github.com/LaurentMT
- LaurentMT, "Introducing Boltzmann" (Medium, 2017) - the original entropy analysis tool
- LaurentMT/boltzmann - reference implementation, github.com/Samourai-Wallet/boltzmann
- Shannon, "A Mathematical Theory of Communication" (1948) - foundational information theory
- OXT Research, "Understanding Bitcoin Privacy with OXT" (Parts 1-4, 2021)
- privacidadbitcoin.com - community entropy calculation reference

---

### H6: Fee Analysis

**Technical description**

Transaction fees and their associated metadata reveal information about the wallet software used and the user's behavior. We analyze several fee-related signals:

**Round fee rates**

If the fee rate is an exact integer multiple of 1 sat/vB (e.g., exactly 5.0 sat/vB rather than 5.3), this suggests the wallet uses simple fee estimation or offers only discrete fee tiers ("low / medium / high"). More sophisticated wallets use precise algorithmic fee estimation that results in non-round rates.

**RBF signaling**

Replace-By-Fee is signaled via the nSequence field of transaction inputs. If any input has nSequence < 0xfffffffe, the transaction signals RBF opt-in (BIP125). This reveals:
- The wallet supports RBF (narrows wallet identification)
- The user (or their wallet's default settings) chose to enable replaceability
- The transaction can be fee-bumped, which has implications for payment acceptance and zero-confirmation security

```
for input in tx.inputs:
  if input.sequence < 0xfffffffe:
    rbf_signaled = true
    break
```

**Fee rate relative to mempool conditions**

If the fee rate is significantly higher or lower than the prevailing mempool fee rate at the time of broadcast, it may indicate urgency, a lack of fee estimation sophistication, or specific wallet behavior. This signal is noisy but contributes to the overall wallet fingerprint (H11).

**Why it matters for privacy**

Fee analysis alone is a weak signal. But combined with other wallet fingerprinting data (H11), it narrows the set of possible wallet software significantly. Knowing the wallet software can reveal the user's technical sophistication, preferred privacy tools, and even geographic region (some wallets are popular in specific communities).

**Scoring impact:** -2

- Round fee rate detected (exact sat/vB integer): -2
- RBF signaling: 0 (informational only)

**References**
- BIP125 - Opt-in Full Replace-by-Fee Signaling
- 0xB10C, wallet fingerprinting research on fee patterns

---

### H7: OP_RETURN Detection

**Technical description**

OP_RETURN is a Bitcoin script opcode that marks an output as provably unspendable and allows up to 80 bytes of arbitrary data to be embedded in the transaction. This data is stored permanently in the blockchain and is visible to anyone, forever.

We check all transaction outputs for the OP_RETURN opcode and, when found, attempt to identify the protocol or purpose:

**Known protocol markers:**
- **Omni Layer** (formerly Mastercoin): hex prefix `6f6d6e69` ("omni") - indicates a token transfer, historically used by Tether (USDT) before migrating to other chains
- **OpenTimestamps**: prefix `4f54` - cryptographic timestamp proof anchored to the Bitcoin blockchain
- **Counterparty**: prefix `434e545250525459` ("CNTRPRTY") - XCP protocol messages
- **Veriblock**: proof-of-proof data for the VeriBlock sidechain
- **RUNES protocol**: Runes etching and minting data
- **Ordinals**: envelope data related to inscriptions

**Arbitrary messages:**

Some users embed ASCII text, URLs, hashes, or other data in OP_RETURN outputs. We attempt to decode the payload as UTF-8 and flag any human-readable content.

```
for output in tx.outputs:
  if output.scriptPubKey starts with OP_RETURN:
    data = output.scriptPubKey.data
    protocol = identify_protocol(data)
    if protocol:
      flag as "OP_RETURN: {protocol} data"
    elif is_printable_ascii(data):
      flag as "OP_RETURN: contains readable text"
    else:
      flag as "OP_RETURN: contains embedded binary data"
```

**Why it matters for privacy**

OP_RETURN data is a permanent, public annotation on a transaction. It may contain identifying information - a protocol marker that reveals the purpose of the transaction, a message, a hash that can be correlated with off-chain data, or metadata that narrows the universe of possible senders. Even when the data itself is not directly identifying, it reduces the anonymity set by distinguishing the transaction from ordinary payments.

**Scoring impact:** -5 to -8

- OP_RETURN with known protocol marker (Omni, OpenTimestamps, etc.): -8
- OP_RETURN with unknown data: -5

**References**
- Bitcoin Core documentation on OP_RETURN
- Bartoletti and Pompianu, "An Empirical Analysis of Smart Contracts: Platforms, Applications, and Design Patterns" (2017)

---

### H8: Address Reuse

**Technical description**

Address reuse occurs when a Bitcoin address receives funds in more than one transaction. This is the single biggest privacy failure a Bitcoin user can make.

When an address is used only once (as intended by the Bitcoin protocol's design), the transactions associated with it retain a degree of ambiguity - an observer cannot trivially determine which outputs in subsequent transactions belong to the same user without applying heuristics. But when an address is reused, every transaction involving that address is trivially linked. The address becomes a persistent identifier, functionally equivalent to a bank account number.

We detect address reuse by querying the transaction history:

```
address_txs = fetch_address_transactions(address)
receive_count = count_transactions_where_address_appears_in_outputs(address_txs)
if receive_count > 1:
  flag as address reuse
  severity scales with receive_count
```

**Why it matters for privacy**

Address reuse:
- Links all transactions to and from that address to the same entity, with certainty
- Reveals the total amount received and spent over time
- Allows temporal analysis of spending patterns
- Makes change detection trivial in subsequent transactions (the reused address is always the same entity)
- Exposes the public key on first spend for P2PKH, enabling potential future quantum-computing attacks
- Destroys any privacy gains from prior CoinJoin activity if a post-mix output is sent to a reused address
- Is not a probabilistic heuristic - it is a deterministic, irrefutable link

Many wallets handle this correctly by generating a new address for each receive using HD key derivation. But some users manually share the same address multiple times, and some poorly designed software defaults to showing a static receive address.

**Scoring impact:** -24 to -70

- Address used in 2 transactions (first reuse): -24
- 3-4 transactions: -32
- 5-9 transactions: -45
- 10-49 transactions: -50
- 50-99 transactions: -58
- 100-999 transactions: -65
- 1000+ transactions: -70

This is intentionally the harshest penalty in the scoring model. Address reuse is the most damaging privacy behavior, and it is entirely avoidable.

**References**
- Nakamoto, "Bitcoin: A Peer-to-Peer Electronic Cash System" (2008), Section 10 - recommends using a new key pair for each transaction
- Meiklejohn et al., "A Fistful of Bitcoins: Characterizing Payments Among Men with No Names" (2013) - demonstrates how address reuse enables large-scale clustering
- Bitcoin Wiki, "Address reuse"

---

### H9: UTXO Analysis

**Technical description**

A Bitcoin address's UTXO (Unspent Transaction Output) set represents the funds currently available to spend. The characteristics of this set reveal information about the user's behavior and potential vulnerabilities.

We analyze several properties:

**UTXO count**

A large number of UTXOs on a single address suggests either many small receives over time (which implies address reuse or predictable receive patterns) or that the address serves as a collection or donation endpoint. Either way, a large UTXO count increases exposure.

**Total value distribution**

The distribution of values across UTXOs reveals patterns. Many equal-value UTXOs suggest CoinJoin outputs. Highly varied values suggest organic transaction activity. A few large UTXOs suggest consolidation or large transfers.

**Dust detection (see also H12)**

UTXOs with very small values - under 1000 sats - may be "dusting attacks." In a dusting attack, an adversary sends tiny, unsolicited amounts to target addresses. When the victim later spends this dust alongside their other UTXOs, the Common Input Ownership Heuristic (H3) links the dusted address to all other inputs in the spending transaction. This is an active surveillance technique, not a passive observation.

```
for utxo in address.utxos:
  if utxo.value < 1000:
    flag as potential dust
  if utxo.value < 546:
    flag as non-standard dust (below Bitcoin Core's default dust limit)
```

**Consolidation risk**

If a user has many UTXOs and decides to consolidate them into one, the consolidation transaction will link all input addresses via CIOH (H3). We flag large UTXO counts as a future consolidation risk.

**Why it matters for privacy**

The UTXO set is a snapshot of the user's current on-chain state. Dust UTXOs represent active threats - landmines that will detonate when spent carelessly. A large UTXO count represents potential future privacy damage if consolidation is performed without coin control. Understanding the UTXO set helps users make informed decisions about coin selection and spending strategy.

**Scoring impact:** -8 to +2

- Clean UTXO set (no dust, reasonable count): +2
- Dust UTXOs detected (3+): -8; fewer: -5
- Large UTXO count (>50 on a single address): -3 (consolidation risk)
- Moderate UTXO count (>20): -2

**References**
- BitMEX Research, "Dust Attacks" analysis
- Bitcoin Wiki, "Privacy" - UTXO management section

---

### H10: Address Type Analysis

**Technical description**

Bitcoin supports several address types, each with different privacy properties. The address type determines the script used to lock and unlock funds, which in turn affects the information revealed on-chain when funds are spent.

**P2TR - Pay-to-Taproot (bc1p...)**

Taproot addresses (BIP341/342) provide the best privacy among current address types. The key innovation is that all Taproot spends look identical on-chain, regardless of the underlying script complexity. A simple single-signature spend, a multisig spend, a timelock, and a complex smart contract all produce the same-looking output when using the key-path spend. This dramatically increases the anonymity set because an observer cannot distinguish between these use cases.

Taproot uses Schnorr signatures (BIP340), which enable signature aggregation. In a multisig setup, all participants can produce a single aggregate signature that is indistinguishable from a single-signer signature.

**P2WPKH - Pay-to-Witness-Public-Key-Hash (bc1q...)**

Native SegWit addresses are the current mainstream standard. They have a large anonymity set due to widespread adoption. On spend, they reveal the public key and signature in the witness data. Privacy is good but not as strong as Taproot because the script type is visible, distinguishing single-sig from multisig.

**P2SH - Pay-to-Script-Hash (3...)**

P2SH addresses can wrap various script types - most commonly SegWit (P2SH-P2WPKH) or multisig. The script is revealed on spend, which can disclose the spending conditions (e.g., 2-of-3 multisig). The address format is shared between many different use cases, providing some anonymity, but the revealed script on spending narrows identification.

**P2PKH - Pay-to-Public-Key-Hash (1...)**

The original Bitcoin address format. Has the largest historical anonymity set simply because it has been in use the longest. However, it reveals the public key on first spend, is the least efficient format, and is increasingly associated with older or less sophisticated software. As adoption of newer formats grows, P2PKH transactions become more distinguishable.

**Why it matters for privacy**

The address type determines the ceiling of on-chain privacy. A user on Taproot benefits from the largest possible anonymity set because their transactions are indistinguishable from all other Taproot transactions regardless of script complexity. A user on P2PKH leaks more information with every spend and is increasingly distinguishable as the ecosystem moves to newer formats.

Address type also contributes to change detection (H2). If a transaction spends from P2WPKH inputs and creates one P2WPKH output and one P2TR output, the P2WPKH output is likely change (returning to the sender's wallet) and the P2TR output is likely the payment (going to the recipient's newer wallet).

**Scoring impact:** -5 to +5

- P2TR (Taproot): +5
- P2WPKH (Native SegWit): +2
- P2SH (Wrapped SegWit or other): -2
- P2PKH (Legacy): -5
- Mixed types across inputs: additional -3 (cross-type spending is unusual and distinguishing)

**References**
- BIP341/342 - Taproot (Schnorr + MAST)
- BIP340 - Schnorr Signatures for secp256k1
- BIP141 - Segregated Witness
- Bitcoin Wiki, "Privacy" - address types section

---

### H11: Wallet Fingerprinting

**Technical description**

Different wallet software produces transactions with subtly different structural characteristics. By examining the raw transaction data, we can often identify the wallet that created it - or at least narrow the possibilities significantly. Research by 0xB10C and Chris Belcher has shown that approximately 45% of Bitcoin transactions are identifiable by wallet software based on transaction structure alone.

We analyze the following signals:

**nLockTime**

The nLockTime field specifies the earliest block height (or timestamp) at which a transaction can be mined. Different wallets set this differently:

- **Bitcoin Core**: Sets nLockTime to the current block height as an anti-fee-sniping measure. This is a strong fingerprint.
- **Electrum**: Also sets nLockTime to the current block height (since version 3.x).
- **Most mobile wallets**: Set nLockTime to 0.
- **Wasabi Wallet**: Sets nLockTime to the current block height with occasional random offset.
- **Hardware wallets**: Varies by firmware and companion software.

```
if tx.locktime == 0:
  possible_wallets = ["mobile wallets", "older software", "some hardware wallets"]
elif tx.locktime is close to block height at confirmation time:
  possible_wallets = ["Bitcoin Core", "Electrum", "Wasabi"]
```

**nVersion**

- Version 1: Legacy default. Increasingly rare in modern transactions.
- Version 2: Required for BIP68 relative timelocks. Used by wallets that enable RBF by default.

A version 1 transaction in 2025 or later is itself a mild fingerprint, indicating older or deliberately conservative software.

**nSequence values**

The sequence number on each input encodes RBF and timelock information:

- `0xffffffff`: Final. No RBF, no relative timelock. Common in legacy wallets.
- `0xfffffffe`: No RBF, no relative timelock, but transaction is not final (allows nLockTime). Used by wallets that set nLockTime for anti-fee-sniping but disable RBF.
- `0xfffffffd`: RBF opt-in (BIP125), no relative timelock. Bitcoin Core default since version 0.25.

Different wallets set different default nSequence values. Some always signal RBF, some never do, some let the user choose. This is a distinguishing signal.

**BIP69 lexicographic ordering**

BIP69 specifies a deterministic ordering of inputs and outputs based on lexicographic sorting. Electrum and some other wallets implement this. If inputs are sorted by txid (then by vout index) and outputs are sorted by value (then by scriptPubKey), the transaction follows BIP69 ordering.

```
inputs_sorted = all(inputs[i] <= inputs[i+1] for i in range(len(inputs)-1))
  // comparison by txid, then by vout
outputs_sorted = all(outputs[i] <= outputs[i+1] for i in range(len(outputs)-1))
  // comparison by value, then by scriptPubKey
bip69_compliant = inputs_sorted and outputs_sorted
```

BIP69 was intended to improve privacy by standardizing ordering, but because adoption is not universal, it ironically became a fingerprint for the wallets that implement it.

**Low-R signatures**

Bitcoin Core since version 0.17 grinds the ECDSA nonce to produce signatures where the R value is in the lower half of the curve order. This produces 71-byte signatures instead of 72-byte, saving 1 byte per input. This is a distinctive fingerprint - most other wallets do not implement low-R grinding.

```
for input in tx.inputs:
  sig = extract_signature(input.witness or input.scriptSig)
  r_value = parse_der_signature(sig).r
  if r_value < secp256k1_order / 2:
    low_r_count += 1
if low_r_count == len(tx.inputs):
  flag as probable Bitcoin Core (>= 0.17)
```

**Why it matters for privacy**

Wallet fingerprinting reduces the anonymity set. If an adversary can determine that a transaction was created by Bitcoin Core, they have eliminated all Electrum, Wasabi, mobile wallet, and hardware wallet users from consideration. Combined with other metadata (geographic IP data, timing patterns, transaction amounts), wallet identification significantly aids deanonymization.

Research shows approximately 45% of transactions carry enough structural signals to be attributed to specific wallet software with reasonable confidence. For privacy-conscious users, this is a reminder that the choice of wallet software has privacy implications beyond its feature set.

**Scoring impact:** -2 to -6

- Wallet software confidently identified (3+ signals agree): -6
- Wallet software narrowed to 2-3 candidates (2 signals): -4
- Single fingerprinting signal only: -3
- Weak or contradictory signals: -2

**References**
- 0xB10C, "Wallet Fingerprinting" research - empirical analysis of transaction structure patterns
- Belcher, Chris, "Wallet Fingerprinting" analysis
- BIP69 - Lexicographic Indexing of Transaction Inputs and Outputs
- Bitcoin Core source code - low-R signature grinding implementation (src/key.cpp)

---

### H12: Dust Detection

**Technical description**

While dust detection is part of H9 (UTXO Analysis), it is important enough to document as its own heuristic. Dust attacks are an active surveillance technique - not a passive analytical observation, but a deliberate attack against a target's privacy.

A dusting attack works as follows:

1. The attacker sends a tiny amount of bitcoin (typically 500-1000 sats, sometimes less) to a target address. This is the "dust."

2. The target sees the incoming UTXO in their wallet. If using automatic coin selection (as most wallets do by default), this dust UTXO may be included as an input the next time the target spends funds.

3. When the dust is spent alongside other UTXOs, the Common Input Ownership Heuristic (H3) links the dusted address to all other input addresses in the spending transaction.

4. If the attacker knows the identity behind the dusted address (e.g., from a forum post, a merchant payment, or a previous analysis), they now know the identity behind all the other input addresses as well.

**Detection criteria:**

```
for utxo in address.utxos:
  if utxo.value < 1000:
    // Check if the sending transaction suggests a dust attack
    sending_tx = fetch_transaction(utxo.txid)
    indicators = 0
    if utxo.value < 546:  // Below Bitcoin Core's default dust limit
      indicators += 2
    if sending_tx has many outputs to different addresses:
      indicators += 1  // Fan-out pattern typical of mass dusting campaigns
    if indicators >= 2:
      flag as "probable dusting attack"
    else:
      flag as "potential dust - exercise caution"
```

Any UTXO with a value below 1000 sats is flagged. UTXOs below 546 sats (the default dust limit in Bitcoin Core) are flagged with higher severity, as they are below the economic threshold for normal use and are more likely to be surveillance dust.

**Why it matters for privacy**

Dusting attacks are cheap to execute (a few hundred sats per target) and devastatingly effective against users who are unaware of the threat. A single dusting attack, combined with careless automatic coin selection, can link an entire wallet's address set through CIOH. This is an asymmetric attack - the cost to the attacker is negligible, but the privacy damage to the victim can be catastrophic.

The recommended response is to never spend dust UTXOs. Most privacy-aware wallets (Sparrow, Wasabi) support coin control - the ability to manually select which UTXOs to include in a transaction. Dust UTXOs should be frozen (excluded from automatic coin selection) or spent in isolation through a CoinJoin.

**Scoring impact:** -3 to -8

- No dust outputs: 0
- Surveillance dust pattern (single tiny output to unrelated address): -8
- Small outputs below 1000 sats (sub-546 extreme dust): -5
- Small outputs below 1000 sats: -3

**References**
- BitMEX Research, "Dusting Attacks" analysis
- Bitcoin Wiki, "Privacy" - dust attacks section

---

### H13: Anonymity Set Analysis

**Technical description**

Calculates the anonymity set for each output value - the number of outputs sharing the same value, making them indistinguishable from each other. An anonymity set of 1 means the output is unique and trivially traceable. Higher anonymity sets (like in CoinJoin) mean more possible interpretations of the transaction graph.

This is complementary to H4 CoinJoin detection. While H4 determines whether a transaction is a CoinJoin, the anonymity set analysis provides granular per-output ambiguity measurement that applies to any transaction.

**Detection criteria:**

```
value_counts = count occurrences of each output value
max_set = largest group of equal-value outputs

if max_set >= 5:
  "Strong anonymity set" (+5, good)
elif max_set >= 2:
  "Moderate anonymity set" (+1, low)
else:
  "No anonymity set - all outputs unique" (-1, low)
```

**Scoring impact:** -1 to +5

---

### H15: Script Type Mix Analysis

**Technical description**

Analyzes the mix of script types (P2PKH, P2SH, P2WPKH, P2WSH, P2TR) across inputs and outputs. When a transaction mixes different script types (e.g., P2WPKH inputs with a P2TR change output), the change output is easily identifiable because it often matches the input type.

Also detects bare multisig (P2MS) outputs, which expose all participant public keys directly on the blockchain.

**Detection criteria:**

```
input_types = set of input script types
output_types = set of output script types (excluding OP_RETURN)
all_types = union of input_types and output_types

if bare multisig output detected:
  "Bare multisig - all public keys exposed" (-8, high)

if all_types has 1 element:
  "Uniform script types" (+2, good)
elif all_types has 3+ elements:
  "Mixed script types" (-3, medium)
else:
  "Mixed script types" (-1, low)
```

This heuristic is suppressed (impact set to 0) for CoinJoin transactions, where mixed script types are expected since participants use different wallet software.

**Scoring impact:** -8 to +2

---

### H14: Timing Analysis

**Technical description**

Analyzes transaction timing patterns that may reveal information about the sender. Unconfirmed transactions are visible in the mempool, creating IP correlation risk. UNIX timestamp-based nLockTime values are rare and reveal the intended broadcast time. Stale locktime values (significantly before the confirmation block height) suggest the transaction was created well before broadcast.

**Detection criteria:**

```
if transaction is unconfirmed:
  "Mempool visible - IP correlation risk" (-2, low)

if nLockTime >= 500,000,000:
  "UNIX timestamp locktime - reveals creation time" (-3, medium)
elif confirmed and (block_height - nLockTime) > 100:
  "Stale locktime - delayed broadcast" (-1, low)
```

**Scoring impact:** -1 to -3

---

### H16: Spending Pattern Analysis (Address-level)

**Technical description**

Analyzes spending behavior of an address to assess exposure. High-volume addresses (100+ transactions) are more likely to be monitored by chain analysis firms. Addresses that have never spent ("cold storage") reveal no spending patterns. Addresses transacting with many counterparties create a wide exposure surface.

Counterparty counting excludes likely change outputs by comparing address types: in a 2-output send transaction, the output matching the sender's address type is excluded as probable change.

**Detection criteria:**

```
if tx_count >= 100:
  "High transaction volume" (-3, medium)

if spent_count == 0 and funded_count > 0:
  "Cold storage pattern" (+2, good)

if unique_counterparties >= 20:
  "Wide exposure surface" (-2, medium)
```

**Scoring impact:** -3 to +2

---

## Scoring Model

### Base Score

Every analysis begins with a base score of **70**. This represents a "typical" Bitcoin transaction or address with no obviously good or bad privacy characteristics. The base score is set above the midpoint (50) because most transactions do not have catastrophic privacy failures - they have the normal, baseline level of exposure inherent in using a transparent public blockchain.

### Score Calculation

```
final_score = base_score + sum(all heuristic impacts)
final_score = clamp(final_score, 0, 100)
```

All heuristic impacts are summed. Negative impacts indicate privacy weaknesses. Positive impacts indicate privacy-enhancing features. Currently, only CoinJoin detection (H4), Taproot usage (H10), and high entropy (H5) can produce positive impacts.

### Grade Thresholds

| Grade | Score Range | Interpretation |
|-------|-------------|----------------|
| A+ | >= 90 | Excellent. CoinJoin participant, Taproot, no address reuse, high entropy. You know what you are doing. |
| B | >= 75 | Good. Minor issues that could be improved, but no critical exposure. |
| C | >= 50 | Fair. Notable privacy concerns. An adversary with moderate resources could trace activity. |
| D | >= 25 | Poor. Significant exposure. Chain analysis firms can likely cluster and trace with confidence. |
| F | < 25 | Critical. Severe privacy failures. Address reuse, trivial clustering, deterministic transaction interpretation. |

### Heuristic Impact Summary

| ID | Heuristic | Level | Min Impact | Max Impact |
|----|-----------|-------|------------|------------|
| H1 | Round Amount Detection | TX | -5 | -15 |
| H2 | Change Detection | TX | -5 | -15 |
| H3 | Common Input Ownership (CIOH) | TX | -3 | -15 |
| H4 | CoinJoin Detection | TX | +15 | +30 |
| H5 | Simplified Entropy (Boltzmann) | TX | -5 | +15 |
| H6 | Fee Analysis | TX | -2 | -5 |
| H7 | OP_RETURN Detection | TX | -5 | -10 |
| H8 | Address Reuse | Addr | -20 | -70 |
| H9 | UTXO Analysis | Addr | -3 | -10 |
| H10 | Address Type Analysis | Addr | -5 | +5 |
| H11 | Wallet Fingerprinting | TX | -2 | -8 |
| H12 | Dust Detection (within H9) | Addr | -3 | -10 |
| - | Anonymity Set Analysis | TX | -1 | +5 |
| - | Script Type Mix Analysis | TX | -8 | +2 |
| - | Timing Analysis | TX | -3 | -1 |
| - | Spending Pattern Analysis | Addr | -3 | +2 |

### Score Design Properties

- A single critical failure (e.g., extensive address reuse at -35) can drop the grade from B to D by itself
- Multiple minor issues compound to produce meaningful score reductions
- CoinJoin participation provides a substantial boost but does not erase other issues
- The theoretical maximum (100) requires: CoinJoin participation, Taproot address, no address reuse, high entropy, no dust, no OP_RETURN, clean wallet fingerprint
- The theoretical minimum (0) requires: extensive address reuse, deterministic transaction, dust UTXOs, legacy address type, identifiable wallet, OP_RETURN metadata

---

## Operational Security Concerns

The privacy of your Bitcoin transactions is only one dimension of your overall privacy. How you use this tool - or any blockchain analysis tool - introduces its own set of risks.

### IP Address Disclosure

When you query the mempool.space API (or any blockchain explorer API), your request reveals:

- **Your IP address** - which can be geolocated to your city, linked to your ISP account, and correlated with other activity from the same IP
- **Which addresses and transactions you are querying** - this is the critical leak. If you are querying your own address, you have created a link between your IP and your Bitcoin address
- **Timestamps of queries** - when you made the request, which can be correlated with on-chain transaction timing

The mempool.space operators can see all of this. While mempool.space is operated by a privacy-respecting team, you are trusting their operational practices. Any compromise of their infrastructure would expose query logs.

**Mitigation:** Use Tor Browser or a trusted, no-log VPN. Route all API requests through Tor. Our tool auto-detects Tor and can use the mempool.space .onion endpoint when available.

### Timing Correlation

If you receive bitcoin and immediately query that address or transaction on am-i.exposed (or any blockchain explorer), the timing itself creates a correlation. An adversary monitoring both the Bitcoin network (for new transactions) and the explorer API (for queries) can correlate the two.

Example: A transaction confirms at block height N. Within 30 seconds, an IP address queries that transaction on mempool.space. The observer can reasonably infer that the IP address belongs to a party involved in that transaction.

**Mitigation:** Wait before querying. There is no precise safe interval, but querying hours or days after a transaction significantly reduces timing correlation risk.

### DNS Leakage

Even with a VPN, your DNS queries may leak to your ISP if DNS is not properly configured. When your browser resolves `mempool.space` or `am-i.exposed`, the DNS query reveals that you are using these services.

**Mitigation:** Use DNS-over-HTTPS (DoH) or DNS-over-TLS (DoT). Configure your VPN to handle all DNS resolution. Better yet, use Tor, which handles DNS resolution through the Tor network.

### Browser Fingerprinting

Standard web fingerprinting techniques - canvas rendering, WebGL renderer strings, installed fonts, screen resolution, timezone, language preferences, and dozens of other signals - can create a unique identifier for your browser. This fingerprint persists across sessions and can be used to track you even without cookies.

If mempool.space or any intermediary CDN employs browser fingerprinting (or is compromised to do so), your queries across different sessions could be linked together, allowing an observer to build a profile of all addresses and transactions you have ever queried.

**Mitigation:** Use Tor Browser, which standardizes the browser fingerprint across all users. If not using Tor, use a privacy-focused browser with fingerprinting resistance (Firefox with `privacy.resistFingerprinting` enabled, or Brave with aggressive fingerprinting protection).

### Our Mitigations

We take the following measures to minimize the privacy risks of using this tool:

- **All analysis runs client-side.** Your browser fetches raw data from the blockchain API and runs all heuristics locally. No server ever receives your query and your analysis results together. There is no am-i.exposed backend that processes or logs what you are analyzing.
- **Tor .onion endpoint auto-detection.** When the tool detects that it is running in Tor Browser, it automatically routes API requests to the mempool.space .onion address, keeping your queries within the Tor network.
- **Strict Referrer-Policy headers.** We set `Referrer-Policy: no-referrer` to prevent the browser from sending the page URL (which may contain your queried address in the hash) in the Referer header when making API requests.
- **Content Security Policy.** CSP headers restrict which domains the page can connect to, preventing exfiltration of data to unauthorized endpoints. Only explicitly listed API endpoints are allowed.
- **No analytics, no tracking, no cookies.** We do not use Google Analytics, Plausible, or any analytics platform. We do not set cookies. Recent scan history is stored in sessionStorage (cleared automatically when the browser tab closes). No addresses or transaction IDs persist between sessions.

---

## Competitor Analysis

### Blockchair Privacy-o-Meter

- Provides a "privacy score" for Bitcoin transactions
- **Black box scoring algorithm** - the methodology is not publicly documented, making it impossible to verify, audit, or understand the score
- **Server-side analysis** - Blockchair's servers see every query you make, creating a direct correlation between your IP and the addresses/transactions you are analyzing
- No Boltzmann entropy calculation
- No wallet fingerprinting detection
- No dust attack detection
- No address reuse analysis (transaction-level scoring only)

### OXT.me (OFFLINE since April 2024)

- Was the gold standard for Boltzmann entropy analysis of Bitcoin transactions
- Created by LaurentMT as part of the Samourai Wallet ecosystem and OXT Research
- Provided detailed transaction graphs, entropy scores, wallet cluster analysis, and advanced tools for privacy researchers
- The Boltzmann tool was open source and academically rigorous
- **Shut down following the arrest of Samourai Wallet developers in April 2024**
- The source code exists on GitHub but the hosted service is offline with no indication of return
- Our tool fills this gap with a simplified but functional entropy estimation, with plans for full Boltzmann in a future release

### KYCP.org (OFFLINE since April 2024)

- "Know Your Coin Privacy" - built by the Samourai Wallet team
- Focused on CoinJoin analysis, post-mix privacy assessment, and Whirlpool-specific metrics
- Entropy calculations for Whirlpool CoinJoin transactions
- Clean, accessible interface that made privacy analysis approachable for non-technical users
- **Also shut down after the Samourai arrests**
- No replacement exists in the public ecosystem
- Our tool incorporates KYCP-style CoinJoin detection and privacy assessment

### Sparrow Wallet

- Excellent privacy features at transaction construction time: coin control, PayJoin support, Whirlpool integration, UTXO management, address labeling
- **No post-hoc analysis** of existing transactions - it helps you build private transactions, not analyze arbitrary existing ones
- Desktop only (no web interface)
- Cannot analyze transactions or addresses that are not part of your own wallet
- Complementary to our tool rather than competitive - use Sparrow to construct transactions, use am-i.exposed to verify the result from the outside

---

## What Makes Us Different

1. **Open source, client-side analysis.** Every heuristic is documented in this file and implemented in publicly auditable TypeScript. No black boxes. No proprietary algorithms. Fork the code and verify the scoring yourself.

2. **No server ever sees your query and results together.** API calls go directly from your browser to the blockchain data source. Our static hosting infrastructure serves files and has no visibility into what you are analyzing. There is nothing to subpoena.

3. **Wallet fingerprinting detection.** No other consumer-facing privacy tool currently offers transaction-level wallet fingerprinting. This is a heuristic that chain surveillance firms use routinely, but that has never been exposed to end users in an accessible format until now.

4. **Dust attack detection.** We flag potential dusting attacks on addresses, alerting users to active surveillance threats before they accidentally compromise their privacy by spending dust UTXOs through careless automatic coin selection.

5. **Honest about operational security limitations.** We document the privacy risks of using our own tool. We tell you about IP disclosure, timing correlation, DNS leakage, and browser fingerprinting. We provide specific mitigations. Most tools pretend these risks do not exist.

6. **Fills the gap left by OXT.me and KYCP.org.** Since April 2024, there has been no publicly available tool combining entropy analysis, CoinJoin detection, wallet fingerprinting, and multi-heuristic privacy assessment. We are building what was lost.

---

## Additional Features

### Pre-Send Destination Check

**Status:** Implemented

**Technical description**

Before sending bitcoin to an address, a user pastes the destination address into am-i.exposed. The tool queries the address's full transaction history and reports:

1. **Reuse count** - How many times has this address received funds? If more than once, the recipient has poor privacy hygiene, and sending to them links your transaction to all of their other activity.
2. **Total received/spent** - Volume of activity on this address. High volume on a single address suggests an exchange deposit address, a merchant, or a careless user.
3. **Associated transaction count** - How many transactions involve this address.
4. **Known entity detection** - If the address appears in known databases (exchange hot wallets, mining pools, sanctioned addresses), flag it.
5. **First-degree cluster size** (see Cluster Analysis below) - How many other addresses are linked to this one through CIOH.

```
destination = user_input_address
history = fetch_address_transactions(destination)
receive_count = count_receives(history)
if receive_count > 1:
  warn("This address has been used {receive_count} times. The recipient is reusing addresses.")
if receive_count > 10:
  warn("This address has received {receive_count} deposits. Likely an exchange or service address.")

cluster = build_first_degree_cluster(history)
if len(cluster) > 1:
  warn("This address belongs to a cluster of {len(cluster)} addresses via common-input-ownership.")
```

**Why it matters for privacy**

Sending to a reused address is a privacy leak for BOTH parties. The sender's transaction becomes trivially linkable to all other transactions involving that address. If the destination is a known entity (exchange, merchant), the sender's identity may be inferred through the recipient's KYC records.

No wallet currently warns users about destination address privacy. Sparrow flags your own address reuse but not the recipient's. This is a gap - wallets could integrate this check, but until they do, am-i.exposed provides it as a standalone tool.

**Implementation:** New tab/mode on the main UI - "Check Address Before Sending." Same client-side architecture, same API calls. Minimal new code - reuses existing address analysis logic with a different presentation focused on send-time risk assessment.

**UX:** Paste address → instant report card:
- "This address has been used X times" (with severity color)
- "Cluster size: Y addresses" (if H14 is available)
- "Risk level: LOW/MEDIUM/HIGH/CRITICAL"
- Actionable advice: "Ask the recipient for a fresh address" / "This appears to be an exchange deposit address"

---

### First-Degree Cluster Analysis (CIOH Graph Walk)

**Status:** Implemented

**Technical description**

Given a Bitcoin address, build a cluster of all addresses linked through one hop of Common Input Ownership:

1. Fetch all transactions involving the target address
2. For each transaction where the target address appears as an input alongside other addresses, add all co-input addresses to the cluster (CIOH - H3)
3. For change outputs identified via H2, follow the change address and repeat step 2 for that address only (one additional hop via change)

This is a **one-hop** analysis. It does not recursively walk the entire graph (that would require a backend/indexer). But one hop is enough to reveal:

- How many addresses the target entity controls (minimum lower bound)
- The total balance across the cluster
- Whether the entity has used CoinJoin (cluster will be smaller/fragmented)
- Whether the entity consolidates UTXOs (cluster will be large)

```
function build_first_degree_cluster(target_address):
  cluster = {target_address}
  txs = fetch_address_transactions(target_address)

  for tx in txs:
    input_addresses = [inp.address for inp in tx.inputs]
    if target_address in input_addresses:
      // CIOH: all inputs in same tx are same entity
      cluster.update(input_addresses)

    // Optional: follow change output one hop
    change_output = detect_change(tx)  // uses H2 sub-heuristics
    if change_output and change_output.address not in cluster:
      change_txs = fetch_address_transactions(change_output.address)
      for ctx in change_txs:
        ctx_input_addresses = [inp.address for inp in ctx.inputs]
        if change_output.address in ctx_input_addresses:
          cluster.update(ctx_input_addresses)

  // Filter out CoinJoin transactions (H4) to avoid false clustering
  // CoinJoin inputs are NOT same entity despite being in same tx
  cluster = filter_coinjoin_false_positives(cluster, txs)

  return cluster
```

**Rate limiting considerations:**

Client-side cluster analysis requires multiple API calls. For a target address with N transactions, we need:
- 1 call to fetch address transactions
- Up to N calls to fetch full transaction details (if not already fetched)
- Up to M calls to follow change outputs (where M = number of change outputs identified)

For addresses with many transactions, this can hit mempool.space rate limits. Mitigations:
- Cap at 50 transactions analyzed (most recent)
- Batch requests where possible
- Show partial results with "analyzing..." progress
- Cache results in memory during the session

**Deep version (future - requires backend):**

The one-hop version reveals the minimum cluster size. A full graph walk - following every cluster member through all their transactions, recursively - would reveal the true cluster size. This is what Chainalysis does. It requires:
- An Electrum/Fulcrum server or direct node access
- A graph database (Neo4j or similar) or in-memory graph
- Significant compute time for large clusters (exchanges can have millions of addresses)

This is Phase 3+ territory. For now, one-hop gives users more information than any free tool currently provides.

**Why it matters for privacy**

Cluster analysis is THE core technique of chain surveillance. Showing users their cluster size - even a lower-bound estimate - makes the abstract threat concrete. "Your address belongs to a cluster of 47 addresses" is far more impactful than "you used multiple inputs once."

Combined with the Pre-Send Destination Check, users can see not just their own exposure but the exposure of addresses they're about to send to. "The address you're sending to belongs to a cluster of 200+ addresses - this is likely an exchange or service."

**Scoring impact:** Informational in Phase 2 (displayed but not scored). In future phases, cluster size could modify the privacy score:
- Cluster size 1 (no CIOH exposure): +0
- Cluster size 2-5: -5
- Cluster size 6-20: -10
- Cluster size 21-50: -15
- Cluster size 50+: -20

**References**
- Meiklejohn et al., "A Fistful of Bitcoins" (2013) - foundational clustering methodology
- Ron and Shamir, "Quantitative Analysis of the Full Bitcoin Transaction Graph" (2013)
- Harrigan and Fretter, "The Unreasonable Effectiveness of Address Clustering" (2016)

---

## Non-Heuristics

Some privacy techniques are deliberately excluded from our analysis engine. This section explains why.

### PayJoin (BIP78 / P2EP)

**Why PayJoin is not a heuristic**

PayJoin (Pay-to-EndPoint, BIP78) is a protocol where the recipient contributes one or more inputs to the payment transaction. The result is a transaction that looks indistinguishable from a normal payment - two or more inputs, two outputs, nothing unusual.

That indistinguishability is the entire point. PayJoin's security model is that it poisons the Common Input Ownership Heuristic (H3) silently. If all inputs in a multi-input transaction are assumed to belong to the same entity, and in fact one input belongs to the recipient, then every clustering algorithm that relies on CIOH produces a false positive. The sender's addresses get incorrectly clustered with the recipient's addresses. Chain surveillance firms cannot tell this has happened.

**If you can detect it, it is not a PayJoin.** A properly constructed PayJoin transaction has no on-chain signature that distinguishes it from an ordinary payment. There are no extra outputs, no unusual value patterns, no script type anomalies, no identifiable metadata. Any "PayJoin detector" that fires on a transaction is either wrong (false positive on a normal transaction) or the PayJoin implementation is broken (leaking information it should not).

Previous versions of this tool included a PayJoin detection heuristic. It was removed because the premise is contradictory - claiming to detect something that is designed to be undetectable either discredits the tool or discredits PayJoin, and PayJoin works as designed. The heuristic matched a narrow pattern (exactly 2 inputs, 2 outputs, with an output address matching an input address) that is far more likely to be a self-spend or consolidation than an actual PayJoin.

**PayJoin remains one of the best privacy techniques available.** We recommend it in our remediation guidance. Use BTCPay Server, Sparrow Wallet, or any BIP78-compatible wallet to construct PayJoin transactions. The fact that we cannot detect them is exactly why they work.

**References**
- BIP78 - Pay-to-EndPoint (PayJoin)
- Belcher, C. "PayJoin" - design rationale and protocol specification
- Bitcoin Wiki, "PayJoin" - protocol overview

---

## Known Gaps / Future Work

### Stonewall (Samourai Wallet)

Stonewall is a simulated 2-party CoinJoin constructed by a single wallet. Structure: 2+ inputs, 4 outputs (2 equal-value + 2 change). The equal outputs create ambiguity about which input funded which equal output, increasing entropy without requiring a second participant.

**STONEWALLx2** is the collaborative version where inputs actually come from two different wallets, providing real (not simulated) CoinJoin privacy.

Detection pattern: exactly 4 outputs, 2 equal-value pairs, 2-3 inputs. Not yet implemented; partially covered by existing entropy (H5) and CoinJoin detection (H4) heuristics. The equal outputs will be counted by the anonymity set heuristic and contribute to entropy.

Future implementation would specifically identify Stonewall patterns and adjust scoring to reflect the simulated vs. real privacy distinction.

---

## References

### Foundational Research
- LaurentMT. "Bitcoin Transactions & Privacy" (Parts 1-3, ~2015) - Defined transaction entropy E = log2(N), link probability matrices, and the Boltzmann framework. gist.github.com/LaurentMT
- LaurentMT. "Introducing Boltzmann" (Medium, 2017) - First implementation of entropy analysis for Bitcoin transactions.
- LaurentMT/boltzmann - Reference implementation. github.com/Samourai-Wallet/boltzmann
- Maxwell, G. "CoinJoin: Bitcoin privacy for the real world." BitcoinTalk, 2013. bitcointalk.org/index.php?topic=279249.0
- Kristov Atlas. "CoinJoin Sudoku" - Deterministic link detection in CoinJoin transactions.

### Academic Papers
- Meiklejohn, S., et al. "A Fistful of Bitcoins: Characterizing Payments Among Men with No Names." IMC 2013.
- Ron, D. and Shamir, A. "Quantitative Analysis of the Full Bitcoin Transaction Graph." Financial Cryptography 2013.
- Reid, F. and Harriman, M. "An Analysis of Anonymity in the Bitcoin System." 2011.
- Moser, M. and Narayanan, A. "Resurrecting Address Clustering in Bitcoin."
- Kappos, G., et al. "How to Peel a Million: Validating and Expanding Bitcoin Clusters."
- Nick, J. "Data-Driven De-Anonymization in Bitcoin." Master's thesis, ETH Zurich, 2015.
- Erhardt, M. and Shigeya, S. "An Empirical Analysis of Privacy in the Lightning Network." 2020.
- Nakamoto, S. "Bitcoin: A Peer-to-Peer Electronic Cash System." 2008. Section 10: Privacy.
- Shannon, C. "A Mathematical Theory of Communication." 1948.

### Educational Series
- OXT Research / ErgoBTC. "Understanding Bitcoin Privacy with OXT" (Parts 1-4, 2021) - Comprehensive guide covering change detection, transaction graphs, wallet clustering, CIOH, and defensive measures.
  - Part 1: archive.ph/1xAw7
  - Part 2: archive.ph/TDvjy
  - Part 3: archive.ph/suxyq
  - Part 4: archive.ph/Aw6zC
- Spiral BTC. "The Scroll #3: A Brief History of Wallet Clustering" - Historical survey of chain analysis evolution from 2011-2024.
- privacidadbitcoin.com - Spanish-language Bitcoin privacy education, community entropy calculation reference.

### Wallet Fingerprinting
- Belcher, C. "Wallet Fingerprinting" research.
- 0xB10C. "Wallet Fingerprinting" - empirical analysis of transaction structure patterns.

### Protocol Specifications
- Ficsor, A. (nopara73). "ZeroLink: The Bitcoin Fungibility Framework." 2017.
- Belcher, C. "Design for a CoinJoin Implementation with Fidelity Bonds" - JoinMarket design.
- BIP69 - Lexicographic Indexing of Transaction Inputs and Outputs.
- BIP78 - Pay-to-EndPoint (PayJoin).
- BIP125 - Opt-in Full Replace-by-Fee Signaling.
- BIP141 - Segregated Witness (Consensus Layer).
- BIP340 - Schnorr Signatures for secp256k1.
- BIP341 - Taproot: SegWit version 1 spending rules.
- BIP342 - Validation of Taproot Scripts.

### Tools and Resources
- Bitcoin Wiki. "Privacy." en.bitcoin.it/wiki/Privacy

---

*This document is part of the am-i.exposed project. It is public documentation intended for privacy researchers, cypherpunks, and anyone who wants to understand how on-chain Bitcoin privacy works - and how it fails. If you find an error or want to contribute a heuristic, open an issue or PR.*
