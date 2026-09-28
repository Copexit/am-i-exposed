/** Boltzmann link-probability lookup for the transaction stage. */

import type { MempoolTransaction } from "@/lib/api/types";

export interface BoltzmannLookup {
  getProb: (displayInIdx: number, displayOutIdx: number) => number;
  timedOut: boolean;
}

interface BoltzmannInput {
  matLnkProbabilities: number[][];
  timedOut: boolean;
}

/** Build a lookup for Boltzmann link probabilities. */
export function buildBoltzmannLookup(
  boltzmannResult: BoltzmannInput | null | undefined,
  linkabilityMode: boolean,
  _tx?: MempoolTransaction,
): BoltzmannLookup | null {
  if (!boltzmannResult || !linkabilityMode) return null;
  // Matrices are indexed by raw tx position (rows = vout, columns = vin);
  // see expandMatrixToTx in boltzmann-detection.
  const mat = boltzmannResult.matLnkProbabilities;
  return {
    getProb: (displayInIdx: number, displayOutIdx: number): number => mat[displayOutIdx]?.[displayInIdx] ?? 0,
    timedOut: boltzmannResult.timedOut,
  };
}
