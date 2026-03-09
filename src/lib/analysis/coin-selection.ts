/**
 * Coin Selection Advisor
 *
 * Given a set of UTXOs and a target payment amount, recommends which UTXOs
 * to spend with privacy as the primary optimization criterion.
 *
 * Strategies:
 * 1. Exact match (BnB-style) - no change output, best privacy
 * 2. Single UTXO - simple, no input clustering
 * 3. Minimal change - if exact match impossible, minimize change
 *
 * Privacy rules:
 * - Prefer same-script-type UTXOs (avoid mixing P2WPKH + P2TR)
 * - Avoid merging UTXOs from different origins (cluster awareness)
 * - Flag when change is small enough to absorb into fee
 * - Warn about toxic change (change < 10,000 sats)
 */

import type { MempoolUtxo } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { fmtN } from "@/lib/format";

// ---------- Types ----------

export interface CoinSelectionInput {
  utxo: MempoolUtxo;
  /** Address this UTXO belongs to */
  address: string;
  /** Optional origin label (e.g. "exchange", "coinjoin", "p2p") */
  origin?: string;
}

export interface CoinSelectionResult {
  /** Selected UTXOs to spend */
  selected: CoinSelectionInput[];
  /** Total input value (sats) */
  inputTotal: number;
  /** Payment amount (sats) */
  paymentAmount: number;
  /** Change amount (sats) - 0 for exact match */
  changeAmount: number;
  /** Estimated fee (sats) */
  estimatedFee: number;
  /** Strategy used */
  strategy: "exact-match" | "single-utxo" | "minimal-change";
  /** Privacy findings/warnings for this selection */
  findings: Finding[];
}

// ---------- Fee estimation ----------

/** Estimated vbytes per input by script type. */
function inputVbytes(address: string): number {
  if (address.startsWith("bc1p") || address.startsWith("tb1p")) return 58; // P2TR
  if (address.startsWith("bc1q") || address.startsWith("tb1q")) return 68; // P2WPKH
  if (address.startsWith("3") || address.startsWith("2")) return 91; // P2SH-P2WPKH
  return 148; // P2PKH
}

/** Estimated vbytes for outputs (change + payment). */
function outputVbytes(outputCount: number): number {
  // ~31 vbytes per P2WPKH output + 10 base overhead
  return 10 + outputCount * 31;
}

/** Estimate transaction fee in sats. */
function estimateFee(
  inputs: CoinSelectionInput[],
  outputCount: number,
  feeRate: number,
): number {
  const inputsVb = inputs.reduce((s, i) => s + inputVbytes(i.address), 0);
  const totalVb = inputsVb + outputVbytes(outputCount);
  return Math.ceil(totalVb * feeRate);
}

// ---------- Selection strategies ----------

/** Maximum number of UTXOs to consider in BnB search. */
const BNB_MAX_INPUTS = 15;
/** Maximum iterations for BnB search. */
const BNB_MAX_ITERATIONS = 100_000;
/** Tolerance for "exact match" - change smaller than this is absorbed into fee. */
const EXACT_MATCH_TOLERANCE = 1000; // 1000 sats

/**
 * Branch and Bound (BnB) search for an exact match (no change).
 * Returns the subset of UTXOs that sum to target +/- tolerance, or null.
 */
