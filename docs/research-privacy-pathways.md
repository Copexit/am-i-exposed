# Privacy-Enhancing Bitcoin Techniques Beyond CoinJoin

## Comprehensive Research for am-i.exposed Recommendations

---

## A. Wallet Hygiene (Normal Transaction Ninja Techniques)

### A1. Coin Control (UTXO Selection)

**What it is:** Coin control is the manual or deliberate selection of which UTXOs (unspent transaction outputs) to use as inputs when constructing a transaction. Instead of letting the wallet automatically pick inputs, the user chooses precisely which coins to spend.

**How it helps privacy:**
- Prevents merging UTXOs from different privacy contexts (e.g., KYC exchange withdrawals with non-KYC peer-to-peer purchases), which would link those identities via the Common Input Ownership Heuristic (CIOH)
- Avoids revealing total holdings by not spending from a single large UTXO when a smaller one suffices
- Prevents "toxic change" contamination where post-CoinJoin UTXOs get merged with doxxed coins, undoing the mix
- Reduces the on-chain footprint linking multiple addresses to one entity

**Current wallet support:**
- **Sparrow Wallet** (desktop) - Best-in-class coin control with visual UTXO diagrams, freezing, labeling, and privacy warnings during transaction construction
- **Wasabi Wallet** (desktop) - Full coin control with Tor routing and client-side block filtering
- **BitBox02** (hardware + app) - Coin control with best-practices guidance
- **BlueWallet** (mobile) - One of the few mobile wallets with coin control
- **Electrum** (desktop) - Full coin control via Coins tab
- **Bitcoin Core** (desktop) - Full coin control

**Limitations:**
- Requires user discipline and understanding; poor coin control is worse than automatic selection
- Mobile wallet support remains limited
- Careless post-CoinJoin spending can undo privacy gains

**Practical how-to:**
1. Segregate UTXOs by source (KYC vs. non-KYC, CoinJoin vs. raw)
2. Label every UTXO at receive time
3. When spending, manually select only UTXOs from the same privacy category
4. Freeze UTXOs you don't want accidentally spent
5. Avoid consolidating UTXOs from different sources in the same transaction

---

### A2. Address Labeling / Tagging

**What it is:** Attaching metadata (text labels) to addresses and UTXOs in your wallet to record their origin, purpose, and privacy level. Labels are stored locally in the wallet - they never appear on-chain.

**How it helps privacy:**
- Enables informed coin control decisions by showing which coins came from which source
- Prevents accidental cross-contamination (e.g., spending a KYC coin alongside an anonymous one)
- When you receive change, you can label it with context from the parent transaction so you don't lose track of its lineage

**Current wallet support:**
- **Sparrow Wallet** - Comprehensive labeling on addresses, UTXOs, and transactions with BIP329 label export/import
- **Wasabi Wallet** - Built-in labeling with privacy cluster tracking
- **BitBox02** - Labeling with best-practices guidance
- **Electrum** - Address and transaction labeling
- **Bitcoin Core** - Basic labeling via `setlabel`

**Limitations:**
- Labels are only as good as the user's discipline in maintaining them
- No standardized cross-wallet label format until BIP329 (now gaining adoption)
- Labels can be lost if wallet backups don't include label data

**Practical how-to:**
1. Label every incoming address with: source, date, counterparty alias
2. After spending, find the change UTXO and re-label it
3. Use categories like "KYC-exchange", "P2P-cash", "CoinJoin-mixed", "mining"
4. Export labels (BIP329) when migrating wallets

---

### A3. Change Address Management

**What it is:** When you spend a UTXO and the amount exceeds the payment (plus fees), the remainder is sent to a "change address" - a new address you control. Change management involves ensuring this change output doesn't reveal your identity or link transactions.

