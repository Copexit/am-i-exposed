import type { Finding, Grade, TxType } from "@/lib/types";
import { isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import {
  checkEntityOrigin,
  checkDeterministicFailures,
  checkCriticalFindings,
  checkStructuralIssues,
  checkModerateFindings,
  checkPositiveFindings,
  type TierContext,
} from "./recommendation-tiers";

export interface PrimaryRec {
  id: string;
  urgency: "immediate" | "soon" | "when-convenient";
  headlineKey: string;
  headlineDefault: string;
  detailKey: string;
  detailDefault: string;
  tool?: { name: string; url: string };
  tools?: { name: string; url: string }[];
  guideLink?: string;
  /** Interpolation values passed to react-i18next t() for headline and detail. */
  tParams?: Record<string, string | number>;
}

export interface RecommendationContext {
  findings: Finding[];
  grade: Grade;
  txType?: TxType;
  walletGuess: string | null;
  /** Entity name if this tx originates from a known entity (exchange withdrawal, etc.) */
  entityOrigin?: string | null;
  /** Entity category (exchange, darknet, mixer, etc.) */
  entityCategory?: string | null;
}

/**
 * Deterministic cascade: walks tiers top-to-bottom, returns first match.
 * Mirrors chain analysis damage hierarchy (see docs/adr-recommendations.md).
 */
export function selectRecommendations(
  ctx: RecommendationContext,
): [PrimaryRec, PrimaryRec | null] {
  const ids = new Set(ctx.findings.map((f: Finding) => f.id));
  const hasCoinJoin = ctx.findings.some(isCoinJoinFinding);
  const tc: TierContext = { ctx, ids, hasCoinJoin };

  // Entity-origin bypass (pre-tier)
  const entityResult = checkEntityOrigin(tc);
  if (entityResult) return entityResult;

  // Tier 0: Deterministic failures
  const tier0 = checkDeterministicFailures(tc);
  if (tier0) return tier0;

  // Tier 1: Critical findings
  const tier1 = checkCriticalFindings(tc);
  if (tier1) return tier1;

  // Tier 2: Structural issues
  const tier2 = checkStructuralIssues(tc);
  if (tier2) return tier2;

  // Tier 3: Moderate findings
  const tier3 = checkModerateFindings(tc);
  if (tier3) return tier3;

  // Tier 4: Positive / low-impact
  const tier4 = checkPositiveFindings(tc);
  if (tier4) return tier4;

  // Fallback
  return [
    {
      id: "rec-fallback",
      urgency: "when-convenient",
      headlineKey: "primaryRec.fallback.headline",
      headlineDefault: "Review the findings above for specific improvements",
      detailKey: "primaryRec.fallback.detail",
      detailDefault: "Check each finding for targeted recommendations.",
      guideLink: "/guide",
    },
    null,
  ];
}
