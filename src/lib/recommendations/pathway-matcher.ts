import type { Finding } from "@/lib/types";

export interface RelevantPathway {
  id: string;
  /** Finding IDs this pathway addresses */
  addressesFindings: string[];
  /** How many of the user's findings this pathway helps with */
  relevanceScore: number;
}

/**
 * Maps finding IDs to pathway IDs that address them.
 * Based on the research-privacy-pathways.md heuristic-to-technique matrix.
 */
const FINDING_TO_PATHWAYS: Record<string, string[]> = {
  // Change detection -> PayJoin, BnB, exact amount spending
  "h2-change-detected": ["payjoin-v2", "bnb-coin-selection", "lightning"],
  // Round amounts -> BnB, exact amount spending
  "h1-round-amount": ["bnb-coin-selection", "payjoin-v2"],
  "h1-round-usd-amount": ["bnb-coin-selection"],
  "h1-round-eur-amount": ["bnb-coin-selection"],
  // CIOH / consolidation -> Coin control, PayJoin
  "h3-cioh": ["coin-control", "payjoin-v2"],
  "consolidation-fan-in": ["coin-control"],
  "unnecessary-input": ["coin-control", "bnb-coin-selection"],
  // Address reuse -> Silent Payments, HD wallet
  "h8-address-reuse": ["silent-payments"],
  // Wallet fingerprint -> wallet switching
  "h11-wallet-fingerprint": ["lightning", "liquid"],
  // Post-mix consolidation -> CoinJoin -> LN pipeline
  "post-mix-consolidation": ["coinjoin-ln", "lightning"],
  "chain-post-coinjoin-consolidation": ["coinjoin-ln", "lightning"],
  "chain-post-coinjoin-direct-spend": ["coinjoin-ln"],
  // Entity outputs -> intermediate hops, P2P
  "entity-known-output": ["coinjoin-p2p", "lightning", "monero"],
  "entity-known-input": ["coinjoin-p2p", "lightning"],
  // Exchange withdrawal -> CoinJoin -> LN pipeline
  "exchange-withdrawal-pattern": ["exchange-coinjoin-ln", "coinjoin-ln"],
  // Peel chain -> Lightning, Liquid (move off-chain)
  "peel-chain": ["lightning", "liquid"],
  // Script mixing -> wallet consistency
  "script-mixed": ["coin-control"],
  // Low entropy -> PayJoin, CoinJoin pipeline
  "h5-low-entropy": ["payjoin-v2", "coinjoin-ln"],
  "h5-zero-entropy": ["payjoin-v2", "coinjoin-ln"],
  // Lightning channel detection -> Taproot channels
  "lightning-channel-legacy": ["lightning"],
};

/** All pathway IDs that can be recommended */
const ALL_PATHWAY_IDS = new Set([
  "payjoin-v2",
  "silent-payments",
  "coin-control",
  "bnb-coin-selection",
  "lightning",
  "monero",
  "liquid",
  "coinjoin-ln",
  "coinjoin-p2p",
  "exchange-coinjoin-ln",
]);

/**
 * Match findings to relevant privacy pathways, sorted by relevance.
 * Returns pathways that address the user's specific findings first,
 * followed by all other pathways.
 */
export function matchPathways(
  findings: Finding[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _grade: string,
): { matched: RelevantPathway[]; unmatched: string[] } {
  const findingIds = new Set(findings.map((f) => f.id));
  const pathwayScores = new Map<string, { score: number; findings: string[] }>();

  // Score each pathway by how many of the user's findings it addresses
  for (const findingId of findingIds) {
    const pathways = FINDING_TO_PATHWAYS[findingId];
    if (!pathways) continue;

    for (const pathwayId of pathways) {
      const existing = pathwayScores.get(pathwayId) ?? { score: 0, findings: [] };
      existing.score += 1;
      existing.findings.push(findingId);
      pathwayScores.set(pathwayId, existing);
    }
  }

  // Build matched array sorted by relevance (highest score first)
  const matched: RelevantPathway[] = [];
  for (const [id, data] of pathwayScores) {
    matched.push({
      id,
      addressesFindings: data.findings,
      relevanceScore: data.score,
    });
  }
  matched.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Unmatched = all pathways not triggered by any finding
  const matchedIds = new Set(matched.map((m) => m.id));
  const unmatched = [...ALL_PATHWAY_IDS].filter((id) => !matchedIds.has(id));

  return { matched, unmatched };
}