**How it helps privacy:**
- Defeats the change detection heuristic (which identifies the change output to determine the sender's remaining balance)
- A fresh change address for every transaction prevents address reuse on the change side
- Matching the change output's script type to the payment output prevents the "payment to different script type" heuristic from identifying which output is change

**Specific heuristics it breaks:**
- **Round number heuristic** - If you pay 0.1 BTC and change is 0.0374 BTC, the round amount is clearly the payment. Using exact amounts or splitting change defeats this.
- **Script type heuristic** - If inputs are P2WPKH but one output is P2TR, the mismatched output is likely the payment, making the other one change.
- **Largest output heuristic** - Observers assume the larger output is change.

**Current wallet support:**
- All modern HD wallets (Sparrow, Wasabi, Electrum, Bitcoin Core, BlueWallet) automatically generate fresh change addresses
- Sparrow and Bitcoin Core allow specifying change address type to match payment output type
- Some wallets support multiple change outputs for additional obfuscation

**Limitations:**
- Change avoidance (no change output at all) is strictly better but not always achievable
- Creating multiple change outputs uses more block space
- Without labeling, change outputs become "orphaned" metadata-wise

**Practical how-to:**
1. Use wallets that auto-generate fresh change addresses (all modern HD wallets do this)
2. When possible, match change output script type to payment script type
3. Prefer change avoidance (exact-amount transactions) when feasible
4. Label change outputs after each transaction
5. Consider creating multiple change outputs to break change detection heuristics

---

### A4. Branch and Bound (BnB) Coin Selection for Changeless Transactions

**What it is:** An algorithm (designed by Mark "Murch" Erhardt, merged into Bitcoin Core via PR #10637) that searches for a combination of UTXOs whose total value exactly matches the payment amount plus fees, eliminating the need for a change output entirely.

**How it helps privacy:**
- **No change output** means no change detection is possible - observers cannot determine which output belongs to the sender
- Reduces the transaction graph - no new UTXO is created linking back to the sender's wallet
- Has a consolidatory effect on the wallet's UTXO pool (reduces UTXO count over time)
- Eliminates the round-number heuristic, largest-output heuristic, and script-type heuristic simultaneously

**Current wallet support:**
- **Bitcoin Core** - Default coin selection algorithm; tries BnB first, falls back to random selection if no exact match
- **Wasabi Wallet** - Uses BnB-inspired selection
- **Sparrow Wallet** - Supports BnB via configurable coin selection strategies
- **bitcoinjs/coinselect** library - Community implementation available

**Limitations:**
- Does not always find a solution - exact matches depend on available UTXO denominations
- If a transaction is stuck, the sender cannot CPFP (Child Pays for Parent) because there is no change output to spend
- A "changeless solution" is defined as one exceeding the target but less than target + cost_of_change, meaning small overages are absorbed as miner fees
- Works best with a diverse UTXO pool (many different denominations)

**Practical how-to:**
1. Use Bitcoin Core or Sparrow with BnB enabled (it's default in Core)
2. Maintain a diverse UTXO pool with varied denominations
3. When constructing transactions manually, try to find UTXO combinations that exactly match the payment + fees
4. Accept that BnB won't always work - have a fallback strategy for change management

---

### A5. Matching Output Script Types to Input Script Types

**What it is:** Ensuring that the script type (P2PKH, P2SH-P2WPKH, P2WPKH, P2TR) of your change output matches the script type of the payment output - and ideally matches the input script types as well.

**How it helps privacy:**
- Defeats the "payment to different script type" heuristic. If all inputs are P2WPKH and one output is P2WPKH while the other is P2TR, observers can infer the P2TR output is the payment (to someone else's wallet) and the P2WPKH output is change
- Makes all outputs look interchangeable, increasing the transaction's entropy from an analyst's perspective
- Combined with equal-value outputs, can make a transaction look like a CoinJoin

**Current wallet support:**
- **Sparrow Wallet** - Explicitly supports matching script types for privacy. Its self-spend CoinJoin feature requires matching types between payment and wallet
- **Bitcoin Core** - Automatically generates change addresses of the same type as the wallet's primary script type
- **Wasabi Wallet** - Manages script types internally

**Limitations:**
- You cannot control the recipient's address type - if they give you a legacy P2PKH address and your wallet is P2WPKH, a mismatch is unavoidable
- Taproot adoption is still growing, so P2TR matching is not always possible
- The minority problem: if few wallets implement this, doing it becomes a fingerprint itself

**Practical how-to:**
1. Use a Taproot (P2TR) wallet when possible - it's the most future-proof and has the best privacy properties
2. When paying, prefer recipients who use the same address type as your wallet
3. Ensure your wallet generates change addresses of the same script type as your primary addresses

---

### A6. nVersion and nLockTime Best Practices

**What it is:** Two transaction-level fields that, if set inconsistently, can fingerprint which wallet software created the transaction.

- **nVersion**: Transaction version number. Only versions 1 and 2 are standard. Different wallets default to different versions.
- **nLockTime**: Originally for time-locked transactions, now also used for anti-fee-sniping (setting it to the current block height so miners can't re-mine old blocks to steal fees).

**How it helps privacy:**
- **Anti-fee-sniping** (setting nLockTime to current block height) makes your transactions blend in with Bitcoin Core's output, which has done this since v0.11.0
- **BIP 326** extends anti-fee-sniping to Taproot transactions using nSequence instead of nLockTime, further reducing fingerprints
- Randomizing nLockTime slightly (sometimes setting it a few blocks back) prevents timing correlation while maintaining the anti-sniping benefit
- Using nVersion 2 (the most common) avoids standing out

**Specific fingerprints it avoids:**
- Wallets not setting nLockTime stand out against the ~majority that do
- Using nVersion 1 when most wallets use nVersion 2 is a distinguishing mark
- Lexicographic ordering (BIP69) was designed for privacy but is now itself a fingerprint since only a minority of wallets implement it

**Current wallet support:**
- **Bitcoin Core** - Sets nLockTime to current block height with slight randomization; nVersion 2
- **Sparrow Wallet** - Anti-fee-sniping nLockTime; nVersion 2
- **Electrum** - Anti-fee-sniping nLockTime; nVersion 2
- **Wasabi Wallet** - Randomized nLockTime

**Limitations:**
- The paradox of privacy features: if only a small number of wallets adopt a particular anti-fingerprinting measure, that measure becomes a fingerprint
- nSequence-based anti-fee-sniping (BIP 326) is still not universally adopted
- Some hardware wallet signing flows may override these values

**Practical how-to:**
1. Use wallets that set nLockTime for anti-fee-sniping (Bitcoin Core, Sparrow, Electrum all do this by default)
2. Ensure nVersion is 2 (default in most modern wallets)
3. Don't use BIP69 lexicographic ordering unless the majority of transactions in your anonymity set also use it

---

### A7. Fresh Address for Every Receive (HD Wallet Derivation)

**What it is:** Using Hierarchical Deterministic (HD) wallets (BIP32/BIP44/BIP49/BIP84/BIP86) that derive a theoretically infinite number of addresses from a single seed, generating a new address for every incoming payment.

**How it helps privacy:**
- Prevents address reuse, which is one of the most damaging privacy practices
- Each payment goes to a fresh address, so a sender cannot see your other addresses or balance
- Observers cannot trivially link multiple payments to the same entity
- When combined with labeling, creates a clear audit trail without on-chain linking

**Current wallet support:**
- All modern wallets support HD derivation: Bitcoin Core, Sparrow, Electrum, BlueWallet, Wasabi, Trezor, Ledger, BitBox02, Coldcard, etc.
- **BIP44** (m/44'/0'/...) - Legacy P2PKH
- **BIP49** (m/49'/0'/...) - Nested SegWit P2SH-P2WPKH
- **BIP84** (m/84'/0'/...) - Native SegWit P2WPKH
- **BIP86** (m/86'/0'/...) - Taproot P2TR

**Limitations:**
- Users must actively use new addresses - some wallets display the same address until it's used
- Gap limit issues: if too many addresses are generated without being used, wallet recovery may not find all funds
- Does nothing to prevent linking via the CIOH when those addresses are spent together

**Practical how-to:**
1. Always click "Generate New Address" or "New Receive Address" before sharing an address
2. Never share the same address with two different senders
3. When sharing addresses publicly (donation pages), use Silent Payments (BIP352) or PayNyms instead

---

### A8. Avoiding Address Reuse

**What it is:** The strict practice of never receiving more than one payment to the same Bitcoin address. Address reuse is considered the most basic and damaging privacy mistake in Bitcoin.

**How it helps privacy:**
- Prevents observers from linking multiple payments as belonging to the same entity
- Protects both sender and receiver privacy - a sender paying a reused address reveals information about the receiver's entire transaction history at that address
- Reduces the effectiveness of cluster analysis tools like Chainalysis and OXT
- Each use of a private key in a signature theoretically weakens ECDSA security (though practically not a concern with current key sizes)

**Current wallet support:**
- All modern HD wallets avoid address reuse by default for receiving
- **Sparrow** and **Wasabi** display warnings when address reuse is detected
- **Bitcoin Core** generates fresh addresses automatically
- For static payment identifiers, use **Silent Payments (BIP352)** or **PayNyms (BIP47)**

**Limitations:**
- Users who share addresses publicly (on websites, social media) may inadvertently reuse them
- Some services (exchanges, merchants) may assign a fixed deposit address
- Once reuse has occurred, the damage is permanent on-chain

**Practical how-to:**
1. Never copy an address you've already used
2. For recurring payments from the same sender, generate a new address each time
3. For public donation contexts, use Silent Payments or PayNyms
4. Monitor your wallet for reuse warnings

---

## B. PayJoin / BIP77 (PayJoin v2)

### B1. How PayJoin v2 Works (Serverless, Async)

**What it is:** PayJoin (Pay-to-Endpoint / P2EP) is a protocol where both the sender and receiver contribute inputs to a transaction, making it look like a normal payment but breaking the Common Input Ownership Heuristic. BIP77 (PayJoin v2) is the async, serverless evolution of BIP78 (v1).

**Technical flow:**
1. Receiver generates a BIP21 URI containing a `pj=` parameter pointing to a Payjoin Directory (a blinded relay server)
2. Sender constructs and signs a regular transaction (the "Original PSBT") and sends it to the directory using OHTTP (Oblivious HTTP) for metadata privacy
3. Receiver polls the directory, retrieves the PSBT, adds their own input(s) and potentially substitutes the payment output
4. Receiver signs their inputs and sends the modified PSBT (the "Payjoin Proposal") back through the directory
5. Sender verifies the proposal (ensuring they're not being cheated), co-signs, and broadcasts

**How it helps privacy:**
- **Breaks CIOH fundamentally**: Since both sender and receiver contribute inputs, the assumption that all inputs belong to one entity is violated
- **No identifiable fingerprint**: Unlike CoinJoin (which has equal-value outputs), a PayJoin transaction looks exactly like a normal payment
- **Poisons chain analysis at scale**: Even a small percentage of PayJoin transactions forces analysts to weaken CIOH confidence for ALL transactions, benefiting the entire network
- **Hides payment amount**: The receiver's contributed input obscures the actual payment amount

**BIP77 vs BIP78 differences:**

| Feature | BIP78 (v1) | BIP77 (v2) |
|---------|-----------|-----------|
| Receiver requirement | Must host public HTTPS server | Only needs HTTP client |
| Communication | Synchronous (both online simultaneously) | Asynchronous via directory relay |
| Privacy layer | Direct HTTP connection | OHTTP (Oblivious HTTP) hides metadata |
| Adoption barrier | High (server hosting) | Low (mobile-friendly) |
| Backwards compatibility | N/A | Compatible with v1 wallets |

**Current wallet support (2025-2026):**
- **Bull Bitcoin Wallet** - First mobile wallet with full BIP77 send + receive. First exchange to support PayJoin.
- **Cake Wallet** - BIP77 send + receive support (added in v4.28)
- **BTCPay Server** - BIP78 (v1) support; BIP77 integration in progress
- **Sparrow Wallet** - BIP78 support; BIP77 planned
- **BlueWallet** - BIP78 compatibility

The PayJoin Foundation (501(c)(3), launched August 2025) led by Dan Gould is coordinating adoption. Funded by OpenSats, Cake Wallet, Spiral, Human Rights Foundation, Maelstrom, and Btrust. The Payjoin Dev Kit provides reference implementations for wallet developers.

**Limitations:**
- Requires both sender and receiver to use PayJoin-compatible wallets
- The Payjoin Directory is a relay point - while it uses OHTTP and end-to-end encryption, it's still a coordination dependency
- Adoption is still early; network effects matter (the more wallets support it, the more valuable it becomes)
- Receiver must have at least one UTXO to contribute as an input

**Practical how-to:**
1. Install Bull Bitcoin Wallet or Cake Wallet
2. To receive: generate a PayJoin-enabled payment request (BIP21 URI with `pj=` parameter)
3. To send: scan/paste a PayJoin-enabled invoice - the wallet handles the protocol automatically
4. The transaction broadcasts as a normal-looking payment

---

## C. Silent Payments (BIP352)

### How They Work Technically

**What it is:** Silent Payments (authored by Josibake and Ruben Somsen) allow a receiver to publish a single static payment address that senders can use to derive unique on-chain addresses for each payment - without any interaction or notification transaction.

**Technical mechanism:**
1. The receiver publishes a Silent Payment address containing two public keys: a **scan key** (B_scan) and a **spend key** (B_spend)
2. The sender, when constructing a transaction, takes the sum of their input public keys (A_sum), computes a shared secret via ECDH: `secret = a_sum * B_scan`
3. The sender derives a unique output key: `P = B_spend + hash(secret || k) * G` (where k is an output counter)
4. The on-chain output is a standard **Pay-to-Taproot (P2TR)** output - indistinguishable from any other Taproot payment
5. The receiver scans every transaction with at least one Taproot output, computing the ECDH with their scan private key to check for matches

**How it helps privacy:**
- **Eliminates address reuse for static identifiers**: Donation pages, social media bios, etc. can display one address that generates unique outputs
- **No on-chain notification**: Unlike BIP47 PayNyms, there's no notification transaction that links sender and receiver
- **Outputs blend into the Taproot anonymity set**: Since outputs are standard P2TR, they're indistinguishable from regular Taproot spends
- **Unlinkable payments**: Two payments to the same silent payment address produce completely different on-chain addresses

**Current wallet support (2025-2026):**
- **Bitcoin Core 28+** - Send and receive support merged
- **Cake Wallet** - Full send and receive on iOS and Android
- **Silentium** - Dedicated Silent Payments light wallet (experimental)
- **BlueWallet** - Send and receive support added
- **Nunchuk** - Silent payment support added in 2026
- **BitBox02** and **Wasabi Wallet** - Send-only support

**Requires Taproot:**
Yes - Silent Payment outputs are exclusively P2TR. This means:
- Sender's inputs must include at least one Taproot-capable input (for the public key needed in ECDH)
- The on-chain output is always Taproot
- This limits compatibility with legacy-only wallets

**Limitations:**
- **Scanning cost**: The receiver must scan every block's transactions to detect incoming payments - computationally expensive for light clients without server support
- **Sender requirements**: Sender must control their private keys (custodial wallets that don't expose keys can't compute the ECDH)
- **Taproot-only**: Both sender and receiver need Taproot support
- **Still relatively new**: Wallet support is growing but not yet ubiquitous
- **Light client challenges**: Full scanning requires processing all transactions, which is bandwidth and compute-intensive on mobile

**Practical how-to:**
1. Install Cake Wallet or set up Bitcoin Core 28+
2. Generate your Silent Payment address (starts with `sp1...`)
3. Share this single address publicly - on your website, social media, printed QR code
4. Each sender's payment will appear as a unique Taproot output in your wallet
5. No further interaction needed - the wallet handles scanning automatically

---

## D. Lightning Network

### D1. Channel Open/Close Privacy Implications

**What it is:** Opening a Lightning channel creates an on-chain funding transaction; closing creates a settlement transaction. The privacy implications depend on the transaction's on-chain fingerprint.

**Privacy analysis:**
- **Taproot channels (MuSig2)**: With MuSig2 signature aggregation, cooperative channel opens and closes produce a single Schnorr signature indistinguishable from a regular single-signer Taproot spend. This is a major privacy improvement - chain analysis cannot identify Lightning channel activity. LND has implemented this via simple taproot channels, saving ~33 vbytes per close.
- **Legacy channels**: Identifiable by their 2-of-2 P2WSH multisig pattern. Cooperative closes are recognizable. Force closes are even more identifiable due to timelocked outputs.
- **Splicing**: A newer feature allowing modification of channel capacity without closing. Splice transactions can incorporate CoinJoin-like mixing, as multiple peers can join a splice and register UTXOs to mix.

**How it helps privacy:**
- Payments within channels are completely off-chain and invisible to blockchain observers
- With Taproot channels, the on-chain footprint is minimized and indistinguishable from normal transactions
- Channel capacity and payment history are not revealed on-chain

### D2. Routing Privacy

**What it is:** Lightning uses onion routing (similar to Tor) for payment forwarding. Each routing node only knows the previous and next hop, not the full path.

**Privacy characteristics:**
- **Sender privacy**: The first routing node knows the sender, but subsequent nodes do not. If the sender connects through multiple hops, even the first routing node may not know the sender.
- **Receiver privacy**: The last routing node knows the receiver. Route blinding (bolt12) can hide the receiver's identity from the sender.
- **Limitations**: Path selection prioritizes short, cost-efficient, fast routes, resulting in small anonymity sets. Timing analysis and amount correlation can deanonymize payments. The low degree of randomness in path selection is a concern.

### D3. Private Channels vs Public Channels

**What it is:**
- **Public (announced) channels**: Broadcast a channel announcement, appear in the network graph, and can route payments for others
- **Private (unannounced) channels**: Not broadcast, not in the public graph, used only for direct transactions between the two channel partners

**Privacy benefits of private channels:**
- Transaction patterns remain confidential between participants
- Channel capacity and balance are not exposed to the public network
- Ideal for end-user wallets that only send/receive (not route)

**Limitations:**
- Not absolute privacy: invoices using unannounced channels include routing hints that expose channel details
- The receiver's public key is still in the invoice

### D4. Trampoline Routing

**What it is:** A routing delegation mechanism where lightweight wallets don't need the full network graph. Instead, they route to a known "trampoline node" which calculates the remaining path.

**Privacy implications:**
- With a single trampoline node (e.g., Phoenix using only ACINQ): the trampoline knows the recipient always; it may or may not know the payer depending on whether the payer connects directly
- With multiple trampoline nodes in the route: privacy improves significantly - no single trampoline node knows both sender and recipient
- The vision requires more independent trampoline nodes to emerge

### D5. Recommended Wallets

- **Phoenix** (ACINQ) - Self-custodial, runs a full LN node on mobile, uses trampoline routing. Single LSP dependency on ACINQ.
- **Breez** - Non-custodial, built-in LSP, designed for everyday payments
- **Zeus** - Connects to your own Lightning node, supports Tor, privacy mode to hide sending data. Maximum privacy if you run your own node.

### D6. LSP Privacy Considerations

**What it is:** Lightning Service Providers (LSPs) manage channel liquidity and routing for mobile wallets, but this creates a trust relationship.

**Privacy concerns:**
- The LSP can see payment amounts and timing for channels it opens with users
- If a user has only one channel (with the LSP), the LSP knows all payment destinations
- Phoenix users are all connected to ACINQ's node - ACINQ can observe payment patterns
- Breez integrates its own LSP with similar visibility
- **Mitigation**: Zeus connecting to your own node avoids LSP visibility entirely

---

## E. Monero Atomic Swaps

### E1. BTC -> XMR -> BTC Swap Flow

**What it is:** A complete chain break technique where Bitcoin is swapped trustlessly for Monero (which has built-in privacy via ring signatures, stealth addresses, and RingCT), held briefly or long-term, then swapped back to fresh Bitcoin with no on-chain link to the original coins.

**Technical flow:**
1. **BTC -> XMR**: User locks BTC in an HTLC or adaptor signature contract. Counterparty locks XMR. Atomic swap protocol ensures either both execute or neither does.
2. **Hold in Monero**: The Monero is fully private - ring signatures hide the sender, stealth addresses hide the receiver, RingCT hides the amount
3. **XMR -> BTC**: Swap back to Bitcoin via another atomic swap. The new BTC has zero on-chain connection to the original BTC.

**How it helps privacy:**
- **Complete chain break**: The Monero ledger is opaque - there is no way to trace funds through Monero's privacy layer
- **No KYC required**: Using decentralized swap platforms, no identity verification is needed
- **Trustless**: Atomic swaps use cryptographic guarantees, not custodial intermediaries

### E2. Current Implementations (2025-2026)

- **COMIT (xmr-btc-swap)**: Mature CLI tool for BTC-to-XMR atomic swaps. Limited to BTC->XMR direction only. Uses adaptor signatures. Open source.
- **BasicSwap DEX** (Particl): Fully decentralized exchange supporting BTC<->XMR swaps via both HTLC and adaptor signature (PTLC) protocols. No trading fees (only blockchain fees). Uses SMSG network for decentralized order book. Tor integration.
- **Haveno**: Decentralized P2P exchange built around Monero using multisig escrow (not pure atomic swaps). Supports XMR<->BTC, fiat, stablecoins. Tor by default.
- **Non-custodial aggregators**: Platforms like Changee, Flashift enabling no-KYC swaps, though these involve custodial risk during the swap window.

**Note:** 73 centralized exchanges delisted XMR in 2025 alone (including Binance, Coinbase, Kraken), making decentralized methods increasingly important.

### E3. Liquidity and Speed Limitations

- Cannot easily swap large amounts (>1 BTC) due to peer matching requirements
- Bitcoin block times limit swap speed: 30 minutes to several hours, especially during congestion
- Liquidity on decentralized platforms is significantly lower than centralized exchanges
- Requires technical comfort with CLI tools (COMIT) or running local software (BasicSwap)

### E4. Complete Chain Break

The Monero round-trip achieves the strongest possible chain break available in cryptocurrency. Unlike CoinJoin (which creates plausible deniability but maintains on-chain links) or Lightning (which has on-chain channel footprints), BTC->XMR->BTC completely severs any connection between input and output bitcoin. Volumes are up 180% year-over-year for BTC/XMR swaps.

---

## F. Liquid Network

### F1. Confidential Transactions (Amount Hiding)

**What it is:** Liquid uses Confidential Transactions (CT) by default, hiding both the asset type and amount of every transaction. Only the sender and receiver can see these values. Even the Liquid Federation functionaries cannot view transaction amounts.

**How it helps privacy:**
- **Amount hiding**: Observers can verify that no inflation occurred (inputs = outputs) without seeing actual values
- **Asset type hiding**: On Liquid, multiple asset types exist (L-BTC, USDT-Liquid, etc.) and CT hides which asset is being transacted
- **Eliminates amount-based heuristics**: Round-number analysis, change detection by value, and balance inference all become impossible

### F2. Liquid Peg-in/Peg-out Privacy

**Peg-in (BTC -> L-BTC):**
- Send BTC to a federation-generated address
- Requires 102 Bitcoin confirmations before L-BTC is claimable
- The peg-in transaction is visible on Bitcoin's chain, but subsequent Liquid transactions are confidential

**Peg-out (L-BTC -> BTC):**
- Processing time: 11-35 minutes depending on conditions
- The peg-out reveals the destination Bitcoin address

**Privacy note:** The peg-in and peg-out are the weak points - they're visible on Bitcoin's chain. The privacy benefit comes from what happens between peg-in and peg-out on Liquid, where amounts are hidden.

### F3. Federation Trust Model

**Current structure:**
- 15 functionaries, requiring 11-of-15 signatures per block
- DynaFed allows dynamic addition/removal of functionaries
- Functionary source code is open-source and auditable
- Functionaries cannot see Confidential Transaction amounts

**Trust considerations:**
- Federated consensus introduces centralization risk
- A compromised functionary could theoretically censor transactions
- Users must trust that 11-of-15 functionaries act honestly for peg-out
- This is fundamentally different from Bitcoin's trustless consensus

**2025-2026 activity:** Nearly 700,000 transactions in Q4 2025 (4x year-over-year growth). Planned 2026 protocol upgrades include multi-asset fee payments and 0-conf transactions.

### F4. Boltz Exchange for LN <-> Liquid Swaps

**What it is:** Boltz is a non-custodial bridge using submarine swaps (HTLCs) to enable trustless swaps between Bitcoin on-chain, Lightning, and Liquid.

**How it works:**
- Uses Hashed Time-Lock Contracts where both parties must reveal a preimage or the swap reverts
- Taproot swaps provide cooperative refunds, lower fees, and improved privacy
- No accounts, no KYC, no custody

**Fees:** LN->Liquid: 0.25%, LN->Bitcoin: 0.5%, Bitcoin/Liquid->LN: 0.1%

**Privacy benefit:** By swapping BTC -> LN -> Liquid via Boltz, users can move between layers without centralized intermediaries, leveraging each layer's privacy properties.

---

## G. Advanced Normal TX Techniques

### G1. Stonewall (Single-User Fake CoinJoin)

**What it is:** Originally a Samourai Wallet feature, Stonewall constructs a single-user transaction that mimics a two-person CoinJoin. The transaction uses multiple inputs from the same wallet and creates 4 outputs: the actual payment, a decoy of the same amount (back to the sender), and two change outputs.

**How it works technically:**
1. Wallet selects multiple UTXOs as inputs
2. Creates 4 outputs: payment amount to recipient, identical decoy amount to self, and two change outputs
3. The transaction structure looks like two people each contributed inputs and each received an output of the same denomination

**What heuristics it breaks:**
- **CIOH**: The transaction structure suggests multiple participants (even though there's only one)
- **Change detection**: With 4 outputs including a decoy matching the payment, it's ambiguous which is the real payment
- **Boltzmann entropy**: The number of possible input-to-output mappings increases, measured by the Boltzmann script

**Current status:**
- Samourai Wallet developers were prosecuted and pleaded guilty in late 2025 (Rodriguez: 5 years, Hill: 4 years)
- However, FinCEN reportedly told prosecutors that CoinJoin/non-custodial wallets do NOT constitute money transmission
- **Sparrow Wallet** implements a similar concept via its "Spending Privately" feature, which constructs transactions that look like 2-person CoinJoins using only the user's own UTXOs
- The concept (constructing fake CoinJoin-like transactions) is open and implementable by any wallet

**Limitations:**
- Requires the user to have multiple UTXOs of appropriate sizes
- Uses more block space than a regular transaction (4 outputs instead of 2)
- An analyst with enough context may still distinguish Stonewall from a real CoinJoin
- Legal uncertainty after the Samourai case (though the technique itself is just transaction construction)

**Practical how-to:**
1. Use Sparrow Wallet's "Spending Privately" feature
2. Ensure you have multiple UTXOs in your wallet (the wallet needs coins to construct the decoy structure)
3. When sending, select the privacy-enhanced option
4. The wallet handles the 4-output construction automatically

---

### G2. Spending Exact Amounts to Avoid Change

**What it is:** Constructing transactions where your input UTXOs exactly cover the payment amount plus fees, leaving no change output.

**How it helps privacy:**
- Eliminates change output entirely - no change detection heuristic can apply
- Reduces the transaction graph (no new UTXO linking back to sender)
- Makes the transaction look like a simple spend with no "leftover"

**Practical how-to:**
1. Use wallets with BnB coin selection (Bitcoin Core, Sparrow)
2. When manually selecting UTXOs, look for combinations that sum to payment + estimated fee
3. Consider slightly adjusting the fee to absorb small remainders
4. Maintain a diverse UTXO pool to increase chances of exact matches

---

### G3. UTXO Consolidation Timing

**What it is:** Strategically consolidating small UTXOs during low-fee periods to reduce future transaction costs and simplify UTXO management.

**Privacy trade-offs:**
- Consolidation merges UTXOs, triggering the CIOH and revealing common ownership
- **Best practice**: Only consolidate UTXOs that are already from the same privacy category
- Never consolidate KYC UTXOs with non-KYC UTXOs
- Never consolidate post-CoinJoin UTXOs with doxxed change

**Timing strategy:**
- Watch mempool fee estimates (mempool.space)
- Consolidate when fees drop below 5-10 sat/vB
- Ensure each resulting UTXO is at least 1,000,000 sats (0.01 BTC) to remain economically viable in high-fee environments
- Weekend nights (UTC) often have lower fees

---

### G4. Batch Spending for Privacy

**What it is:** Combining multiple payments into a single transaction with multiple outputs.

**How it helps privacy:**
- Multiple outputs make change detection harder (is the "change" one of the outputs, or are all outputs payments?)
- Reduces on-chain footprint (fewer total transactions)
- Observers cannot easily determine which outputs are payments vs. change when there are many outputs

**Limitations:**
- All recipients can see each other's output amounts (though not necessarily who they are)
- Primarily useful for services/merchants making multiple payments
- Individual users rarely have multiple simultaneous payments to batch

---

### G5. RBF Privacy Implications

**What it is:** Replace-By-Fee allows replacing an unconfirmed transaction with a higher-fee version.

**Privacy concerns:**
- RBF almost always increases the change output value's difference from the original, publicly marking which output is change
- The replacement transaction reveals that the sender is the one bumping the fee
- Multiple replacement versions in the mempool provide additional data points for analysis

**Privacy improvements:**
- Since Bitcoin Core 26.0+, full-RBF is the default, meaning ALL transactions are potentially replaceable - this actually improves privacy by making RBF universal rather than a distinguishing feature
- Bitcoin Core randomizes UTXO selection to sometimes produce change smaller than the payment, complicating analysis

**Best practices:**
- If privacy is critical, prefer CPFP over RBF for fee bumping (CPFP doesn't modify the original transaction)
- When using RBF, be aware that the change output becomes identifiable
- Full-RBF being default is a net privacy improvement since opt-in RBF was a fingerprint

### G6. CPFP vs RBF for Fee Bumping Privacy

**Key distinction:**
- **RBF**: Replaces the original transaction, modifying output values (reducing change). This reveals which output is change. More block-space efficient (~30-90% savings).
- **CPFP**: Creates a new child transaction spending the change output, paying a high fee. The original transaction is untouched. Less efficient (uses extra block space) but preserves the original transaction's privacy properties.

**Recommendation:** When privacy matters more than efficiency, prefer CPFP. When the change output is already identifiable (or privacy is less critical), RBF is more economical.

---

## H. Combined Pathways

### H1. CoinJoin -> Lightning (Mixed UTXOs Open Channels)

**What it is:** Using CoinJoin outputs to open Lightning channels, effectively moving mixed coins off-chain.

**How it works:**
1. Perform a CoinJoin (Wasabi, JoinMarket, etc.)
2. Use the mixed output to open a Lightning channel
3. With Taproot channels (MuSig2), the channel open is indistinguishable from a regular Taproot spend
4. Payments within the channel are fully off-chain

**Privacy benefits:**
- The CoinJoin breaks the chain history
- The Lightning channel hides all subsequent spending activity
- With Taproot, the channel open doesn't reveal it's a Lightning channel
- Splicing allows adding/removing funds without closing, and splice transactions can themselves be CoinJoin-like

**Challenges:**
- Timing between CoinJoin completion and channel opening can be a correlation point
- Channel-opening CoinJoins (where the CoinJoin outputs directly become channel funding) are still experimental
- Software compatibility between CoinJoin coordinators and Lightning implementations needs improvement

---

### H2. Exchange -> CoinJoin -> LN/Liquid Pipeline

**What it is:** A multi-step privacy pipeline for coins acquired from KYC exchanges.

**Flow:**
1. Withdraw from exchange to your own wallet (KYC-tagged UTXO)
2. CoinJoin the withdrawal to break the link (Wasabi, JoinMarket)
3. Open a Lightning channel with the mixed output, OR peg into Liquid
4. Use Lightning/Liquid for spending

**Privacy benefits:**
- Each step adds a layer of plausible deniability
- The exchange knows you withdrew, but the CoinJoin breaks the trail
- Lightning/Liquid activity is invisible to the exchange and on-chain observers

**Caveats:**
- The exchange has your identity and withdrawal address - this is a permanent record
- CoinJoin quality matters (anonymity set size, number of rounds)
- Don't consolidate mixed UTXOs with unmixed ones

---

### H3. BTC -> Monero -> BTC Round-Trip

**What it is:** The strongest available chain break, routing Bitcoin through Monero's opaque ledger.

**Flow:**
1. Swap BTC to XMR via atomic swap (COMIT, BasicSwap) or non-custodial exchange
2. Wait in Monero (Monero's ring signatures, stealth addresses, RingCT provide full privacy)
3. Swap XMR back to BTC via another atomic swap
4. The resulting BTC has zero on-chain link to the original

**Privacy benefits:**
- Complete chain break - no amount analysis, timing analysis, or graph analysis can trace through Monero
- No KYC required when using atomic swaps
- The Monero hold period adds temporal obfuscation

**Caveats:**
- Liquidity constraints limit swap sizes (typically <1 BTC per swap)
- Speed: 30 minutes to several hours per swap direction
- Monero price volatility during the hold period
- Requires technical comfort with CLI tools
- 73 centralized exchanges delisted XMR in 2025 - decentralized methods are increasingly important

---

### H4. LN -> Liquid via Boltz, then Liquid -> BTC

**What it is:** Using Boltz submarine swaps to move funds between Lightning and Liquid, leveraging Liquid's Confidential Transactions before settling back to Bitcoin.

**Flow:**
1. Send a Lightning payment to Boltz
2. Receive L-BTC on Liquid (amounts hidden by CT)
3. Perform any number of confidential Liquid transactions
4. Peg out from Liquid to Bitcoin, or swap back via Boltz

**Privacy benefits:**
- Lightning hop hides the on-chain origin
- Liquid's CT hides amounts during the Liquid phase
- The final peg-out to Bitcoin is disconnected from the original Lightning payment
- No KYC required (Boltz has no accounts)

**Fees:** ~0.25-0.5% per swap direction via Boltz

---

### H5. Multi-Hop for ATM/P2P Purchases

**What it is:** Combining multiple privacy techniques when acquiring Bitcoin through ATMs or P2P trades.

**Flow options:**
1. **ATM -> CoinJoin -> Lightning**: Buy BTC at a no-KYC ATM (sub-$1000 in many jurisdictions), CoinJoin the output, open a Lightning channel
2. **P2P -> Monero -> BTC**: Buy XMR via P2P (Haveno, cash), swap to BTC via atomic swap
3. **P2P BTC -> Liquid**: Buy BTC peer-to-peer (Bisq, Peach Bitcoin, Hodl Hodl), peg into Liquid for confidential transactions

**Key P2P platforms (no KYC):**
- **Bisq**: Decentralized, escrow via smart contracts, no registration
- **Peach Bitcoin**: Mobile-first, 2-of-2 multisig escrow, no registration
- **Hodl Hodl**: P2P lending and trading, multisig escrow on Bitcoin blockchain
- **Robosats**: Lightning-native P2P exchange

**Caveats:**
- ATMs increasingly require KYC for larger amounts (phone number, ID, facial recognition)
- P2P trades involve counterparty risk
- Each hop adds friction, fees, and time
- Operational security (IP address, phone, physical location) matters as much as on-chain privacy

---

## Summary: Technique Comparison Matrix

| Technique | Heuristic(s) Broken | Difficulty | Privacy Strength | Wallet Support |
|-----------|---------------------|------------|-----------------|----------------|
| Coin Control | CIOH | Medium | Medium | Good |
| Address Labeling | (Enables other techniques) | Easy | Low (indirect) | Good |
| Change Management | Change detection | Medium | Medium | Good |
| BnB Changeless TX | All change heuristics | Easy (auto) | High | Good |
| Script Type Matching | Script type heuristic | Easy | Medium | Good |
| nVersion/nLockTime | Wallet fingerprinting | Easy (auto) | Low-Medium | Good |
| Fresh Addresses | Address reuse linking | Easy (auto) | Medium | Excellent |
| PayJoin (BIP77) | CIOH (fundamentally) | Easy | Very High | Growing |
| Silent Payments | Address reuse, linking | Easy | High | Growing |
| Lightning Network | All on-chain heuristics | Medium | High | Excellent |
| Monero Round-Trip | Complete chain break | Hard | Maximum | Limited |
| Liquid CT | Amount heuristics | Medium | High | Moderate |
| Stonewall | CIOH, change detection | Easy | Medium-High | Limited |
| Exact Amount Spend | All change heuristics | Medium | High | Good |

---

Sources:
- [Coin selection - Bitcoin Design](https://bitcoin.design/guide/how-it-works/coin-selection/)
- [BitBox Support Hub - Coin Control Best Practices](https://support.bitbox.swiss/coin-control-best-practices)
- [Sparrow Wallet Review 2026](https://cryptoadventure.com/sparrow-wallet-review-2026-the-power-user-bitcoin-wallet-that-rewards-good-privacy-habits/)
- [Wasabi Wallet Review 2026](https://cryptoadventure.com/wasabi-wallet-review-2026-privacy-focused-bitcoin-desktop-wallet-with-coin-control/)
- [Bitcoin Privacy and UTXO Management - Knowing Bitcoin](https://knowingbitcoin.com/bitcoin-privacy-security/bitcoin-privacy-and-utxo-management-a-comprehensive-analysis/)
- [Managing UTXOs and addresses - Unchained](https://www.unchained.com/blog/bitcoin-utxo-privacy)
- [Bull Bitcoin PayJoin v2 Announcement](https://www.bullbitcoin.com/blog/bull-bitcoin-wallet-payjoin)
- [Payjoin - Bitcoin Optech](https://bitcoinops.org/en/topics/payjoin/)
- [BIP 77: Async Payjoin - GitHub](https://github.com/bitcoin/bips/blob/master/bip-0077.md)
- [Cake Wallet v4.28 PayJoin v2 Support](https://www.nobsbitcoin.com/cake-wallet-v4-28/)
- [Dan Gould Interview - Atlas21](https://atlas21.com/dan-gould-payjoin-dev-kit-we-aim-to-accelerate-payjoin-adoption-in-2026/)
- [PayJoin Foundation 501(c)(3) Status](https://bitcoinmagazine.com/business/payjoin-foundation-gains-501c3-status-enabling-tax-deductible-donations-for-bitcoin-privacy-development)
- [Async Payjoin - Bitcoin Magazine](https://bitcoinmagazine.com/business/async-payjoin-the-https-of-bitcoin-privacy)
- [Payjoin V1 BIP 78 - How It Works](https://payjoin.org/docs/how-it-works/payjoin-v1-bip-78/)
- [BIP 352: Silent Payments](https://bips.dev/352/)
- [Silent Payments - Bitcoin Optech](https://bitcoinops.org/en/topics/silent-payments/)
- [Silent Payments Complete Guide - Knowing Bitcoin](https://knowingbitcoin.com/silent-payments-bitcoin-complete-guide/)
- [How Silent Payments Work - Medium](https://medium.com/@ottosch/how-silent-payments-work-41bea907d6b0)
- [Silent Payments Wallet Support](https://silentpayments.xyz/docs/wallets/)
- [Lightning Network Privacy - MassMux](https://massmux.org/p/lightning-network-privacy-pros-and)
- [Lightning Network Privacy Explainer - Voltage](https://www.voltage.cloud/blog/lightning-network-privacy-explainer)
- [Public vs Private Channels - Voltage](https://www.voltage.cloud/blog/what-are-the-differences-between-public-and-private-channels)
- [Lightning Network Privacy - A Byte's Journey](https://abytesjourney.com/lightning-privacy/)
- [Bitcoin Lightning Network Not Private Yet - Bitcoin Magazine](https://bitcoinmagazine.com/technical/state-of-bitcoin-lightning-network-privacy)
- [Phoenix Wallet Trampoline Payments - ACINQ](https://medium.com/@ACINQ/phoenix-wallet-part-4-trampoline-payments-fb1befd027c8)
- [Best Lightning Wallets 2026 - Coin Bureau](https://coinbureau.com/analysis/best-bitcoin-lightning-wallets)
- [COMIT xmr-btc-swap - GitHub](https://github.com/comit-network/xmr-btc-swap)
- [Best XMR Atomic Swaps 2026 - Xgram](https://xgram.io/blog/best-xmr-atomic-swaps-and-community-services-2026)
- [Monero P2P Exchanges - arXiv](https://arxiv.org/html/2505.02392v2)
- [BasicSwap DEX - Particl Academy](https://academy.particl.io/en/latest/basicswap-dex/basicswap_explained.html)
- [Liquid Technical Overview](https://docs.liquid.net/docs/technical-overview)
- [Liquid Confidential Transactions - Bitcoin Magazine](https://bitcoinmagazine.com/technical/liquid-for-bitcoiners-confidential-transaction)
- [Liquid Federation Q4 2025 Update](https://blog.liquid.net/liquid-federation-quarterly-update-q4-2025/)
- [Boltz Exchange](https://boltz.exchange/)
- [Boltz - Bitcoin Magazine](https://bitcoinmagazine.com/business/boltz-exchange-becoming-the-leading-bridge-across-bitcoin-layers-via-holy-grail-technology)
- [Boltz Liquid Swaps Launch](https://blog.boltz.exchange/p/launching-liquid-swaps-unfairly-cheap)
- [Stonewall Transaction - Bitcoin Manual](https://thebitcoinmanual.com/articles/btc-stonewall-transaction/)
- [Stonewall - Samourai](https://samouraiwallet.com/stonewall)
- [Spending Privately - Sparrow Wallet](https://sparrowwallet.com/docs/spending-privately.html)
- [Wallet Fingerprinting nLocktime nVersion](https://consentonchain.github.io/blog/posts/fingerprinting/)
- [Wallet Fingerprints Detection - Ishaana](https://ishaana.com/blog/wallet_fingerprinting/)
- [BIP 326 Anti-Fee-Sniping Taproot](https://bips.dev/326/)
- [Common Input Ownership Heuristic - Bitcoin Wiki](https://en.bitcoin.it/wiki/Common-input-ownership_heuristic)
- [Script Type Heuristic - River](https://river.com/learn/terms/s/script-type-heuristic/)
- [RBF - Bitcoin Optech](https://bitcoinops.org/en/topics/replace-by-fee/)
- [BnB Coin Selection PR #10637 - Bitcoin Core](https://github.com/bitcoin/bitcoin/pull/10637)
- [BnB Coin Selection - Summer of Bitcoin](http://blog.summerofbitcoin.org/coin-selection-for-dummies-2/)
- [MuSig2 Loop Swaps - Lightning Labs](https://lightning.engineering/posts/2025-02-13-loop-musig2/)
- [Simple Taproot Channels - Bitcoin Optech](https://bitcoinops.org/en/topics/simple-taproot-channels/)
- [Channel CoinJoins - Lightning Privacy](https://lightningprivacy.com/en/channel-coinjoins)
- [Privacy - Bitcoin Wiki](https://en.bitcoin.it/wiki/Privacy)
- [Address Reuse - Bitcoin Wiki](https://en.bitcoin.it/wiki/Address_reuse)
- [Bitcoin Privacy Guide - Bitcoiner Guide](https://bitcoiner.guide/privacy/segregate/)
- [UTXO Management Guide - Casa](https://blog.casa.io/utxo-management-guide/)
- [Bisq - P2P Trading](https://baltex.io/blog/ecosystem/p2p-crypto-trading-2025-best-platforms-buy-bitcoin-without-kyc)
- [Buy Bitcoin Anonymously 2026 - 99Bitcoins](https://99bitcoins.com/buy-bitcoin/anonymously-without-id/)
- [THORChain Private Swaps 2026](https://baltex.io/blog/ecosystem/thorchain-private-swaps-anonymous-btc-2026-guide)
