# Advanced Features Roadmap

Future features derived from research in research-bithypha-competitive-analysis.md, research-entity-labels.md, and research-exchange-coinjoin-blocking.md.
These require multi-day implementation effort and are tracked here for future sprints.

## 1. Bloom Filter Infrastructure for Exchange Detection

Compact probabilistic data structure to test if an address belongs to a known exchange.
1M addresses at 1% false positive rate = ~1.2MB.

- Lazy-loaded (not in initial bundle), opt-in toggle in settings
- Cannot identify WHICH exchange - only "probably an exchange"
- Data sourcing: academic datasets (Elliptic++), community contributions
- Build script to compile exchange address lists into binary Bloom filter
- Files: `src/lib/labels/bloom/`, `scripts/build-exchange-bloom.ts`, `public/data/exchange-bloom.bin`

## 2. "Bring Your Own Labels" Feature

Users import CSV/JSON of address labels stored in browser localStorage.

- Labels never leave browser (privacy-first)
- Follow existing `useSyncExternalStore` pattern for localStorage
- Drag-and-drop or file picker for CSV/JSON import
- Expected format: `address,category,label`
- Integrated into label service for use in analysis
- Files: `src/components/LabelImporter.tsx`, `src/hooks/useUserLabels.ts`

## 3. Opt-in Chainabuse API Lookup

Third row in CexRiskPanel querying Chainabuse API (~500K scam reports).

- Opt-in only with privacy warning (reveals addresses to TRM Labs)
- Tor proxy support for Umbrel users
- Returns abuse type (scam, ransomware, darknet, etc.)
- Needs Cloudflare Worker proxy (same pattern as Chainalysis)
- Files: `src/lib/analysis/cex-risk/chainabuse-check.ts`, `workers/chainabuse-proxy/`

## 4. Taint Propagation Warning (One-Hop Ancestry Check)

For address analysis, check if received tx inputs have CoinJoin ancestry.

- Warns users they may be flagged even if they never mixed
- Opt-in (requires extra API calls to fetch parent transactions)
- Rate-limited, follows cluster analysis opt-in pattern
- Cite BlockFi case: loan closed because coins had prior CoinJoin history from previous owner
- Files: `src/lib/analysis/heuristics/taint-check.ts`, `orchestrator.ts`

## 5. Bithypha Integration

Investigated February 2026: No public API exists. GitHub org has zero public repos.
Would require direct outreach about API access or partnership.

## 6. Unified Label Service Architecture

Foundation layer for items 1-4 above.

- `src/lib/labels/label-service.ts` with `checkLabels(addresses) => Map<string, Label[]>`
- Provider pattern: OFAC, mining pools, Bloom filters, user imports as separate providers
- Orchestrator and CexRiskPanel call unified service
- Should be implemented before Bloom filters or user import features

## 7. Mining Pool Payout Address Detection

Bundle known mining pool payout addresses for informational detection.

- Small JSON dataset (Foundry, AntPool, F2Pool, ViaBTC, etc.)
- Set-based lookup following ofac-check.ts pattern
- Informational/neutral findings (interacting with mining pool is not bad for privacy)
- Integrate into pre-send check and CexRiskPanel
- Files: `src/data/mining-pools.json`, `src/lib/analysis/cex-risk/mining-pool-check.ts`

## 8. Entity-Aware Findings in Main Pipeline

Add "Entity check" heuristic step to TX and address analysis pipelines.

- Run all addresses through label service
- Generate findings for matches (OFAC: critical/-30, mining pool: informational/0, exchange: medium/-5)
- Requires label service (#6) as foundation
- Add to DiagnosticLoader step list for UI progress effect
