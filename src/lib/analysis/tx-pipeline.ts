import type { Finding, ScoringResult } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";
import type { TxContext } from "./heuristics/types";
import { calculateScore } from "@/lib/scoring/score";
import { applyCrossHeuristicRules, classifyTransactionType } from "./cross-heuristic";
import { enrichFindingsWithMetadata } from "./finding-metadata";
import { TX_HEURISTICS } from "./heuristic-registry";

/**
 * Run every tx heuristic once. This is the single heuristic loop shared by all
 * views (main scan, graph, address per-tx list, CLI). A failing heuristic is
 * logged and skipped so it cannot crash the analysis.
 * Returns raw findings: pass them (plus any chain findings) to finalizeTxResult.
 */
export function runTxHeuristics(
  tx: MempoolTransaction,
  rawHex?: string,
  ctx?: TxContext,
  onEach?: (heuristicId: string, findings: Finding[]) => void,
): Finding[] {
  const allFindings: Finding[] = [];
  for (const heuristic of TX_HEURISTICS) {
    let findings: Finding[] = [];
    try {
      findings = heuristic.fn(tx, rawHex, ctx).findings;
    } catch (err) {
      console.error(`[runTxHeuristics] ${heuristic.id} failed:`, err);
    }
    allFindings.push(...findings);
    onEach?.(heuristic.id, findings);
  }
  return allFindings;
}

/**
 * Turn raw findings into the final result: cross-heuristic rules, metadata
 * enrichment, score, tx type, severity sort. Mutates `findings`, so call it
 * exactly once per analysis, after every finding (heuristic, chain, entropy
 * enhancement, warnings) has been collected.
 */
export function finalizeTxResult(findings: Finding[]): ScoringResult {
  applyCrossHeuristicRules(findings);
  enrichFindingsWithMetadata(findings);
  const result = calculateScore(findings);
  result.txType = classifyTransactionType(findings);
  return result;
}
