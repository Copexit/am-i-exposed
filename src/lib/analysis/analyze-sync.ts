import type { ScoringResult } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";
import { runTxHeuristics, finalizeTxResult } from "./tx-pipeline";

/**
 * Run the shared tx pipeline synchronously (no tick delays) for instant results.
 *
 * Used by the graph views. No TxContext or chain data is available here, so
 * the result is a quick score (the UI labels it as such).
 */
export function analyzeTransactionSync(tx: MempoolTransaction): ScoringResult {
  return finalizeTxResult(runTxHeuristics(tx));
}