function bnbSearch(
  candidates: CoinSelectionInput[],
  target: number,
  feeRate: number,
): CoinSelectionInput[] | null {
  // Sort descending by value for efficient pruning
  const sorted = [...candidates]
    .sort((a, b) => b.utxo.value - a.utxo.value)
    .slice(0, BNB_MAX_INPUTS);

  let best: CoinSelectionInput[] | null = null;
  let bestWaste = Infinity;
  let iterations = 0;

  // Precompute suffix sums for O(1) remaining-value lookups
  const suffixSum = new Array<number>(sorted.length + 1);
  suffixSum[sorted.length] = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    suffixSum[i] = suffixSum[i + 1] + sorted[i].utxo.value;
  }

  function search(index: number, selected: CoinSelectionInput[], currentSum: number): void {
    if (iterations++ > BNB_MAX_ITERATIONS) return;

    const fee = estimateFee(selected, 1, feeRate); // 1 output (no change)
    const needed = target + fee;
    const waste = currentSum - needed;

    // Found a valid solution
    if (waste >= 0 && waste <= EXACT_MATCH_TOLERANCE) {
      if (waste < bestWaste) {
        bestWaste = waste;
        best = [...selected];
      }
      return;
    }

    // Overshoot too much
    if (waste > EXACT_MATCH_TOLERANCE) return;

    // No more candidates
    if (index >= sorted.length) return;

    // Remaining sum can't reach target
    if (currentSum + suffixSum[index] < needed) return;

    // Branch: include current
    selected.push(sorted[index]);
    search(index + 1, selected, currentSum + sorted[index].utxo.value);
    selected.pop();

    // Branch: exclude current
    search(index + 1, selected, currentSum);
  }

  search(0, [], 0);
  return best;
}

/**
 * Find the single best UTXO that covers the target amount.
 * Prefers the smallest UTXO that is large enough.
 */
function singleUtxoSelection(
  candidates: CoinSelectionInput[],
  target: number,
  feeRate: number,
): CoinSelectionInput | null {
  let best: CoinSelectionInput | null = null;
  let bestExcess = Infinity;

  for (const c of candidates) {
    const fee = estimateFee([c], 2, feeRate); // 2 outputs (payment + change)
    const excess = c.utxo.value - target - fee;
    if (excess >= 0 && excess < bestExcess) {
      bestExcess = excess;
      best = c;
    }
  }

  return best;
}

/**
 * Greedy selection: add UTXOs until we have enough, preferring same script type.
 */
function greedySelection(
  candidates: CoinSelectionInput[],
  target: number,
  feeRate: number,
): CoinSelectionInput[] | null {
  // Sort by value descending (spend fewest inputs)
  const sorted = [...candidates].sort((a, b) => b.utxo.value - a.utxo.value);
  const selected: CoinSelectionInput[] = [];
  let total = 0;

  for (const c of sorted) {
    selected.push(c);
    total += c.utxo.value;
    const fee = estimateFee(selected, 2, feeRate);
    if (total >= target + fee) return selected;
  }

  return null; // Insufficient funds
}

// ---------- Privacy checks ----------

function generateFindings(result: CoinSelectionResult): Finding[] {
  const findings: Finding[] = [];

  // Exact match - great privacy
  if (result.strategy === "exact-match") {
    findings.push({
      id: "coin-select-exact-match",
      severity: "good",
      confidence: "deterministic",
      title: "Exact match - no change output",
      description:
        "An exact combination of UTXOs was found that matches the payment amount plus fee. " +
        "No change output is needed, which provides optimal privacy.",
      recommendation: "Proceed with this selection.",
      scoreImpact: 0,
    });
  }

  // Toxic change warning
  if (result.changeAmount > 0 && result.changeAmount < 10_000) {
    findings.push({
      id: "coin-select-toxic-change",
      severity: "high",
      confidence: "deterministic",
      title: `Small change: ${fmtN(result.changeAmount)} sats`,
      description:
        `This selection would create a change output of only ${fmtN(result.changeAmount)} sats. ` +
        "Small change outputs are uneconomical to spend and can link future transactions.",
      recommendation:
        "Consider absorbing the change into the fee, or select different UTXOs. " +
        "If the change is very small, sending it to a swap service is another option.",
      scoreImpact: 0,
      params: { changeAmount: result.changeAmount },
    });
  }

  // Mixed script types in inputs
  const scriptTypes = new Set(
    result.selected.map(s => {
      if (s.address.startsWith("bc1p") || s.address.startsWith("tb1p")) return "p2tr";
      if (s.address.startsWith("bc1q") || s.address.startsWith("tb1q")) return "p2wpkh";
      if (s.address.startsWith("3") || s.address.startsWith("2")) return "p2sh";
      return "p2pkh";
    }),
  );
  if (scriptTypes.size > 1) {
    findings.push({
      id: "coin-select-mixed-scripts",
      severity: "medium",
      confidence: "deterministic",
      title: "Mixed script types in inputs",
      description:
        `This selection uses inputs from ${scriptTypes.size} different script types (${[...scriptTypes].join(", ")}). ` +
        "Mixed script types make the transaction more identifiable.",
      recommendation:
        "If possible, select UTXOs of the same script type.",
      scoreImpact: 0,
      params: { scriptTypes: scriptTypes.size },
    });
  }

  // Multiple inputs (CIOH implication)
  if (result.selected.length > 1) {
    findings.push({
      id: "coin-select-multiple-inputs",
      severity: "low",
      confidence: "deterministic",
      title: `${result.selected.length} inputs - common input ownership revealed`,
      description:
        `Spending ${result.selected.length} UTXOs together reveals that these addresses ` +
        "belong to the same wallet (Common Input Ownership Heuristic).",
      recommendation:
        "When privacy is critical, prefer single-input transactions.",
      scoreImpact: 0,
      params: { inputCount: result.selected.length },
    });
  }

  return findings;
}

