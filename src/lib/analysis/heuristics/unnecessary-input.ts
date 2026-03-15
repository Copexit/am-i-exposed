import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { isCoinbase, getAddressedOutputs } from "./tx-utils";

/**
 * Unnecessary Input Heuristic
 *
 * Detects when more inputs were used than strictly necessary to cover
 * the payment amount + fee. This reveals poor coin selection or
 * intentional consolidation disguised as a payment.
 *
 * Algorithm (for 2-output transactions):
 * 1. Try each output as the "change" output
 * 2. For each interpretation, compute the min inputs to cover the other output + fee
 * 3. Take the most conservative (highest) min-inputs across interpretations
 * 4. If actual inputs exceed that conservative minimum, flag the excess
 *
 * Using both interpretations avoids false positives when we can't tell
 * which output is the payment vs. change.
 *
 * Excess inputs strengthen CIOH assumptions by unnecessarily linking
 * addresses that didn't need to participate in the transaction.
 *
 * Impact: -2 to -8 depending on excess count
 */
export const analyzeUnnecessaryInput: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // Need at least 2 inputs for this heuristic to be meaningful
  if (tx.vin.length < 2) return { findings };

  // Skip coinbase
  if (isCoinbase(tx)) return { findings };

  // Collect input values
  const inputValues: number[] = [];
  for (const vin of tx.vin) {
    const val = vin.prevout?.value;
    if (val === undefined || val === null) return { findings }; // Can't evaluate without full prevout data
    inputValues.push(val);
  }

  // Only analyze 2-output transactions (standard payment + change).
  // For 1-output (sweep/consolidation) or 3+ outputs (batched sends),
  // the concept of "unnecessary" inputs is ambiguous.
  const spendableOutputs = getAddressedOutputs(tx.vout);
  if (spendableOutputs.length !== 2) return { findings };

  // Sort inputs descending for greedy covering
  const sortedValues = [...inputValues].sort((a, b) => b - a);

  // Try both interpretations: each output as the payment target.
  // Take the most conservative result (higher min-inputs = fewer false positives).
  const v0 = spendableOutputs[0].value;
  const v1 = spendableOutputs[1].value;
  const min0 = greedyCover(v1 + tx.fee, sortedValues); // v0 is change, v1 is payment
  const min1 = greedyCover(v0 + tx.fee, sortedValues); // v1 is change, v0 is payment
  const minInputsNeeded = Math.max(min0, min1);

  const excessInputs = tx.vin.length - minInputsNeeded;
  if (excessInputs <= 0) return { findings };

  // Scale severity with excess count
  const severity =
    excessInputs >= 5 ? "high" as const :
    excessInputs >= 2 ? "medium" as const : "low" as const;
  const impact = Math.min(excessInputs * 2, 8);

  findings.push({
    id: "unnecessary-input",
    severity,
    confidence: "medium",
    title: `${excessInputs} unnecessary input${excessInputs > 1 ? "s" : ""} used`,
    params: {
      excessInputs,
      totalInputs: tx.vin.length,
      minInputsNeeded,
    },
    description:
      `This transaction used ${tx.vin.length} inputs, but only ${minInputsNeeded} were needed ` +
      `to cover the outputs and fee. The ${excessInputs} extra input${excessInputs > 1 ? "s" : ""} ` +
      "unnecessarily link additional addresses together via CIOH, " +
      "suggesting poor coin selection or intentional consolidation.",
    recommendation:
      "Use a wallet with coin control to select only the minimum UTXOs needed. " +
      "Avoid auto-selection modes that sweep all available UTXOs into every transaction.",
    scoreImpact: -impact,
  });

  return { findings };
};

/** Greedily find the minimum number of sorted-desc inputs to cover a target. */
function greedyCover(target: number, sortedDesc: number[]): number {
  let running = 0;
  let count = 0;
  for (const val of sortedDesc) {
    running += val;
    count++;
    if (running >= target) return count;
  }
  return sortedDesc.length; // can't fully cover
}
