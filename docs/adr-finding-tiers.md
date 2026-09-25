# ADR: Finding Tiers - Adversary Relevance and Temporality Classification

**Status:** Accepted
**Date:** 2026-03-19

## Prior Art

This design is informed by [SIP-001](https://github.com/satsfy/stealth/blob/sip-001/SIPs/SIP-001.md), a specification for the Stealth Bitcoin UTXO Privacy Audit Framework by Renato Britto (satsfy). SIP-001 defines a comprehensive vulnerability taxonomy where every finding carries structured metadata beyond severity: `adversary_relevance` (passive_observer, kyc_exchange, state_adversary), `temporality` (HISTORICAL, ONGOING_PATTERN, ACTIVE_RISK), `confidence` (CERTAIN, PROBABLE, POSSIBLE), and formal dependency edges (`specializes`, `generalizes`, `implies`) for deduplication.

Key concepts adopted from SIP-001:

- **Adversary relevance tiers.** Different findings require different adversary capabilities to exploit. A dust attack requires state-level tracking infrastructure; address reuse is visible to anyone reading the public blockchain. Tagging findings with adversary tiers enables users to filter by their actual threat model.

- **Temporality classification.** Findings differ in whether the damage is fixable. `HISTORICAL` findings are permanently on-chain. `ONGOING_PATTERN` findings reflect changeable behavior. `ACTIVE_RISK` findings represent unspent UTXOs where the user can still act. This maps directly to user intent: "what can I still do about this?"

- **Formal finding dependency model.** SIP-001's `specializes/generalizes/implies` edges provide a clean declarative model for the finding suppression and deduplication that am-i-exposed currently implements procedurally in `cross-heuristic.ts`. While am-i-exposed's compound rules (RBF x Change, post-mix entity escalation) are more sophisticated than simple edges can express, the declarative model is cleaner for basic specialization/generalization cases.

- **Confidence in scoring.** SIP-001 uses `severity_weight x confidence_multiplier` rather than hand-tuned impact numbers. am-i-exposed already populates confidence on most findings but doesn't use it in scoring - an opportunity for future improvement.

- **CHANGE_REUSE as distinct finding.** Change reuse (sending change to a previously-funded address) directly collapses two transaction histories. am-i-exposed detects both signals independently but doesn't escalate their intersection.

- **BEHAVIORAL_FINGERPRINT rollup.** A compound finding that fires when >=2 behavioral sub-signals (fee rate, RBF, output ordering, amount patterns) co-occur, escalating to CRITICAL at >=4. am-i-exposed implements this as `applyBehavioralRollup()` in cross-heuristic.ts, emitting a compound finding at 2+ signals and escalating to critical at 4+.

- **UTXO_AGE_SPREAD.** Flagging when co-spent UTXOs have vastly different creation heights reveals dormancy patterns to chain analysts. This is now implemented as `utxo-age-spread.ts`, detecting co-spent UTXOs with creation heights spanning 1+ years.

These concepts are adapted to am-i-exposed's client-side, API-based architecture (vs. SIP-001's full-node, descriptor-native design), centralized in a metadata registry rather than embedded per-finding, and extended with am-i-exposed's existing cross-heuristic intelligence.

## Problem

The privacy engine classifies findings by severity (critical/high/medium/low/good) and optionally by confidence (deterministic/high/medium/low). These dimensions tell users how BAD a finding is and how CERTAIN the detection is, but miss two critical questions:

1. **Who cares?** A dust output is exploitable only by a state-level adversary with active tracking infrastructure. Address reuse is exploitable by anyone reading the public blockchain. Both can have the same severity, but the adversary needed to exploit them is vastly different. Users with different threat models (merchant vs cypherpunk vs journalist) need different prioritization.

2. **Can I still fix this?** A past consolidation is permanently on-chain. A behavioral fingerprint (consistent fee rates) is fixable by changing future behavior. An unspent dust UTXO is actionable right now. Users need to know what they can still do something about versus what damage is already done.

Without these dimensions, users see a flat list of findings sorted by severity with no way to filter by their actual threat model or by actionability.

## Decision

