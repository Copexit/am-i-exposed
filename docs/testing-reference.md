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
- **Expected score:** C-D
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

| Scenario | Expected Grade | Score | Key Heuristics |
|----------|---------------|-------|----------------|
| Whirlpool 5x5 | A+ | 100 | H4 (+30), H5 (+15), anon (+5), script (+2) |
| WabiSabi 300+ | A+ | 100 | H4 (+25), H5 (+15), anon (+5) |
| Satoshi's address | F | 0 | H8 (-70), H10 (-5), spending (-3), spending (+2) |
| SegWit reused 88x | F | 12 | H8 (-40), H9 dust (-8), spending (-5) |
| Simple legacy P2PKH | C | 65 | H5 (-3), H11 (-3), anon (-1), script (+2) |
| Taproot + OP_RETURN | C | 57 | H5 (-5), H7 (-5), H11 (-2), script (-1) |
| JoinMarket 2x equal | B | 84 | H5 (-3), H4 (+15), script (+2) |
| Bare multisig | F | 19 | H2 (-20), script-multisig (-8), H1 (-10), H3 (-6), H5 (-3), H11 (-2), anon (-1), script (-1) |
| OP_RETURN charley | D | 45 | H2 (-15), H5 (-5), H7 (-5), H11 (-2), script (+2) |
| Dust attack 555 sats | D | 37 | H2 (-20), dust (-8), H5 (-3), H11 (-3), anon (-1), script (+2) |
| Batch withdrawal 143 | C | 63 | H5 (-3), script (-3), H11 (-2), anon (+1) |
| Taproot script-path | C | 56 | H3 (-6), H5 (-3), H6 (-2), H11 (-3) |
