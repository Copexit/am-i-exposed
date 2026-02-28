# TODO

Low-priority improvements to revisit when time permits.

## Replace regex address validation with `bitcoin-address-validation`

The npm package [`bitcoin-address-validation`](https://github.com/ruigomeseu/bitcoin-address-validation) (~5-8 kB gzipped, browser-safe, zero Node.js deps) could replace the hand-rolled regex patterns in:

- `src/lib/analysis/detect-input.ts` - input classification (txid vs address vs invalid)
- `src/lib/bitcoin/address-type.ts` - address type detection (P2PKH, P2SH, P2WPKH, P2WSH, P2TR)

Benefits:
- Real checksum validation (catches typos before hitting the API)
- `getAddressInfo(addr)` returns `{ type, network, bech32 }` in one call
- Covers mainnet, testnet, signet, regtest

Current approach works fine - this is a cleanup/correctness improvement, not a bug fix.
