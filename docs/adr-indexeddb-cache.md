# ADR: IndexedDB Persistent API Cache

## Status
Accepted

## Context

The app makes hundreds of API calls to mempool.space per analysis. If a user analyzes the same transaction, address, or xpub twice, 100% of API calls are re-fetched. The only caching is a small sessionStorage cache in `useDeepAnalysis` (500 entries, wiped on page reload). Wallet scans (90+ calls with 9-second delays on hosted API) and deep chain traces (100+ calls at depth 6) are the worst offenders.

## Decision

Add a persistent IndexedDB cache layer at the API client level via `createCachedMempoolClient()` - a transparent wrapper that returns the same `MempoolClient` interface. Every consumer automatically benefits with zero code changes.

### What Gets Cached

| Data Type | Cache Key | TTL | Rationale |
|-----------|-----------|-----|-----------|
| Confirmed transactions | `{net}:tx:{txid}` | Infinite | Immutable once confirmed |
| Transaction hex | `{net}:txhex:{txid}` | Infinite | Immutable |
| Outspends | `{net}:outspend:{txid}` | 1 hour | Near-immutable, but unspent outputs can get spent within a block cycle |
| Historical prices | `{net}:price:{currency}:{ts}` | Infinite | Past prices never change |
| Address data | `{net}:addr:{address}` | 10 min - 1 hour | Adaptive: 10 min if mempool activity, 1 hour if only confirmed |
| Address UTXOs | `{net}:utxo:{address}` | 10 min - 1 hour | 1 hour if all confirmed, 10 min otherwise |
| Address txs | `{net}:addrtxs:{address}:{maxPages}` | 10 min - 12 hours | Adaptive: 12h if last tx > 30 days, 1h if > 7 days, 10 min if recent |

### Key Design Decisions

1. **Single-tier IndexedDB cache** - no in-memory L1 layer needed. IndexedDB reads are 1-5ms, and within a single analysis, existing `visited` sets prevent redundant fetches.
2. **No external dependencies** - raw IndexedDB with a thin ~200-line wrapper. No Dexie - the API surface is just `get/put/delete/clear`.
3. **Network-prefixed keys** - format `{network}:{type}:{identifier}` prevents cross-network cache pollution.
4. **In-memory fallback** - if IndexedDB is unavailable (incognito, SSR), uses `Map` with same API.
5. **Max 10,000 entries** (~40MB estimated). Evict oldest 20% when exceeded.
6. **Only cache confirmed transactions with infinite TTL** - unconfirmed txs get 10-minute TTL.
7. **`enableCache` toggle** - users can disable persistent caching from Settings. When disabled, the cache is cleared (database deleted) and all methods pass through to the inner client. The in-memory fallback still operates for the current session.
8. **Forensic-clean clear** - `idbClear()` uses `indexedDB.deleteDatabase()` instead of `store.clear()`, leaving no empty DB shell behind.
9. **Smart address TTLs** - address data uses adaptive TTLs based on activity recency. Old/inactive addresses (no tx in 30+ days) cache for 12 hours. This dramatically reduces re-fetches during wallet scans.
10. **Cache-aware wallet scan throttling** - `scanChain()` times each `fetchAddress()` call. If it resolves in <100ms (IDB cache hit), the rate-limiting delay is skipped entirely. Only API misses count toward the burst counter.

## Consequences

- Repeat analyses of the same transaction/address are near-instant
- Wallet scans for previously scanned xpubs skip most API calls and delays
- Reduced load on mempool.space
- ~200 LOC new code, no new runtime dependencies
- Old sessionStorage cache (`cache.ts`) can be deprecated
- Users who prefer no local persistence can disable from Settings
