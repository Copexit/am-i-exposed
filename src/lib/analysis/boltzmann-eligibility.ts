/**
 * Shared Boltzmann eligibility checks.
 *
 * Both useBoltzmann (single-tx) and useGraphBoltzmann (graph explorer) need to
 * determine whether a transaction can be analysed via the Boltzmann WASM engine.
 * This module centralises that logic so the two hooks stay in sync.
 */

import type { MempoolTransaction } from "@/lib/api/types";
import {
  MAX_SUPPORTED_TOTAL,
  MAX_SUPPORTED_TOTAL_WABISABI,
  detectWabiSabiForTurbo,
} from "./boltzmann-pool";
import { extractTxValues } from "./boltzmann-pool";

export { extractTxValues };

export interface BoltzmannEligibility {
  /** Whether the transaction can be computed at all. */
  canCompute: boolean;
  /** Human-readable reason when `canCompute` is false. */
  reason?: string;
  /** Extracted input values (only populated when canCompute is true). */
  inputValues: number[];
  /** Extracted output values (only populated when canCompute is true). */
  outputValues: number[];
  /** Effective max total (accounts for WabiSabi). */
  maxTotal: number;
}

/**
 * Determine whether a transaction is eligible for Boltzmann analysis.
 *
 * Checks performed (in order):
 *  1. Coinbase transactions are ineligible.
 *  2. Transactions with 0 inputs or 0 outputs (after filtering) are ineligible.
 *  3. Transactions exceeding the size limit are ineligible (WabiSabi gets a
 *     higher limit via tier-decomposed mode).
 *
 * @param tx          The mempool transaction to evaluate.
 * @param maxTotalOverride  Override the default size limit (used by graph
 *                    explorer which applies its own smaller cap).
 */
export function getBoltzmannEligibility(
  tx: MempoolTransaction,
  maxTotalOverride?: number,
): BoltzmannEligibility {
  const empty: Pick<BoltzmannEligibility, "inputValues" | "outputValues"> = {
    inputValues: [],
    outputValues: [],
  };

  // 1. Coinbase check
  const isCoinbase = tx.vin.some((v) => v.is_coinbase);
  if (isCoinbase) {
    return { canCompute: false, reason: "coinbase", maxTotal: 0, ...empty };
  }

  // 2. Extract values and check for empty sets
  const { inputValues, outputValues } = extractTxValues(tx);
  if (inputValues.length === 0 || outputValues.length === 0) {
    return { canCompute: false, reason: "empty", maxTotal: 0, inputValues, outputValues };
  }

  // 3. Size limit (WabiSabi gets the higher tier-decomposed limit)
  const isWabiSabi = detectWabiSabiForTurbo(inputValues, outputValues);
  const maxTotal = maxTotalOverride ?? (isWabiSabi ? MAX_SUPPORTED_TOTAL_WABISABI : MAX_SUPPORTED_TOTAL);
  const total = inputValues.length + outputValues.length;

  if (total > maxTotal) {
    return { canCompute: false, reason: "too-large", maxTotal, inputValues, outputValues };
  }

  return { canCompute: true, maxTotal, inputValues, outputValues };
}
