# Backlog

Open items only. Each one was checked against the code; delete an entry when it ships.

## Analysis

- **Address checksum validation.** `src/lib/analysis/detect-input.ts` and `src/lib/bitcoin/address-type.ts` classify addresses by regex only, so a typo is caught by the API (404), not locally. `@scure/base` (already a dependency) provides bech32/bech32m and base58check decoding.
- **CoinJoin ancestry warning for address scans.** Taint and entity proximity run for txid scans only. An address scan could check one hop back for CoinJoin ancestry of received funds (opt-in, extra API calls, same pattern as the cluster panel).

- **Lightning close vs. anti-fee-sniping.** `src/lib/analysis/heuristics/multisig-detection.ts` sets `likelyLN = tx.locktime > 0 && !maxSequence` for 1-in/2-out 2-of-2 spends. A Bitcoin Core anti-fee-sniping spend (locktime = current height, nSequence 0xfffffffd) matches, so an ordinary 2-of-2 cold-storage spend is reported as a likely Lightning channel close. LN commitment/closing txs use a locktime with upper byte 0x20 and an obscured sequence (upper byte 0x80); checking those would separate the two.

## Accepted trade-offs

- **32-bit hash keys in the entity index (EIDX).** Entries are keyed by a seeded FNV-1a 32-bit hash with no string verification at lookup, so with millions of entries some unrelated addresses collide and would return the wrong entity name. Accepted to keep the index small; revisit (e.g. 64-bit keys) if false entity matches are reported.

## Labels and screening

- **User-imported labels.** Import a CSV/JSON of `address,category,label` kept in the browser only, and match it alongside the entity index.
- **Opt-in Chainabuse lookup.** A third check in `CexRiskPanel` via a proxy worker (same pattern as `workers/chainalysis-proxy`), with a warning that the lookup reveals the addresses to the provider.

## Graph explorer UX

- Sidebar is a fixed 320px (`SIDEBAR_WIDTH` in `GraphSidebar.tsx`) on every screen size; no resize.
- Collapsed nodes use four text sizes (11/10/9/9px in `GraphNodeRenderer.tsx`); a two-line layout with consistent sizing would read better.
- Expanded node port rows have no alternating shading, so long input/output lists blur together.

## Guide visuals

Diagrams for the guide page that do not exist yet: peel chain (decreasing amounts hop by hop), cluster growth via CIOH plus change following, and coin control (paying with an exact UTXO match vs. change / extra inputs).

Intentionally dropped from the old chart list: address type distribution (would need live network stats), multiple-sweeps strategy, Stowaway/PayJoin pre-cycles and Stonewall fund distribution (Samourai-specific workflows whose wallets are discontinued).
