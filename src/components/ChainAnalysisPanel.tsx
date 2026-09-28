import type { FindingId } from "@/lib/analysis/finding-metadata";

/** Chain analysis finding IDs (backward/forward tracing, structure, spending patterns): shown with a "Chain" label. */
export const CHAIN_FINDING_IDS: ReadonlySet<string> = new Set<FindingId>([
  // Input provenance (backward analysis)
  "chain-coinjoin-input",
  "chain-exchange-input",
  "chain-dust-input",
  "chain-entity-proximity-backward",
  "chain-coinjoin-ancestry",
  "chain-taint-backward",
  // Output destinations (forward analysis)
  "chain-post-coinjoin-consolidation",
  "chain-forward-peel",
  "chain-toxic-merge",
  "chain-entity-proximity-forward",
  "chain-coinjoin-descendancy",
  // Structural analysis
  "linkability-deterministic",
  "linkability-equal-subset",
  "chain-cluster-size",
  // Spending patterns
  "chain-near-exact-spend",
  "chain-ricochet",
  "chain-sweep-chain",
  "chain-post-cj-partial-spend",
  "chain-post-mix-consolidation",
  "chain-kyc-consolidation-before-cj",
]);