Add two new metadata dimensions to every finding, implemented via a centralized metadata registry.

### Adversary Relevance Tiers

Every finding is tagged with which adversary types can exploit it. Tiers are cumulative - a state adversary can do everything a passive observer can:

| Tier | ID | Description | Example Findings |
|---|---|---|---|
| **Public** | `passive_observer` | Anyone reading the public blockchain with standard heuristics. No identity data, no off-chain intelligence. | CIOH, round amounts, change detection, entropy, wallet fingerprint |
| **KYC** | `kyc_exchange` | Exchanges or services with identity documents for the user. Can anchor address clusters to real-world identities. | Exchange withdrawal patterns, entity-known-output, address reuse (when one party is KYC'd) |
| **State** | `state_adversary` | Intelligence-grade analysis with full transaction graph access, timing correlation, multiple data feeds, and potentially ISP-level metadata. | Dust attacks (as tracking vectors), taint propagation, behavioral fingerprint compounds, entity proximity across many hops |

A finding's `adversaryTiers` is an array listing ALL tiers that can exploit it. The highest tier listed represents the minimum adversary sophistication needed, but lower tiers are included when they also benefit.

### Temporality Classification

Every finding is tagged with whether the underlying exposure is fixable:

| Class | ID | Description | Example Findings |
|---|---|---|---|
| **Past** | `historical` | Already on-chain. Cannot be undone. Damage is permanent, but future behavior can avoid repeating the pattern. | CIOH, consolidation, change detection, peel chain, past entity sends |
| **Pattern** | `ongoing_pattern` | Behavioral pattern visible across multiple transactions. Fixable by changing future transaction behavior (different wallet, fee policy, etc.). | Wallet fingerprint, fee rate fingerprint, BIP69 ordering, coin selection algorithm, RBF signaling consistency |
| **Active** | `active_risk` | Unspent UTXO or live risk that is actionable right now. The user can take immediate steps to prevent exploitation. | Dust UTXOs (don't spend with other coins), unspent outputs to known entities, large UTXO set fragmentation |

## Architecture

### Centralized Metadata Registry

Rather than modifying ~100+ finding creation sites across 37 heuristic files and 13 chain analysis modules, classifications live in a single centralized registry: `src/lib/analysis/finding-metadata.ts`.

The registry maps every known finding ID to its static adversary tiers and temporality. The orchestrator enriches findings with this metadata after heuristics run, before returning results.

Benefits:
- Single source of truth for all classifications (auditable in one file)
- Zero changes to heuristic files
- Zero existing test breakage (new fields are optional on the Finding type)
- Heuristics can override for dynamic cases by setting fields directly on the finding object

### Finding Type Extension

```typescript
export type AdversaryTier = "passive_observer" | "kyc_exchange" | "state_adversary";
export type TemporalityClass = "historical" | "ongoing_pattern" | "active_risk";

// Added to Finding interface (optional fields):
adversaryTiers?: AdversaryTier[];
temporality?: TemporalityClass;
```

### Enrichment Flow

```
Heuristics execute -> Cross-heuristic rules apply -> Metadata enrichment -> Score calculation -> Return
```

The enrichment step runs after cross-heuristic rules because some findings are created or mutated during cross-heuristic processing (e.g., `cross-wasabi-reuse-paradox`, post-mix entity escalation).

### Prefix Matching

Dynamic finding IDs (e.g., `h7-op-return-0`, `h7-op-return-1`) fall back to prefix matching: strip trailing `-\d+` and look up the base ID.

## Classification Catalog

### TX-Level Heuristics

| Finding ID(s) | Adversary | Temporality | Rationale |
|---|---|---|---|
| `coinbase-transaction` | passive | historical | Block reward, protocol-defined |
| `h1-round-amount`, `h1-round-usd-amount`, `h1-round-eur-amount` | passive, kyc | historical | Round amounts visible to all; KYC exchanges correlate with withdrawal amounts |
| `h2-change-detected`, `h2-self-send` | passive, kyc | historical | Change identification enables fund tracing |
| `h2-same-address-io` | passive, kyc, state | historical | Deterministic leak, any adversary exploits this |
| `h2-sweep`, `h2-data-payment`, `h2-wallet-hop` | passive | historical | Structural patterns, low severity |
| `h3-cioh` | passive, kyc, state | historical | Core clustering heuristic used by all adversary tiers |
| `h3-single-input` | passive | historical | Informational (positive) |
| `h4-whirlpool`, `h4-coinjoin`, `h4-joinmarket`, `h4-stonewall`, `h4-simplified-stonewall` | passive | historical | CoinJoin detection (positive findings) |
| `h4-exchange-flagging` | kyc | historical | Only exchanges enforce CoinJoin policies |
| `h5-entropy`, `h5-low-entropy`, `h5-zero-entropy`, `h5-zero-entropy-sweep` | passive | historical | Entropy measurement visible to any chain observer |
| `h6-round-fee-rate`, `h6-rbf-signaled`, `h6-fee-segwit-miscalc` | passive | ongoing_pattern | Behavioral fingerprint, changeable by switching wallet or settings |
| `h6-cpfp-detected`, `h6-fee-in-amount` | passive | historical | One-time structural observation |
| `h7-op-return` (prefix) | passive, kyc | historical | Metadata permanently embedded in blockchain |
| `h11-wallet-fingerprint`, `h11-legacy-version`, `h11-no-locktime`, `h11-mixed-sequence` | passive | ongoing_pattern | Wallet software is changeable |
| `h17-multisig-info`, `h17-escrow-*`, `h17-bisq*`, `h17-hodlhodl` | passive | historical | Structural detection |
| `lightning-channel-legacy` | passive | historical | Legacy LN channel open |
| `anon-set-strong`, `anon-set-moderate`, `anon-set-none` | passive | historical | Anonymity set measurement |
| `timing-unconfirmed` | passive, kyc | historical | Mempool timing correlation |
| `timing-locktime-timestamp`, `timing-stale-locktime` | passive | historical | Locktime fingerprint |
| `script-uniform`, `script-mixed`, `script-multisig` | passive | historical | Script type analysis |
| `dust-attack` | passive, state | historical | Active tracking requires state-level resources |
| `dust-outputs` | passive | historical | Non-attack dust, structural observation |
| `peel-chain` | passive, kyc, state | historical | Trivially traceable spending chain |
| `consolidation-fan-in`, `consolidation-fan-out`, `consolidation-cross-type`, `consolidation-ratio-anomaly` | passive, kyc | historical | Permanent cluster merge |
| `unnecessary-input` | passive | historical | UTXO set composition leak |
| `tx0-premix` | passive | historical | Whirlpool premix identification |
| `bip69-detected` | passive | ongoing_pattern | Deterministic ordering, wallet-specific |
| `bip47-notification` | passive | historical | BIP47 notification transaction |
| `exchange-withdrawal-pattern` | kyc, state | historical | Only meaningful with identity data |
| `h-coin-selection-bnb`, `h-coin-selection-value-asc`, `h-coin-selection-value-desc` | passive | ongoing_pattern | Coin selection algorithm fingerprint |
| `witness-mixed-types`, `witness-deep-stack`, `witness-mixed-depths`, `witness-mixed-sig-types` | passive | ongoing_pattern | Witness pattern fingerprint |
| `witness-uniform-size` | passive | ongoing_pattern | Positive finding (uniform) |
| `post-mix-consolidation` | passive, kyc, state | historical | Undoes CoinJoin gains |
| `entity-ofac-match` | kyc, state | historical | Sanctions enforcement |
| `entity-known-input`, `entity-known-output` | kyc, state | historical | Entity linkage |
| `entity-behavior-exchange` | kyc, state | historical | Behavioral exchange detection |
| `entity-behavior-darknet` | passive, state | historical | Darknet patterns visible on-chain |
| `entity-behavior-gambling` | kyc | historical | Gambling pattern detection |
| `ricochet-hop0` | passive, kyc | historical | Ricochet structural analysis |
| `recurring-payment-pattern` | kyc, state | ongoing_pattern | Repeated amount/timing pattern |

### Address-Level Heuristics

| Finding ID(s) | Adversary | Temporality | Rationale |
|---|---|---|---|
| `h8-address-reuse` | passive, kyc, state | ongoing_pattern | Stop reusing = stop bleeding |
| `h8-no-reuse`, `h8-reuse-uncertain`, `h8-batch-receive` | passive | ongoing_pattern | Informational |
| `h9-dust-detected` | passive, state | active_risk | Unspent dust UTXOs, actionable now |
| `h9-many-utxos` | passive, state | active_risk | UTXO set fragmentation risk (state-level tracking for large sets) |
| `h9-moderate-utxos` | passive | active_risk | Moderate UTXO count, visible to any observer |
| `h9-clean` | passive | ongoing_pattern | Positive finding (clean set) |
| `h10-p2tr`, `h10-p2wpkh`, `h10-p2wsh`, `h10-p2sh`, `h10-p2pkh` | passive | ongoing_pattern | Address type migration possible |
| `spending-high-volume` | kyc, state | ongoing_pattern | High volume behavioral pattern |
| `spending-many-counterparties` | passive, kyc | ongoing_pattern | Counterparty diversity pattern |
| `spending-never-spent` | passive | active_risk | HODLer pattern (informational) |
| `high-activity-exchange`, `high-activity-service` | kyc, state | ongoing_pattern | Activity pattern analysis (institutional-level volume) |
| `high-activity-moderate` | passive, kyc | ongoing_pattern | Moderate activity visible to any observer |
| `address-entity-identified` | kyc, state | active_risk | Live entity association |

### Chain Analysis

| Finding ID(s) | Adversary | Temporality | Rationale |
|---|---|---|---|
| `chain-coinjoin-input`, `chain-coinjoin-ancestry`, `chain-coinjoin-descendancy` | passive | historical | Positive CoinJoin ancestry |
| `chain-exchange-input` | kyc, state | historical | Exchange provenance |
| `chain-dust-input` | passive, state | historical | Dust spent (linkage occurred) |
| `chain-post-coinjoin-consolidation` | passive, kyc, state | historical | Post-CoinJoin damage |
| `chain-forward-peel` | passive, kyc, state | historical | Forward peel chain |
| `chain-toxic-merge` | passive, kyc, state | historical | Toxic change merged |
| `chain-entity-proximity-backward`, `chain-entity-proximity-forward` | kyc, state | historical | Entity in graph |
| `chain-taint-backward` | kyc, state | historical | Taint propagation |
| `chain-cluster-size` | passive, kyc, state | historical | Cluster size measurement |
| `chain-near-exact-spend` | passive | historical | Near-exact spend pattern |
| `chain-ricochet` | passive | historical | Ricochet detection (positive) |
| `chain-sweep-chain` | passive | historical | Sweep chain pattern |
| `chain-post-cj-partial-spend` | passive, kyc | historical | Post-CoinJoin partial spend |
| `chain-post-mix-consolidation` | passive, kyc, state | historical | Post-mix consolidation |
| `chain-kyc-consolidation-before-cj` | passive | historical | Positive pattern |
| `chain-trace-summary` | passive | historical | Trace overview (informational) |
| `chain-trace-partial` | passive | historical | Incomplete trace (data quality) |
| `utxo-age-spread` | passive, kyc | historical | Co-spent UTXOs with large age spread |
| `linkability-deterministic`, `linkability-equal-subset` | passive | historical | Linkability analysis |

### Temporal & Prospective Analysis

| Finding ID(s) | Adversary | Temporality | Rationale |
|---|---|---|---|
| `temporal-burst-high`, `temporal-burst-moderate` | passive, kyc | ongoing_pattern | Transaction timing pattern |
| `temporal-regular-pattern` | passive, kyc | ongoing_pattern | Regular interval detection |
| `prospective-wallet-migration` | passive, kyc | ongoing_pattern | Wallet migration detected |
| `prospective-mixed-fingerprints`, `prospective-fingerprint-change`, `prospective-script-diversity` | passive | ongoing_pattern | Fingerprint evolution |

### Cross-Heuristic & Infrastructure

| Finding ID(s) | Adversary | Temporality | Rationale |
|---|---|---|---|
| `cross-wasabi-reuse-paradox` | passive, kyc | ongoing_pattern | Contradictory wallet signals |
| `compound-deterministic-cap` | passive, kyc, state | historical | Score cap trigger |
| `api-incomplete-prevout` | passive | historical | Data quality |
| `partial-history-unavailable`, `partial-history-partial` | passive | historical | Data quality |
| `behavioral-fingerprint-rollup` | passive | ongoing_pattern | Compound behavioral fingerprint (2+ sub-signals) |

## UI Rendering

### Pro Mode Badges (FindingCard)

Two new pill badges in the finding card header, visible only in pro mode (following the existing confidence badge pattern):

**Adversary badge** - Shows the highest adversary tier:
- `passive_observer` -> "Public" (muted gray pill)
- `kyc_exchange` -> "KYC" (amber pill)
- `state_adversary` -> "State" (red pill)
- Wrapped in Tooltip with explanatory text

**Temporality badge:**
- `historical` -> "Past" (blue/muted pill)
- `ongoing_pattern` -> "Pattern" (amber pill)
- `active_risk` -> "Active" (red pill)
- Wrapped in Tooltip with explanatory text

### Pro Mode Filters (FindingsSection)

Toggle chip bar below findings heading (pro mode only):
- Adversary: Public / KYC / State - all on by default
- Temporality: Past / Pattern / Active - all on by default

Filters are visual only. Score includes all findings regardless of filter state. A note clarifies this to the user.

## Dependency Graph Concepts

The registry creates the foundation for formalizing finding relationships. Currently `cross-heuristic.ts` uses procedural if-then rules for finding suppression. Many of these encode implicit specialization/generalization edges:

| Relationship | Current Implementation | Declarative Equivalent |
|---|---|---|
| CONSOLIDATION is a specific case of CIOH | `applyConsolidationDedup()` suppresses unnecessary-input when CIOH fires | `consolidation-fan-in` specializes `h3-cioh` |
| Self-send has zero entropy by definition | `applyConsolidationDedup()` suppresses zero-entropy for self-sends | `h2-self-send` implies `h5-zero-entropy` |
| CoinJoin invalidates CIOH | `applyCoinJoinSuppressions()` suppresses h3-cioh | `h4-coinjoin` generalizes `h3-cioh` (in CoinJoin context) |

Complex compound rules (RBF x Change, post-mix entity escalation, wallet paradox) remain procedural - they encode domain expertise that simple edges can't express. A future phase may introduce a declarative edge system for the simple cases while preserving procedural code for compound rules.

## Anti-Regression Rules

1. **Badges in both modes.** Adversary and temporality badges and the expanded TierContext render in both Normie and Cypherpunk modes - this information is useful for all users. Only the filter bar is Cypherpunk-only.
2. **Score invariant.** Filters never change the displayed score. Visual-only filtering.
3. **Unclassified passthrough.** Findings without metadata are always shown (no silent hiding).
4. **Registry is exhaustive.** Every finding ID produced by the engine must have a registry entry. A completeness test enforces this.
5. **No heuristic file changes.** Classifications live in the registry. Heuristics create findings as before.
6. **Dynamic override protocol.** If a heuristic needs dynamic temporality (e.g., based on UTXO spent/unspent status), it sets the field directly on the finding object. The enrichment step skips findings that already have both fields set.

## Key Files

| File | Role |
|---|---|
| `src/lib/types.ts` | AdversaryTier, TemporalityClass types; Finding interface extension |
| `src/lib/analysis/finding-metadata.ts` | Centralized registry + enrichment function |
| `src/lib/analysis/orchestrator.ts` | Enrichment call after cross-heuristic rules |
| `src/hooks/useChainTrace.ts` | Enrichment call for chain findings |
| `src/components/FindingCard.tsx` | Badge rendering (pro mode) |
| `src/components/results/FindingsSection.tsx` | Filter controls (pro mode) |
| `docs/privacy-engine.md` | Per-heuristic metadata boxes |
