import type { Finding } from "@/lib/types";
import type {
  MempoolTransaction,
  MempoolAddress,
  MempoolUtxo,
} from "@/lib/api/types";
import {
  analyzeRoundAmounts,
  analyzeChangeDetection,
  analyzeCioh,
  analyzeCoinJoin,
  analyzeEntropy,
  analyzeFees,
  analyzeOpReturn,
  analyzeAddressReuse,
  analyzeUtxos,
  analyzeAddressType,
  analyzeWalletFingerprint,
  analyzeAnonymitySet,
  analyzePayJoin,
  analyzeTiming,
  analyzeScriptTypeMix,
  analyzeSpendingPattern,
  analyzeDustOutputs,
} from "./heuristics";
import { calculateScore } from "@/lib/scoring/score";
import type { ScoringResult } from "@/lib/types";

export interface HeuristicStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done";
  impact?: number; // cumulative score impact after this step completes
}

// --- Transaction heuristics ---

const TX_HEURISTICS = [
  { id: "h1", label: "Round amounts", fn: analyzeRoundAmounts },
  { id: "h2", label: "Change detection", fn: analyzeChangeDetection },
  { id: "h3", label: "Common input ownership", fn: analyzeCioh },
  { id: "h4", label: "CoinJoin detection", fn: analyzeCoinJoin },
  { id: "h5", label: "Transaction entropy", fn: analyzeEntropy },
  { id: "h6", label: "Fee fingerprinting", fn: analyzeFees },
  { id: "h7", label: "OP_RETURN metadata", fn: analyzeOpReturn },
  { id: "h11", label: "Wallet fingerprinting", fn: analyzeWalletFingerprint },
  { id: "anon", label: "Anonymity sets", fn: analyzeAnonymitySet },
  { id: "pj", label: "PayJoin detection", fn: analyzePayJoin },
  { id: "timing", label: "Timing analysis", fn: analyzeTiming },
  { id: "script", label: "Script type analysis", fn: analyzeScriptTypeMix },
  { id: "dust", label: "Dust output detection", fn: analyzeDustOutputs },
] as const;

const ADDRESS_HEURISTICS = [
  { id: "h8", label: "Address reuse", fn: analyzeAddressReuse },
  { id: "h9", label: "UTXO analysis", fn: analyzeUtxos },
  { id: "h10", label: "Address type", fn: analyzeAddressType },
  { id: "spending", label: "Spending patterns", fn: analyzeSpendingPattern },
] as const;

export function getTxHeuristicSteps(): HeuristicStep[] {
  return TX_HEURISTICS.map((h) => ({
    id: h.id,
    label: h.label,
    status: "pending" as const,
  }));
}

export function getAddressHeuristicSteps(): HeuristicStep[] {
  return ADDRESS_HEURISTICS.map((h) => ({
    id: h.id,
    label: h.label,
    status: "pending" as const,
  }));
}

/**
 * Run all transaction heuristics and return scored results.
 *
 * The onStep callback is called before each heuristic runs, enabling
 * the diagnostic loader UI to show progress.
 */
export async function analyzeTransaction(
  tx: MempoolTransaction,
  rawHex?: string,
  onStep?: (stepId: string, impact?: number) => void,
): Promise<ScoringResult> {
  const allFindings: Finding[] = [];

  for (const heuristic of TX_HEURISTICS) {
    onStep?.(heuristic.id);

    // Small delay to let the UI update and create the diagnostic effect
    await tick();

    const result = heuristic.fn(tx, rawHex);
    allFindings.push(...result.findings);

    // Report cumulative impact so the UI can show a running score
    const stepImpact = result.findings.reduce((s, f) => s + f.scoreImpact, 0);
    onStep?.(heuristic.id, stepImpact);
  }

  // Cross-heuristic intelligence
  applyCrossHeuristicRules(allFindings);

  return calculateScore(allFindings);
}

/**
 * Run all address heuristics and return scored results.
 */
export async function analyzeAddress(
  address: MempoolAddress,
  utxos: MempoolUtxo[],
  txs: MempoolTransaction[],
  onStep?: (stepId: string, impact?: number) => void,
): Promise<ScoringResult> {
  const allFindings: Finding[] = [];

  for (const heuristic of ADDRESS_HEURISTICS) {
    onStep?.(heuristic.id);
    await tick();

    const result = heuristic.fn(address, utxos, txs);
    allFindings.push(...result.findings);

    const stepImpact = result.findings.reduce((s, f) => s + f.scoreImpact, 0);
    onStep?.(heuristic.id, stepImpact);
  }

  return calculateScore(allFindings);
}

/**
 * Cross-heuristic intelligence: adjust findings based on interactions
 * between different heuristics. This runs after all heuristics complete.
 */
function applyCrossHeuristicRules(findings: Finding[]): void {
  const isCoinJoin = findings.some(
    (f) =>
      (f.id === "h4-whirlpool" || f.id === "h4-coinjoin") &&
      f.scoreImpact > 0,
  );

  const isPayJoin = findings.some((f) => f.id === "payjoin-detected");

  if (isCoinJoin) {
    for (const f of findings) {
      // CIOH is expected in CoinJoin (each input = different participant)
      if (f.id === "h3-cioh") {
        f.severity = "low";
        f.title = `${f.title} (CoinJoin - expected)`;
        f.description =
          "Multiple input addresses are linked, but this is expected in a CoinJoin transaction. " +
          "In CoinJoins, each input typically belongs to a different participant, so CIOH does not apply.";
        f.scoreImpact = 0;
      }
      // Round amounts in CoinJoin are the denomination, not a privacy leak
      if (f.id === "h1-round-amount") {
        f.severity = "low";
        f.title = `${f.title} (CoinJoin denomination)`;
        f.description =
          "Equal round outputs are expected in CoinJoin transactions - they are the denomination, not a privacy leak.";
        f.scoreImpact = 0;
      }
      // Change detection in CoinJoin is less reliable
      if (f.id === "h2-change-detected") {
        f.severity = "low";
        f.title = `${f.title} (CoinJoin - unreliable)`;
        f.scoreImpact = 0;
      }
    }
  }

  if (isPayJoin) {
    // PayJoin deliberately breaks CIOH, so suppress the penalty
    for (const f of findings) {
      if (f.id === "h3-cioh") {
        f.severity = "low";
        f.title = `${f.title} (PayJoin - deliberate)`;
        f.description =
          "Multiple input addresses are linked, but this is expected in a PayJoin transaction. " +
          "PayJoin deliberately has the receiver contribute an input to break chain analysis.";
        f.scoreImpact = 0;
      }
    }
  }
}

/** Yield to the event loop so the UI can update. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}