// ---------- Public API ----------

/**
 * Recommend optimal UTXO selection for a payment.
 *
 * @param utxos - Available UTXOs with address info
 * @param paymentAmount - Target payment amount in sats
 * @param feeRate - Fee rate in sat/vB (default 5)
 */
export function selectCoins(
  utxos: CoinSelectionInput[],
  paymentAmount: number,
  feeRate = 5,
): CoinSelectionResult | null {
  if (utxos.length === 0 || paymentAmount <= 0) return null;

  // Strategy 1: Try BnB exact match (no change)
  const bnb = bnbSearch(utxos, paymentAmount, feeRate);
  if (bnb) {
    const fee = estimateFee(bnb, 1, feeRate);
    const inputTotal = bnb.reduce((s, u) => s + u.utxo.value, 0);
    const result: CoinSelectionResult = {
      selected: bnb,
      inputTotal,
      paymentAmount,
      changeAmount: inputTotal - paymentAmount - fee,
      estimatedFee: fee,
      strategy: "exact-match",
      findings: [],
    };
    result.findings = generateFindings(result);
    return result;
  }

  // Strategy 2: Try single UTXO
  const single = singleUtxoSelection(utxos, paymentAmount, feeRate);
  if (single) {
    const fee = estimateFee([single], 2, feeRate);
    const inputTotal = single.utxo.value;
    const changeAmount = inputTotal - paymentAmount - fee;

    // If change is tiny, absorb into fee (treat as exact match)
    if (changeAmount <= EXACT_MATCH_TOLERANCE) {
      const result: CoinSelectionResult = {
        selected: [single],
        inputTotal,
        paymentAmount,
        changeAmount: 0,
        estimatedFee: inputTotal - paymentAmount,
        strategy: "exact-match",
        findings: [],
      };
      result.findings = generateFindings(result);
      return result;
    }

    const result: CoinSelectionResult = {
      selected: [single],
      inputTotal,
      paymentAmount,
      changeAmount,
      estimatedFee: fee,
      strategy: "single-utxo",
      findings: [],
    };
    result.findings = generateFindings(result);
    return result;
  }

  // Strategy 3: Greedy selection
  const greedy = greedySelection(utxos, paymentAmount, feeRate);
  if (!greedy) return null; // Insufficient funds

  const fee = estimateFee(greedy, 2, feeRate);
  const inputTotal = greedy.reduce((s, u) => s + u.utxo.value, 0);
  const changeAmount = inputTotal - paymentAmount - fee;

  const result: CoinSelectionResult = {
    selected: greedy,
    inputTotal,
    paymentAmount,
    changeAmount: Math.max(0, changeAmount),
    estimatedFee: fee,
    strategy: "minimal-change",
    findings: [],
  };
  result.findings = generateFindings(result);
  return result;
}
