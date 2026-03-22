/**
 * Centralized metadata registry for finding adversary relevance and temporality.
 *
 * Maps every known finding ID to its static classification. The orchestrator
 * enriches findings with this metadata after heuristics run, so individual
 * heuristic files don't need modification.
 *
 * See docs/adr-finding-tiers.md for the design rationale and full catalog.
 */
import type { Finding, AdversaryTier, TemporalityClass } from "@/lib/types";

export interface FindingMeta {
  adversaryTiers: AdversaryTier[];
  temporality: TemporalityClass;
}

// Shorthand aliases to keep the registry compact
const P: AdversaryTier = "passive_observer";
const K: AdversaryTier = "kyc_exchange";
const S: AdversaryTier = "state_adversary";

/**
 * Static metadata for all known finding IDs.
 *
 * Organized by source heuristic/module. Each entry maps a finding ID to its
 * adversary tiers (who can exploit it) and temporality (whether it's fixable).
 */
export const FINDING_METADATA: Record<string, FindingMeta> = {
  // ── H1: Round Amount Detection ──────────────────────────────────────
  "h1-round-amount":     { adversaryTiers: [P, K], temporality: "historical" },
  "h1-all-round":        { adversaryTiers: [P, K], temporality: "historical" },
  "h1-round-usd-amount": { adversaryTiers: [P, K], temporality: "historical" },
  "h1-round-eur-amount": { adversaryTiers: [P, K], temporality: "historical" },

  // ── H2: Change Detection ────────────────────────────────────────────
  "h2-sweep":            { adversaryTiers: [P],       temporality: "historical" },
  "h2-data-payment":     { adversaryTiers: [P],       temporality: "historical" },
  "h2-wallet-hop":       { adversaryTiers: [P],       temporality: "historical" },
  "h2-change-detected":  { adversaryTiers: [P, K],    temporality: "historical" },
  "h2-same-address-io":  { adversaryTiers: [P, K, S], temporality: "historical" },
  "h2-self-send":        { adversaryTiers: [P, K],    temporality: "historical" },
  "h2-value-disparity":  { adversaryTiers: [P, K],    temporality: "historical" },

  // ── H3: Common Input Ownership Heuristic ────────────────────────────
  "h3-single-input": { adversaryTiers: [P],       temporality: "historical" },
  "h3-cioh":         { adversaryTiers: [P, K, S], temporality: "historical" },

  // ── H4: CoinJoin Detection ──────────────────────────────────────────
  "h4-whirlpool":            { adversaryTiers: [P], temporality: "historical" },
  "h4-coinjoin":             { adversaryTiers: [P], temporality: "historical" },
  "h4-wasabi1":              { adversaryTiers: [P], temporality: "historical" },
  "h4-joinmarket":           { adversaryTiers: [P], temporality: "historical" },
  "h4-stonewall":            { adversaryTiers: [P], temporality: "historical" },
  "h4-simplified-stonewall": { adversaryTiers: [P], temporality: "historical" },
  "h4-exchange-flagging":    { adversaryTiers: [K], temporality: "historical" },

  // ── H5: Entropy Analysis ────────────────────────────────────────────
  "h5-zero-entropy":       { adversaryTiers: [P], temporality: "historical" },
  "h5-zero-entropy-sweep": { adversaryTiers: [P], temporality: "historical" },
  "h5-low-entropy":        { adversaryTiers: [P], temporality: "historical" },
  "h5-entropy":            { adversaryTiers: [P], temporality: "historical" },

  // ── H6: Fee Analysis ────────────────────────────────────────────────
  "h6-round-fee-rate":   { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "h6-rbf-signaled":     { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "h6-fee-segwit-miscalc": { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "h6-fee-in-amount":    { adversaryTiers: [P], temporality: "historical" },
  "h6-cpfp-detected":    { adversaryTiers: [P], temporality: "historical" },

  // ── H7: OP_RETURN Detection (prefix-matched for h7-op-return-N) ────
  "h7-op-return": { adversaryTiers: [P, K], temporality: "historical" },

  // ── H8: Address Reuse ───────────────────────────────────────────────
  "h8-reuse-uncertain": { adversaryTiers: [P],       temporality: "ongoing_pattern" },
  "h8-no-reuse":        { adversaryTiers: [P],       temporality: "ongoing_pattern" },
  "h8-batch-receive":   { adversaryTiers: [P],       temporality: "ongoing_pattern" },
  "h8-address-reuse":   { adversaryTiers: [P, K, S], temporality: "ongoing_pattern" },

  // ── H9: UTXO Analysis ──────────────────────────────────────────────
  "h9-dust-detected":  { adversaryTiers: [P, S], temporality: "active_risk" },
  "h9-many-utxos":     { adversaryTiers: [P, S], temporality: "active_risk" },
  "h9-moderate-utxos": { adversaryTiers: [P],    temporality: "active_risk" },
  "h9-clean":          { adversaryTiers: [P],    temporality: "ongoing_pattern" },

  // ── H10: Address Type ───────────────────────────────────────────────
  "h10-p2tr":   { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "h10-p2wpkh": { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "h10-p2wsh":  { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "h10-p2sh":   { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "h10-p2pkh":  { adversaryTiers: [P], temporality: "ongoing_pattern" },

  // ── H11: Wallet Fingerprint ─────────────────────────────────────────
  "h11-legacy-version":    { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "h11-no-locktime":       { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "h11-mixed-sequence":    { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "h11-wallet-fingerprint": { adversaryTiers: [P], temporality: "ongoing_pattern" },

  // ── H17: Multisig / Escrow Detection ────────────────────────────────
  "h17-bisq-deposit":        { adversaryTiers: [P], temporality: "historical" },
  "h17-hodlhodl":            { adversaryTiers: [P], temporality: "historical" },
  "h17-escrow-2of3":         { adversaryTiers: [P], temporality: "historical" },
  "h17-escrow-2of2":         { adversaryTiers: [P], temporality: "historical" },
  "h17-bisq":                { adversaryTiers: [P], temporality: "historical" },
  "h17-multisig-info":       { adversaryTiers: [P], temporality: "historical" },
  "lightning-channel-legacy": { adversaryTiers: [P], temporality: "historical" },

  // ── Anonymity Set ───────────────────────────────────────────────────
  "anon-set-strong":   { adversaryTiers: [P], temporality: "historical" },
  "anon-set-moderate": { adversaryTiers: [P], temporality: "historical" },
  "anon-set-none":     { adversaryTiers: [P], temporality: "historical" },

  // ── Timing Analysis ─────────────────────────────────────────────────
  "timing-unconfirmed":        { adversaryTiers: [P, K], temporality: "historical" },
  "timing-locktime-timestamp": { adversaryTiers: [P],    temporality: "historical" },
  "timing-stale-locktime":     { adversaryTiers: [P],    temporality: "historical" },

  // ── Script Type Mix ─────────────────────────────────────────────────
  "script-multisig": { adversaryTiers: [P], temporality: "historical" },
  "script-uniform":  { adversaryTiers: [P], temporality: "historical" },
  "script-mixed":    { adversaryTiers: [P], temporality: "historical" },

  // ── Dust Detection ──────────────────────────────────────────────────
  "dust-attack":   { adversaryTiers: [P, S], temporality: "historical" },
  "dust-outputs":  { adversaryTiers: [P],    temporality: "historical" },
  "dust-spending": { adversaryTiers: [P, K, S], temporality: "historical" },

  // ── Entity Detection ────────────────────────────────────────────────
  "entity-ofac-match":          { adversaryTiers: [K, S], temporality: "historical" },
  "entity-known-input":         { adversaryTiers: [K, S], temporality: "historical" },
  "entity-known-output":        { adversaryTiers: [K, S], temporality: "historical" },
  "entity-behavior-exchange":   { adversaryTiers: [K, S], temporality: "historical" },
  "entity-behavior-darknet":    { adversaryTiers: [P, S], temporality: "historical" },
  "entity-behavior-gambling":   { adversaryTiers: [K],    temporality: "historical" },

  // ── Consolidation ───────────────────────────────────────────────────
  "consolidation-fan-in":        { adversaryTiers: [P, K], temporality: "historical" },
  "consolidation-cross-type":    { adversaryTiers: [P, K], temporality: "historical" },
  "consolidation-fan-out":       { adversaryTiers: [P, K], temporality: "historical" },
  "consolidation-ratio-anomaly": { adversaryTiers: [P],    temporality: "historical" },

  // ── Other TX-Level Heuristics ───────────────────────────────────────
  "coinbase-transaction":       { adversaryTiers: [P],    temporality: "historical" },
  "unnecessary-input":          { adversaryTiers: [P],    temporality: "historical" },
  "tx0-premix":                 { adversaryTiers: [P],    temporality: "historical" },
  "bip69-detected":             { adversaryTiers: [P],    temporality: "ongoing_pattern" },
  "bip47-notification":         { adversaryTiers: [P],    temporality: "historical" },
  "peel-chain":                 { adversaryTiers: [P, K, S], temporality: "historical" },
  "exchange-withdrawal-pattern": { adversaryTiers: [K, S], temporality: "historical" },
  "post-mix-consolidation":     { adversaryTiers: [P, K, S], temporality: "historical" },
  "ricochet-hop0":              { adversaryTiers: [P, K], temporality: "historical" },

  // ── Coin Selection ──────────────────────────────────────────────────
  "h-coin-selection-bnb":       { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "h-coin-selection-value-asc": { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "h-coin-selection-value-desc": { adversaryTiers: [P], temporality: "ongoing_pattern" },

  // ── Witness Analysis ────────────────────────────────────────────────
  "witness-mixed-types":    { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "witness-deep-stack":     { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "witness-mixed-depths":   { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "witness-uniform-size":   { adversaryTiers: [P], temporality: "ongoing_pattern" },
  "witness-mixed-sig-types": { adversaryTiers: [P], temporality: "ongoing_pattern" },

  // ── Address-Level: Spending Patterns ────────────────────────────────
  "spending-high-volume":        { adversaryTiers: [K, S], temporality: "ongoing_pattern" },
  "spending-never-spent":        { adversaryTiers: [P],    temporality: "active_risk" },
  "spending-many-counterparties": { adversaryTiers: [P, K], temporality: "ongoing_pattern" },

  // ── Address-Level: High Activity ────────────────────────────────────
  "high-activity-exchange": { adversaryTiers: [K, S], temporality: "ongoing_pattern" },
  "high-activity-service":  { adversaryTiers: [K, S], temporality: "ongoing_pattern" },
  "high-activity-moderate": { adversaryTiers: [P, K], temporality: "ongoing_pattern" },

  // ── Address-Level: Recurring Payments ───────────────────────────────
  "recurring-payment-pattern": { adversaryTiers: [K, S], temporality: "ongoing_pattern" },

  // ── Orchestrator: Address Entity ────────────────────────────────────
  "address-entity-identified": { adversaryTiers: [K, S], temporality: "active_risk" },

  // ── Orchestrator: Data Quality ──────────────────────────────────────
  "partial-history-unavailable": { adversaryTiers: [P], temporality: "historical" },
  "partial-history-partial":     { adversaryTiers: [P], temporality: "historical" },

  // ── Chain: Backward/Forward Tracing ─────────────────────────────────
  "chain-coinjoin-input":             { adversaryTiers: [P],       temporality: "historical" },
  "chain-exchange-input":             { adversaryTiers: [K, S],    temporality: "historical" },
  "chain-dust-input":                 { adversaryTiers: [P, S],    temporality: "historical" },
  "chain-post-coinjoin-consolidation": { adversaryTiers: [P, K, S], temporality: "historical" },
  "chain-forward-peel":               { adversaryTiers: [P, K, S], temporality: "historical" },
  "chain-toxic-merge":                { adversaryTiers: [P, K, S], temporality: "historical" },

  // ── Chain: Clustering & Spending Patterns ───────────────────────────
  "chain-cluster-size":              { adversaryTiers: [P, K, S], temporality: "historical" },
  "chain-near-exact-spend":          { adversaryTiers: [P],       temporality: "historical" },
  "chain-ricochet":                  { adversaryTiers: [P],       temporality: "historical" },
  "chain-sweep-chain":               { adversaryTiers: [P],       temporality: "historical" },
  "chain-post-cj-partial-spend":     { adversaryTiers: [P, K],    temporality: "historical" },
  "chain-kyc-consolidation-before-cj": { adversaryTiers: [P],     temporality: "historical" },
  "chain-post-mix-consolidation":    { adversaryTiers: [P, K, S], temporality: "historical" },

  // ── Chain: Peel Chain Tracing ───────────────────────────────────────
  "peel-chain-trace":       { adversaryTiers: [P, K, S], temporality: "historical" },
  "peel-chain-trace-short": { adversaryTiers: [P, K],    temporality: "historical" },

  // ── Chain: Linkability ──────────────────────────────────────────────
  "linkability-deterministic": { adversaryTiers: [P],       temporality: "historical" },
  "linkability-ambiguous":     { adversaryTiers: [P],       temporality: "historical" },
  "linkability-equal-subset":  { adversaryTiers: [P],       temporality: "historical" },

  // ── Chain: CoinJoin Quality ─────────────────────────────────────────
  "chain-coinjoin-quality": { adversaryTiers: [P], temporality: "historical" },
  "no-consolidation":       { adversaryTiers: [P], temporality: "historical" },
  "no-mix-origins":         { adversaryTiers: [P], temporality: "historical" },
  "fresh-addresses":        { adversaryTiers: [P], temporality: "historical" },
  "time-elapsed":           { adversaryTiers: [P], temporality: "historical" },
  "small-change":           { adversaryTiers: [P], temporality: "historical" },
  // toxic-merge-N is prefix-matched via "toxic-merge"
  "toxic-merge":            { adversaryTiers: [P, K, S], temporality: "historical" },

  // ── Chain: JoinMarket Analysis ──────────────────────────────────────
  "joinmarket-subset-sum":           { adversaryTiers: [P, S], temporality: "historical" },
  "joinmarket-subset-sum-resistant": { adversaryTiers: [P],    temporality: "historical" },
  "joinmarket-taker-maker":          { adversaryTiers: [P, S], temporality: "historical" },
  "joinmarket-anon-set":             { adversaryTiers: [P],    temporality: "historical" },

  // ── Chain: Taint Flow ───────────────────────────────────────────────
  "chain-taint-backward": { adversaryTiers: [K, S], temporality: "historical" },

  // ── Chain: Entity Proximity ─────────────────────────────────────────
  "chain-coinjoin-ancestry":        { adversaryTiers: [P],    temporality: "historical" },
  "chain-coinjoin-descendancy":     { adversaryTiers: [P],    temporality: "historical" },
  "chain-entity-proximity-backward": { adversaryTiers: [K, S], temporality: "historical" },
  "chain-entity-proximity-forward":  { adversaryTiers: [K, S], temporality: "historical" },

  // ── Chain: Temporal Analysis ────────────────────────────────────────
  "temporal-burst-high":     { adversaryTiers: [P, K], temporality: "ongoing_pattern" },
  "temporal-burst-moderate": { adversaryTiers: [P, K], temporality: "ongoing_pattern" },
  "temporal-regular-pattern": { adversaryTiers: [P, K], temporality: "ongoing_pattern" },

  // ── Chain: Prospective Analysis ─────────────────────────────────────
  "prospective-wallet-migration":   { adversaryTiers: [P, K], temporality: "ongoing_pattern" },
  "prospective-mixed-fingerprints": { adversaryTiers: [P],    temporality: "ongoing_pattern" },
  "prospective-fingerprint-change": { adversaryTiers: [P],    temporality: "ongoing_pattern" },
  "prospective-script-diversity":   { adversaryTiers: [P],    temporality: "ongoing_pattern" },

  // ── Chain: Trace Summary ────────────────────────────────────────────
  "chain-trace-summary": { adversaryTiers: [P], temporality: "historical" },

  // ── UTXO Age Spread ──────────────────────────────────────────────────
  "utxo-age-spread": { adversaryTiers: [P, K], temporality: "historical" },

  // ── Chain: Trace Infrastructure ─────────────────────────────────────
  "chain-trace-partial":               { adversaryTiers: [P], temporality: "historical" },
  "chain-post-coinjoin-direct-spend":  { adversaryTiers: [P, K, S], temporality: "historical" },

  // ── Cross-Heuristic Synthetic Findings ──────────────────────────────
  "cross-wasabi-reuse-paradox":     { adversaryTiers: [P, K], temporality: "ongoing_pattern" },
  "compound-deterministic-cap":     { adversaryTiers: [P, K, S], temporality: "historical" },
  "behavioral-fingerprint-rollup":  { adversaryTiers: [P], temporality: "ongoing_pattern" },

  // ── API / Infrastructure ────────────────────────────────────────────
  "api-incomplete-prevout": { adversaryTiers: [P], temporality: "historical" },
};

/** Look up metadata for a finding ID. Returns undefined for unknown IDs. */
export function getFindingMeta(id: string): FindingMeta | undefined {
  return FINDING_METADATA[id] ?? getFindingMetaByPrefix(id);
}

/**
 * Prefix fallback for dynamic IDs like h7-op-return-0, toxic-merge-1.
 * Strips trailing -N suffix and retries the lookup.
 */
function getFindingMetaByPrefix(id: string): FindingMeta | undefined {
  const match = id.match(/^(.+)-\d+$/);
  if (match) return FINDING_METADATA[match[1]];
  return undefined;
}

/** Return the highest adversary tier from a list of tiers. */
export function highestAdversaryTier(tiers: AdversaryTier[]): AdversaryTier {
  if (tiers.includes("state_adversary")) return "state_adversary";
  if (tiers.includes("kyc_exchange")) return "kyc_exchange";
  return "passive_observer";
}

/**
 * Enrich findings with adversary tier and temporality metadata from the registry.
 * Findings that already have both fields set (dynamic overrides) are skipped.
 */
export function enrichFindingsWithMetadata(findings: Finding[]): void {
  for (const f of findings) {
    if (f.adversaryTiers && f.temporality) continue;

    const meta = getFindingMeta(f.id);
    if (!meta) continue;

    if (!f.adversaryTiers) f.adversaryTiers = meta.adversaryTiers;
    if (!f.temporality) f.temporality = meta.temporality;
  }
}
