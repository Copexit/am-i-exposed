# Mempool API: Hosted vs Self-Hosted Differences

## Summary

The hosted mempool.space and self-hosted mempool instances (e.g., Umbrel) can return different data, causing am-i-exposed heuristics to produce incorrect results. The root cause is the backend indexer: hosted mempool.space runs `mempool/electrs` (their own fork) while Umbrel ships `romanz/electrs` which has significantly less capability.

## The Three electrs Forks

| Fork | Used By | Storage | Capabilities |
|---|---|---|---|
| `romanz/electrs` | Umbrel, home servers | ~10% of chain | Basic Electrum protocol, limited address history |
| `blockstream/electrs` | blockstream.info (deprecated) | ~1.3TB | Full HTTP REST + Electrum |
| `mempool/electrs` | mempool.space | ~1.3TB | Full HTTP REST + Electrum + extended APIs |

## Known Differences

### 1. `prevout` on transaction inputs (CRITICAL)

The `/api/tx/{txid}` endpoint returns `vin[].prevout` which contains the previous output's address, value, and script type. This field is essential for nearly all transaction-level heuristics (CIOH, change detection, round amounts, entropy, etc.).

- **mempool.space**: Always populated - `mempool/electrs` maintains a full transaction store
- **Umbrel (romanz/electrs)**: Can be **null or missing** - does not maintain the same indexes
- **Impact**: When null, virtually all 12 transaction-level heuristics break

### 2. Address endpoint reliability

The `/api/address/{address}` endpoint returns `chain_stats` and `mempool_stats` with `funded_txo_count`, `tx_count`, etc.

- **mempool.space**: Handles arbitrarily large address histories
- **Umbrel (romanz/electrs)**:
  - Addresses with 1500+ transactions may **timeout or fail**
  - P2SH addresses (starting with `3`) have been reported to fail on Umbrel even when fully synced
  - Has a configurable `txid_limit` that defaults to a conservative value
- **Response schema is the same** when queries succeed - the difference is reliability, not format

### 3. Outspend tracking

The `/api/tx/{txid}/outspends` endpoint (whether each output has been spent).

- **mempool.space**: Fully supported via `mempool/electrs`
- **Umbrel (romanz/electrs)**: **Not supported** (GitHub issue mempool/mempool#1195)
- **Impact**: Currently not used by am-i-exposed, but relevant for future features

### 4. Address prefix search

The `/api/address-prefix/{prefix}` endpoint.

- **mempool.space**: Supported
- **Umbrel (romanz/electrs)**: Not supported
- **Impact**: Not used by am-i-exposed

## What Umbrel Ships

Umbrel's mempool app runs with `MEMPOOL_BACKEND: "electrum"` and uses `romanz/electrs` as the Electrum server backend. This is the lightest-weight option but has the most limitations.

The `MEMPOOL_BACKEND` values determine capabilities:

| Feature | `"none"` | `"electrum"` (Umbrel) | `"esplora"` (mempool.space) |
|---|---|---|---|
| Transaction lookup by txid | Yes | Yes | Yes |
| Address lookup | **No** | Yes (with limits) | Yes |
| `prevout` on vin | **No** | Partial/unreliable | **Yes** |
| Outspend endpoints | **No** | **No** | **Yes** |

## Impact on am-i-exposed

### Pre-send destination check

When `funded_txo_count` returns 0 on Umbrel but the address actually has funds, the app incorrectly shows "Low Risk" / "This address appears unused." The `tx_count` field may still have the correct value, providing a fallback signal.

**Fix implemented**: Use `tx_count` as fallback - if `funded_txo_count=0` but `tx_count>0`, flag as MEDIUM risk.

### Transaction-level heuristics

When `prevout` is null, heuristics that inspect input addresses/values silently fail or produce incomplete analysis. This is a fundamental limitation of `romanz/electrs`.

**Potential future fix**: Detect when prevout data is missing and show a warning banner explaining that the self-hosted mempool has limited data. Could suggest upgrading to `mempool/electrs` or Fulcrum.

### Recommended self-hosted setup for full compatibility

For full parity with mempool.space:
1. Bitcoin Core with `txindex=1`
2. `mempool/electrs` (esplora mode) - requires ~1.3TB NVMe SSD
3. MariaDB
4. Mempool backend with `MEMPOOL_BACKEND: "esplora"`

Lighter alternative with good compatibility:
1. Bitcoin Core with `txindex=1`
2. Fulcrum (C++ Electrum server) - better than romanz/electrs for address lookups
3. `MEMPOOL_BACKEND: "electrum"`

## References

- [mempool/mempool GitHub](https://github.com/mempool/mempool)
- [mempool/electrs GitHub](https://github.com/mempool/electrs)
- [Umbrel Community: different results than mempool.space](https://community.umbrel.com/t/umbrel-mempool-has-different-results-than-mempool-space/21896)
- [Umbrel Community: Error loading address data](https://community.umbrel.com/t/mempool-error-loading-address-data-still-happening/6821)
- [mempool GitHub Issue #1195: outspend with romanz/electrs](https://github.com/mempool/mempool/issues/1195)
- [romanz/electrs: large address histories](https://github.com/romanz/electrs/discussions/472)
