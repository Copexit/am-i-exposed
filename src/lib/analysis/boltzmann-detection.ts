/**
 * Pure detection helpers for Boltzmann analysis.
 *
 * CoinJoin structure detection (intrafees, JoinMarket, WabiSabi),
 * auto-compute eligibility, and transaction value extraction.
 * No worker or browser dependencies - safe to use in tests and SSR.
 */

import { countOutputValues, getValuedOutputs } from "./heuristics/tx-utils";

/** Auto-compute when total UTXOs (inputs + outputs) is under this threshold. */
const AUTO_COMPUTE_MAX_TOTAL = 20;

/** Maximum supported total UTXOs (inputs + outputs). */
export const MAX_SUPPORTED_TOTAL = 80;

/** Maximum supported total for WabiSabi (tier-decomposed, no DFS). */
export const MAX_SUPPORTED_TOTAL_WABISABI = 800;

/**
 * Most frequent value appearing at least twice (ties go to the larger value).
 * Returns count 0 when no value repeats.
 */
function dominantEqualValue(values: number[]): { amount: number; count: number } {
  let amount = 0;
  let count = 0;
  for (const [val, n] of countOutputValues(values.map((value) => ({ value })))) {
    if (n >= 2 && (n > count || (n === count && val > amount))) {
      amount = val;
      count = n;
    }
  }
  return { amount, count };
}

/** Detect intrafees for CoinJoin pattern. */
export function detectIntrafees(
  outputValues: number[],
  maxRatio: number,
): { feesMaker: number; feesTaker: number; hasCjPattern: boolean } {
  const { amount: bestAmount, count: bestCount } = dominantEqualValue(outputValues);

  if (bestCount < 2 || outputValues.length > 2 * bestCount) {
    return { feesMaker: 0, feesTaker: 0, hasCjPattern: false };
  }

  const feesMaker = Math.round(bestAmount * maxRatio);
  const feesTaker = feesMaker * (bestCount - 1);
  return { feesMaker, feesTaker, hasCjPattern: true };
}

/** Detect JoinMarket CoinJoin structure for turbo Boltzmann mode. */
export function detectJoinMarketForTurbo(
  inputValues: number[],
  outputValues: number[],
): { isJoinMarket: boolean; denomination: number } {
  const { amount: denomination, count: equalCount } = dominantEqualValue(outputValues);

  // JoinMarket requires at least 3 equal outputs (2 makers + 1 taker minimum).
  // This eliminates Stonewall (always 2 equal), batch payments with coincidental
  // pairs, and other false positives. A 1-maker JM round is useless for privacy.
  if (equalCount < 3) return { isJoinMarket: false, denomination: 0 };

  if (outputValues.length > 2 * equalCount + 5) return { isJoinMarket: false, denomination: 0 };

  const changeCount = outputValues.length - equalCount;
  if (changeCount === 0) return { isJoinMarket: false, denomination: 0 };

  // Every participant funds the denomination. Either each maker does so from a
  // single input, so at least (equalCount - 1) inputs are >= denomination (the
  // -1 is the taker, whose inputs may be smaller), or makers combine several
  // inputs: then every maker still gets a change output and there are at least
  // as many inputs as participants. boltzmann-rs checks the values against a
  // participant model and falls back when they do not fit. Batch payments and
  // consolidations (one or two change outputs) fail both.
  const aboveDenom = inputValues.filter(v => v >= denomination).length;
  const singleInputMakers = aboveDenom >= equalCount - 1;
  const multiInputMakers = changeCount >= equalCount - 1 && inputValues.length >= equalCount;
  if (!singleInputMakers && !multiInputMakers) return { isJoinMarket: false, denomination: 0 };

  return { isJoinMarket: true, denomination };
}

/** Detect WabiSabi CoinJoin structure for turbo Boltzmann mode.
 *
 * WabiSabi has 3+ denomination tiers with 10+ total equal outputs.
 * Unlike JoinMarket (single denomination), WabiSabi uses the tier-decomposed
 * Boltzmann approach: per-tier partition formulas combined under independence.
 */
