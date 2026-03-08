# Testing Reference

## Example Transactions for Manual Testing

### 1. Whirlpool CoinJoin (5 equal outputs, 0.05 BTC pool)
- **TXID:** `323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2`
- **Pattern:** 5 inputs, 5 outputs, all outputs exactly 5,000,000 sats
- **Expected score:** A+ (CoinJoin detected, high entropy)
- https://mempool.space/tx/323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2

### 2. WabiSabi / Wasabi CoinJoin (massive, many equal outputs)
- **TXID:** `fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e`
- **Pattern:** 327 inputs, 279 outputs, power-of-2 denominations with many equal tiers
- **Expected score:** A+ (large CoinJoin, very high entropy)
- https://mempool.space/tx/fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e

### 3. JoinMarket CoinJoin (maker/taker)
- **TXID:** `4f112abd2eefe3484a7bbf7c1731f784cba19de677468835145e9c448fb18b7d`
- **Pattern:** 2 inputs, 4 outputs, 2 equal outputs + 2 change outputs
- **Expected score:** B-C (small CoinJoin, limited equal outputs)
- https://mempool.space/tx/4f112abd2eefe3484a7bbf7c1731f784cba19de677468835145e9c448fb18b7d

### 4. Taproot (P2TR) Transaction
- **TXID:** `0bf67b1f05326afbd613e11631a2b86466ac7e255499f6286e31b9d7d889cee7`
- **Pattern:** 1 P2TR input, 2 outputs, contains OP_RETURN with BitGo message
- **Expected score:** D-C (OP_RETURN data, round amounts, script mix)
- https://mempool.space/tx/0bf67b1f05326afbd613e11631a2b86466ac7e255499f6286e31b9d7d889cee7

### 5. Multisig Transaction (bare P2MS)
- **TXID:** `60a20bd93aa49ab4b28d514ec10b06e1829ce6818ec06cd3aabd013ebcdc4bb1`
- **Pattern:** 3 inputs, 3 outputs, 1-of-2 bare multisig output
- **Expected score:** D-C (early Bitcoin, CIOH, legacy types)
- https://mempool.space/tx/60a20bd93aa49ab4b28d514ec10b06e1829ce6818ec06cd3aabd013ebcdc4bb1

### 6. OP_RETURN Data ("charley loves heidi")
- **TXID:** `8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684`
- **Pattern:** 1 input, 2 outputs (1 op_return with ASCII text, 1 P2PKH)
- **Expected score:** C-D (OP_RETURN metadata, legacy address)
- https://mempool.space/tx/8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684

### 7. Extreme Address Reuse (Satoshi's Genesis Address)
- **Address:** `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa`
- **Pattern:** 67,762 funded outputs, 56,713 transactions
- **Expected score:** F (extreme reuse, legacy P2PKH)

### 8. Simple Legacy P2PKH (1-in 2-out)
- **TXID:** `0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4`
- **Pattern:** 1 P2PKH input, 2 P2PKH outputs
- **Expected score:** C (legacy types, change likely identifiable)
- https://mempool.space/tx/0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4

### 9. Batched Exchange Withdrawal (143 outputs)
- **TXID:** `3d81a6b95903dd457d45a2fc998acc42fe96f59ef01157bdcbc331fe451c8d9e`
- **Pattern:** 1 input, 143 outputs, mixed address types
- **Expected score:** Variable (many outputs but single input)
- https://mempool.space/tx/3d81a6b95903dd457d45a2fc998acc42fe96f59ef01157bdcbc331fe451c8d9e

### 10. Dust Attack (555 sats)
- **TXID:** `655c533bf059721cec9d3d70b3171a07997991a02fedfa1c9b593abc645e1cc5`
- **Pattern:** Sends 555 sats (dust) to target address for tracking
- **Expected score:** F (deterministic address reuse in I/O triggers compound cap)
- https://mempool.space/tx/655c533bf059721cec9d3d70b3171a07997991a02fedfa1c9b593abc645e1cc5

### 11. First Taproot Script-Path Spend (achow101, block 709635)
- **TXID:** `37777defed8717c581b4c0509329550e344bdc14ac38f71fc050096887e535c8`
- **Pattern:** 2 P2TR inputs, 1 P2WPKH output (script path spend)
- **Expected score:** C (CIOH, low entropy, Bitcoin Core fingerprint)
- https://mempool.space/tx/37777defed8717c581b4c0509329550e344bdc14ac38f71fc050096887e535c8

## Test Addresses

| Address | Type | Reuse | Notes |
|---------|------|-------|-------|
| `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` | P2PKH | Extreme | Satoshi's Genesis address |
| `bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq` | P2WPKH | Low | Common SegWit test address |
| `bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297` | P2TR | None | Taproot address |

## Score Validation Matrix

| Scenario | Type | Base | Expected Grade | Score | Key Heuristics |
|----------|------|------|---------------|-------|----------------|
| Whirlpool 5x5 | tx | 70 | A+ | 100 | H4 (+30), H5 (+15), anon (+5), script (+2) |
| WabiSabi 300+ | tx | 70 | A+ | 100 | H4 (+25), H5 (+15), anon (+5) |
| Simple legacy P2PKH | tx | 70 | C | 53 | H2 (-10, compound -4), H11 (-3), anon (-1), script (-1) |
| Taproot + OP_RETURN | tx | 70 | C | 57 | H5 (-5), H7 (-5), H11 (-2), script (-1) |
| JoinMarket 2x equal | tx | 70 | B | 86 | H4 (+12 STONEWALLx2), H5 (+2), anon (+1), script (+2), timing (-1) |
| Bare multisig | tx | 70 | F | 19 | H2 (-20), script-multisig (-8), H1 (-10), H3 (-6), H5 (-3), H11 (-2), anon (-1), script (-1) |
| OP_RETURN charley | tx | 70 | C | 50 | H2 (-15), H7 (-5), H11 (-2), script (+2) |
| Dust attack 555 sats | tx | 70 | F | 24 | H2 (-20), dust (-8), H5 (-3), H11 (0), script (+2), compound-cap (-15) |
| Batch withdrawal 143 | tx | 70 | C | 57 | H5 (-3), script (-3), H11 (-2), anon (+1), fan-out (-3), exchange (-3) |
| Taproot script-path | tx | 70 | C | 56 | H3 (-6), H5 (-3), H6 (-2), H11 (-3) |
| Satoshi's address | addr | 93 | F | 0 | H8 (-93), H10 (-5), H9 dust (-8), spending (-5), cold (+2) |
| SegWit reused 88x | addr | 93 | F | 0 | H8 (-90), H9 dust (-8), H9 utxo (-3), spending (-5) |
| Fresh Taproot (no reuse) | addr | 93 | A+ | 100 | H8 (+3), H10 (0), H9 (+2), cold (+2) |

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
