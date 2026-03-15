import type { Finding, ScoringResult } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";
import { TX_HEURISTICS } from "./orchestrator";
import { applyCrossHeuristicRules, classifyTransactionType } from "./cross-heuristic";
import { calculateScore } from "@/lib/scoring/score";

/**
 * Run all transaction heuristics synchronously (no tick delays) for instant results.
 *
 * This is used by GraphExplorer and GraphNodeAnalysis where we want immediate
 * scoring without the 50ms inter-heuristic delay used in the main analysis flow.
 */
export function analyzeTransactionSync(tx: MempoolTransaction): ScoringResult {
  const allFindings: Finding[] = [];
  for (const h of TX_HEURISTICS) {
    try {
      allFindings.push(...h.fn(tx).findings);
    } catch {
      // Skip failing heuristics
    }
  }
  applyCrossHeuristicRules(allFindings);
  const result = calculateScore(allFindings);
  result.txType = classifyTransactionType(allFindings);
  return result;
}
