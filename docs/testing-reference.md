# Testing Reference

## Example Transactions for Manual Testing

Expected scores are the heuristic-only golden values (see the [Score Validation Matrix](#score-validation-matrix)); a live web scan can differ slightly because chain and entity findings also count.

### 1. Whirlpool CoinJoin (5 equal outputs, 0.05 BTC pool)
- **TXID:** `323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2`
- **Pattern:** 5 inputs, 5 outputs, all outputs exactly 5,000,000 sats
- **Expected score:** A+ 100 (CoinJoin detected, high entropy)
- https://mempool.space/tx/323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2

### 2. WabiSabi / Wasabi CoinJoin (massive, many equal outputs)
- **TXID:** `fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e`
- **Pattern:** 327 inputs, 279 outputs, power-of-2 denominations with many equal tiers
- **Expected score:** A+ 100 (large CoinJoin, very high entropy)
- https://mempool.space/tx/fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e

### 3. JoinMarket CoinJoin (maker/taker)
- **TXID:** `4f112abd2eefe3484a7bbf7c1731f784cba19de677468835145e9c448fb18b7d`
- **Pattern:** 2 inputs, 4 outputs, 2 equal outputs + 2 change outputs
- **Expected score:** B 89 (Stonewall-style CoinJoin)
- https://mempool.space/tx/4f112abd2eefe3484a7bbf7c1731f784cba19de677468835145e9c448fb18b7d

### 4. Taproot (P2TR) Transaction
- **TXID:** `0bf67b1f05326afbd613e11631a2b86466ac7e255499f6286e31b9d7d889cee7`
- **Pattern:** 1 P2TR input, 2 outputs, contains OP_RETURN with BitGo message
- **Expected score:** C 56 (OP_RETURN data, data-payment change, script mix)
- https://mempool.space/tx/0bf67b1f05326afbd613e11631a2b86466ac7e255499f6286e31b9d7d889cee7

### 5. Multisig Transaction (bare P2MS)
- **TXID:** `60a20bd93aa49ab4b28d514ec10b06e1829ce6818ec06cd3aabd013ebcdc4bb1`
- **Pattern:** 3 inputs, 3 outputs, 1-of-2 bare multisig output
- **Expected score:** F 11 (same address in inputs and outputs, round amounts, bare multisig)
- https://mempool.space/tx/60a20bd93aa49ab4b28d514ec10b06e1829ce6818ec06cd3aabd013ebcdc4bb1

### 6. OP_RETURN Data ("charley loves heidi")
- **TXID:** `8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684`
- **Pattern:** 1 input, 2 outputs (1 op_return with ASCII text, 1 P2PKH)
- **Expected score:** D 49 (self-send, OP_RETURN metadata)
- https://mempool.space/tx/8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684

### 7. Extreme Address Reuse (Satoshi's Genesis Address)
- **Address:** `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa`
- **Pattern:** 67,762 funded outputs, 56,713 transactions
- **Expected score:** F 0 (extreme reuse, legacy P2PKH)

### 8. Simple Legacy P2PKH (1-in 2-out)
- **TXID:** `0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4`
- **Pattern:** 1 P2PKH input, 2 P2PKH outputs
- **Expected score:** C 52 (change identifiable, low entropy)
- https://mempool.space/tx/0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4

### 9. Batched Exchange Withdrawal (143 outputs)
- **TXID:** `3d81a6b95903dd457d45a2fc998acc42fe96f59ef01157bdcbc331fe451c8d9e`
- **Pattern:** 1 input, 143 outputs, mixed address types
- **Expected score:** C 56 (fan-out, exchange withdrawal pattern, script mix)
- https://mempool.space/tx/3d81a6b95903dd457d45a2fc998acc42fe96f59ef01157bdcbc331fe451c8d9e

### 10. Dust Attack (555 sats)
- **TXID:** `655c533bf059721cec9d3d70b3171a07997991a02fedfa1c9b593abc645e1cc5`
- **Pattern:** Sends 555 sats (dust) to target address for tracking
- **Expected score:** F 24 (deterministic address reuse in I/O triggers compound cap)
- https://mempool.space/tx/655c533bf059721cec9d3d70b3171a07997991a02fedfa1c9b593abc645e1cc5

### 11. First Taproot Script-Path Spend (achow101, block 709635)
- **TXID:** `37777defed8717c581b4c0509329550e344bdc14ac38f71fc050096887e535c8`
- **Pattern:** 2 P2TR inputs, 1 P2WPKH output (script path spend)
- **Expected score:** D 46 (CIOH, zero-entropy sweep, behavioral fingerprint rollup)
- https://mempool.space/tx/37777defed8717c581b4c0509329550e344bdc14ac38f71fc050096887e535c8

## Test Addresses

| Address | Type | Reuse | Notes |
|---------|------|-------|-------|
| `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` | P2PKH | Extreme | Satoshi's Genesis address |
| `bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq` | P2WPKH | Low | Common SegWit test address |
| `bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297` | P2TR | None | Taproot address |

## Score Validation Matrix

Values are asserted by `src/lib/analysis/__tests__/golden-cases.test.ts` (heuristics only: no chain trace, fiat prices or entity data). A web scan of the same txid can land a few points lower because chain and entity findings also count; the e2e specs document those deltas. When a golden value changes, update the test and this table together. Only findings with a non-zero impact are listed.

| Scenario | Type | Base | Grade | Score | Findings (impact) |
|----------|------|------|-------|-------|-------------------|
| Whirlpool 5x5 | tx | 70 | A+ | 100 | h4-whirlpool (+30), h5-entropy (+15), anon-set-strong (+5), script-uniform (+2) |
| WabiSabi 300+ | tx | 70 | A+ | 100 | h4-coinjoin (+25), h5-entropy (+15), anon-set-strong (+5) |
| JoinMarket 2x equal | tx | 70 | B | 89 | h4-stonewall (+15), h5-entropy (+2), script-uniform (+2) |
| Taproot + OP_RETURN | tx | 70 | C | 56 | h2-data-payment (-5), h7-op-return (-5), h11-wallet-fingerprint (-3), script-mixed (-1) |
| Bare multisig | tx | 70 | F | 11 | h2-same-address-io (-20), h1-round-amount (-16), script-multisig (-8), behavioral-fingerprint-rollup (-6), h3-cioh (-6), h11-wallet-fingerprint (-3), h5-entropy (+2), script-mixed (-1), h-coin-selection-value-asc (-1) |
| OP_RETURN charley | tx | 70 | D | 49 | h2-self-send (-15), h7-op-return (-5), h11-wallet-fingerprint (-3), script-uniform (+2) |
| Simple legacy P2PKH | tx | 70 | C | 52 | h2-change-detected (-14), h5-low-entropy (-3), h11-wallet-fingerprint (-3), script-uniform (+2) |
| Batch withdrawal 143 | tx | 70 | C | 56 | h5-low-entropy (-3), script-mixed (-3), exchange-withdrawal-pattern (-3), h11-wallet-fingerprint (-3), consolidation-fan-out (-3), anon-set-moderate (+1) |
| Dust attack 555 sats | tx | 70 | F | 24 | h2-same-address-io (-20), compound-deterministic-cap (-12), dust-attack (-8), h11-wallet-fingerprint (-5), h5-low-entropy (-3), script-uniform (+2) |
| Taproot script-path | tx | 70 | D | 46 | behavioral-fingerprint-rollup (-12), h3-cioh (-6), h5-zero-entropy-sweep (-3), h11-wallet-fingerprint (-3), h6-round-fee-rate (-2), witness-mixed-depths (-1), h-coin-selection-bnb (+3) |
| Satoshi's address | addr | 93 | F | 0 | h8-address-reuse (-93), recurring-payment-pattern (-10), high-activity-exchange (-8), temporal-burst-high (-5), h10-p2pkh (-5), spending-high-volume (-3), spending-never-spent (+2) |

## Research References

Community-provided example transactions for future heuristic development. These document on-chain patterns of P2P exchanges, sweeps, and wallet fingerprinting. Provided by community reviewer (March 2026).

### 12. HodlHodl Escrow (2-of-3 Multisig)
- **TXID:** `7723b1bba65cfe805e9dc19fd3981791bdd0984afd5d144bf78abc3bdd522577`
- **Pattern:** P2SH (2-of-3 multisig) spend to 2 P2WPKH outputs (85,829 + 696 sats)
- **Identifiable by:** 2-of-3 multisig structure visible in witness data when escrow is spent
- **Privacy lesson:** Multisig escrow pattern is identifiable on-chain, links trade participants
- https://mempool.space/tx/7723b1bba65cfe805e9dc19fd3981791bdd0984afd5d144bf78abc3bdd522577

### 13. HodlHodl Escrow Release
- **TXID:** `6a3dd5ef3972c83395499ed5128b5f62d10af35ac00c9acc74bedc5a1da53a9d`
- **Pattern:** P2SH (2-of-3 multisig) spend to 3 P2WPKH outputs (1,100,275 + 8,959 + 995 sats)
- **Critical:** Output address `bc1qqmmzt02nu4rqxe03se2zqpw63k0khnwq959zxq` appears in BOTH this tx and the escrow tx above - fee address reuse links independent trades
- **Privacy lesson:** Platform fee addresses create cross-trade linkability even on non-custodial exchanges
- https://mempool.space/tx/6a3dd5ef3972c83395499ed5128b5f62d10af35ac00c9acc74bedc5a1da53a9d

### 14. Sweep / Wallet Hop (Different nLockTime)
- **TXID:** `d41bdca5474d5405153fe9cd57163eea72f16534ea0ac0ad3fd8d46aed2e3a09`
- **Pattern:** 1 P2WPKH input -> 1 P2WPKH output (973,702 -> 971,677 sats)
- **Identifiable by:** Zero entropy (1-in-1-out), trivially traceable. Different nLockTime/nVersion from prior tx suggests wallet software change ("wallet hop")
- **Privacy lesson:** Wallet hops (sending to yourself in a different wallet) provide zero unlinkability - chain analysts follow 1-in-1-out hops without difficulty
- https://mempool.space/tx/d41bdca5474d5405153fe9cd57163eea72f16534ea0ac0ad3fd8d46aed2e3a09

### Bisq Fee Addresses (Known DAO Addresses)
- **Taker fee:** `bc1qwxsnvnt7724gg02q624q2pknaqjaaj0vff36vr` (~2,238 txs, extreme reuse, expected F)
- **Maker fee:** `bc1qfy0hw3txwtkr6xrhk965vjkqqcdn5vx2lrt64a` (~417 txs, significant reuse, expected F)
- **Identifiable by:** Any tx sending to these addresses is identifiable as a Bisq trade fee payment
- **Two independent fingerprinting signals:** Known DAO fee addresses + 2-of-2 multisig escrow pattern
- **Privacy lesson:** Decentralized exchanges have better privacy than centralized ones, but their on-chain escrow patterns are still identifiable

### Future Research Areas

These require either multi-transaction graph analysis (architectural change) or more sample data:

- **Bisq fingerprinting:** 2-of-2 multisig escrow + known DAO fee addresses = two independent detection signals. Community reviewer to provide more samples.
- **HodlHodl fingerprinting:** 2-of-3 multisig + reused fee collection address. Two example txs captured above.
- **Wallet hop detection:** Cross-tx nLockTime/nVersion changes indicating wallet software switch. Requires multi-tx graph analysis.
- **P2SH/P2WSH script unwrapping:** Extracting M-of-N from witness data to distinguish escrow from cold storage multisig.