export function detectWabiSabiForTurbo(
  inputValues: number[],
  outputValues: number[],
): boolean {
  if (inputValues.length < 10 || outputValues.length < 10) return false;

  const counts = new Map<number, number>();
  for (const v of outputValues) {
    if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  const tiers = [...counts.entries()].filter(([, c]) => c >= 2);
  const totalEqual = tiers.reduce((sum, [, c]) => sum + c, 0);

  return totalEqual >= 10 && tiers.length >= 3;
}

/**
 * Whether the exact (DFS) engine can run for this many inputs/outputs.
 * Mirrors boltzmann-rs `analyze::exact_feasible` (measurements there): beyond
 * it, preparation needs gigabytes and ignores the timeout, so the worker would
 * never answer.
 */
export function isExactFeasible(nIn: number, nOut: number): boolean {
  return nIn <= 22 && nOut <= 18 && nIn + nOut <= 32;
}

/** Whether JoinMarket turbo mode handles the transaction instead of exact DFS. */
export function usesJoinMarketTurbo(inputValues: number[], outputValues: number[]): boolean {
  return inputValues.length + outputValues.length >= 10
    && detectJoinMarketForTurbo(inputValues, outputValues).isJoinMarket;
}

/** Check if a transaction is eligible for auto Boltzmann computation. */
export function isAutoComputable(
  inputValues: number[],
  outputValues: number[],
): boolean {
  const nIn = inputValues.length;
  const nOut = outputValues.length;
  if (nIn === 0 || nOut === 0) return false;
  if (nIn + nOut < AUTO_COMPUTE_MAX_TOTAL) return true;
  // WabiSabi turbo: tier-decomposed, handles up to 800 total I/O
  if (nIn + nOut <= MAX_SUPPORTED_TOTAL_WABISABI && detectWabiSabiForTurbo(inputValues, outputValues)) return true;
  if (nIn + nOut > MAX_SUPPORTED_TOTAL) return false;
  return detectJoinMarketForTurbo(inputValues, outputValues).isJoinMarket;
}

type ValueTx = { vin: Array<{ is_coinbase?: boolean; prevout?: { value: number } | null }>; vout: Array<{ scriptpubkey_type?: string; scriptpubkey?: string; value: number }> };

/** Tx positions of the values extractTxValues returns (same filters, same order). */
export function extractTxValueIndices(tx: ValueTx): { inputIndices: number[]; outputIndices: number[] } {
  const inputIndices = tx.vin.flatMap((v, i) => (!v.is_coinbase && v.prevout ? [i] : []));
  const valued = new Set(getValuedOutputs(tx.vout));
  const outputIndices = tx.vout.flatMap((o, i) => (valued.has(o) ? [i] : []));
  return { inputIndices, outputIndices };
}

/**
 * Re-index a link matrix from extracted-value positions to raw tx positions
 * (rows = vout index, columns = vin index), so consumers can index it by the
 * vin/vout they already hold. OP_RETURN / zero-value outputs and coinbase
 * inputs get all-zero rows/columns.
 */
export function expandMatrixToTx<T extends { matLnkProbabilities: number[][]; matLnkCombinations: number[][]; deterministicLinks: [number, number][] }>(
  result: T,
  tx: ValueTx,
): T {
  const { inputIndices, outputIndices } = extractTxValueIndices(tx);
  if (result.matLnkProbabilities.length !== outputIndices.length) return result;
  const colOf = new Map(inputIndices.map((raw, k) => [raw, k]));
  const rowOf = new Map(outputIndices.map((raw, k) => [raw, k]));
  const expand = (m: number[][]) =>
    tx.vout.map((_, o) => {
      const r = rowOf.get(o);
      return tx.vin.map((__, i) => {
        const c = colOf.get(i);
        return r === undefined || c === undefined ? 0 : m[r]?.[c] ?? 0;
      });
    });
  return {
    ...result,
    matLnkProbabilities: expand(result.matLnkProbabilities),
    matLnkCombinations: expand(result.matLnkCombinations),
    deterministicLinks: result.deterministicLinks.map(([o, i]) => [outputIndices[o] ?? o, inputIndices[i] ?? i] as [number, number]),
  };
}

/** Extract input/output values from a transaction (filtering coinbase/OP_RETURN). */
export function extractTxValues(tx: { vin: Array<{ is_coinbase?: boolean; prevout?: { value: number } | null }>; vout: Array<{ scriptpubkey_type?: string; scriptpubkey?: string; value: number }> }): {
  inputValues: number[];
  outputValues: number[];
} {
  const inputValues = tx.vin
    .filter(v => !v.is_coinbase && v.prevout)
    .map(v => v.prevout!.value);
  const outputValues = getValuedOutputs(tx.vout).map(o => o.value);
  return { inputValues, outputValues };
}
