import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { fmtN } from "@/lib/format";
import { getSpendableOutputs } from "../heuristics/tx-utils";

/**
 * JoinMarket Advanced Analysis
 *
 * 1. Subset-sum attack: attempts to identify the taker's inputs by finding
 *    an input subset whose total, minus the fee, matches a change output.
 *    Research shows this succeeds ~76% of the time on real JoinMarket txs.
 *
 * 2. Taker/maker identification: the taker pays the full mining fee and
 *    receives the mixed UTXO. Makers provide liquidity and receive tiny
 *    fee income, so their change is slightly larger than their input.
 *
 * Both only apply to JoinMarket-style CoinJoin transactions (detected by
 * the h4-joinmarket finding in the main CoinJoin heuristic).
 */

interface SubsetSumResult {
  found: boolean;
  /** Indices of inputs likely belonging to the taker */
  takerInputIndices: number[];
  /** The change output index that matched the subset sum */
  changeOutputIndex: number;
  /** The subset sum minus fee */
  subsetTotal: number;
  findings: Finding[];
}

interface TakerMakerResult {
  /** Index of the likely taker change output */
  takerChangeIndex: number;
  /** Indices of maker change outputs */
  makerChangeIndices: number[];
  /** The denomination (equal output value) */
  denomination: number;
  findings: Finding[];
}

/**
 * Attempt subset-sum attack on a JoinMarket-style CoinJoin transaction.
 *
 * For each non-equal change output, try all subsets of inputs to see if
 * any subset total minus fee matches the change output + denomination.
 *
 * Optimization: limits to max 10 inputs (2^10 = 1024 subsets) to prevent
 * exponential blowup.
 */
export function subsetSumAttack(tx: MempoolTransaction): SubsetSumResult {
  const findings: Finding[] = [];
  const emptyResult: SubsetSumResult = {
    found: false,
    takerInputIndices: [],
    changeOutputIndex: -1,
    subsetTotal: 0,
    findings,
  };

  // Need inputs with known values
  const inputValues = tx.vin
    .map((v) => v.prevout?.value ?? 0)
    .filter((v) => v > 0);

  if (inputValues.length < 2 || inputValues.length > 10) {
    return emptyResult;
  }

  const spendable = getSpendableOutputs(tx.vout);
  if (spendable.length < 3) return emptyResult;

  // Identify equal-value outputs (the denomination)
  const valueCounts = new Map<number, number>();
  for (const o of spendable) {
    valueCounts.set(o.value, (valueCounts.get(o.value) ?? 0) + 1);
  }

  // Pick the most frequent repeated value as the denomination.
  // Break ties by largest value (JoinMarket denomination is typically the
  // most common equal-output value, not the largest).
  let denomination = 0;
  let maxCount = 0;
  for (const [val, count] of valueCounts) {
    if (count >= 2 && (count > maxCount || (count === maxCount && val > denomination))) {
      denomination = val;
      maxCount = count;
    }
  }

  if (denomination === 0) return emptyResult;

  // Change outputs = non-equal-value outputs
  const changeOutputs = spendable
    .map((o, i) => ({ value: o.value, index: i }))
    .filter((o) => o.value !== denomination);

  if (changeOutputs.length === 0) return emptyResult;

  const fee = tx.fee;
  const totalSubsets = 1 << inputValues.length; // 2^n

  // Count how many denomination outputs exist (taker may receive 1 or more)
  const denomCount = valueCounts.get(denomination) ?? 0;

  // For each change output, try all non-empty input subsets.
  // The taker may receive 1..denomCount denomination outputs, so try each possibility.
  for (const changeOut of changeOutputs) {
    for (let takerDenoms = 1; takerDenoms <= denomCount; takerDenoms++) {
      // Taker's change = sum(taker inputs) - takerDenoms * denomination - fee
      // So we look for: sum(subset) = changeOut.value + takerDenoms * denomination + fee
      const target = changeOut.value + takerDenoms * denomination + fee;

      for (let mask = 1; mask < totalSubsets; mask++) {
        let subsetSum = 0;
        const indices: number[] = [];

        for (let bit = 0; bit < inputValues.length; bit++) {
          if (mask & (1 << bit)) {
            subsetSum += inputValues[bit];
            indices.push(bit);
          }
        }

        // Check within a small tolerance (1 sat rounding)
        if (Math.abs(subsetSum - target) <= 1) {
          // Also check that remaining inputs cover the maker outputs
          const remainingInputTotal = inputValues.reduce((s, v) => s + v, 0) - subsetSum;

          // Remaining inputs should roughly cover maker changes + denomination outputs
          // (makers receive denomination outputs + their change)
          if (remainingInputTotal > 0) {
            findings.push({
              id: "joinmarket-subset-sum",
              severity: "high",
              confidence: "high",
              title: `Subset-sum attack: taker inputs likely identified (${indices.length} of ${inputValues.length})`,
              description:
                `Input subset [${indices.map((i) => i + 1).join(", ")}] sums to exactly the taker's expected total ` +
                `(change ${fmtN(changeOut.value)} + ${takerDenoms} x denomination ${fmtN(denomination)} + fee ${fmtN(fee)} sats). ` +
                "Research on JoinMarket transactions shows this subset-sum attack succeeds ~76% of the time. " +
                "This means the taker's inputs (and therefore their identity link) are revealed with high probability.",
              recommendation:
                "JoinMarket's taker privacy is structurally vulnerable to subset-sum attacks. " +
                "Consider using multiple rounds of mixing, or switch to Whirlpool which is immune to this attack " +
                "(all inputs/outputs are exactly equal, no change outputs).",
              scoreImpact: -8,
              params: {
                takerInputs: indices.length,
                totalInputs: inputValues.length,
                changeValue: changeOut.value,
                denomination,
                takerDenomCount: takerDenoms,
              },
            });

            return {
              found: true,
              takerInputIndices: indices,
              changeOutputIndex: changeOut.index,
              subsetTotal: subsetSum,
              findings,
            };
          }
        }
      }
    }
  }

  // No subset found - strong CoinJoin privacy
  findings.push({
    id: "joinmarket-subset-sum-resistant",
    severity: "good",
    confidence: "high",
    title: "Subset-sum attack failed - strong CoinJoin privacy",
    description:
      "No input subset could be matched to a change output using the subset-sum technique. " +
      "This JoinMarket transaction resists the most common analytical attack against maker/taker " +
      "CoinJoin structures. The taker's inputs cannot be distinguished from maker inputs.",
    recommendation:
      "This CoinJoin provides strong privacy. Continue using JoinMarket for mixing.",
    scoreImpact: 5,
  });

  return emptyResult;
}

/**
 * Identify taker vs maker roles in a JoinMarket CoinJoin.
 *
 * - Taker: pays the full mining fee, contributes inputs, gets denomination
 *   output + change. Change is smaller (total - denomination - fee).
 * - Makers: contribute inputs, get denomination output + change.
 *   Their change is input - denomination + tiny fee income.
 *   So maker change is very close to (input - denomination) but slightly larger.
 *
 * This analysis works with the denomination and change output values.
 */
export function identifyTakerMaker(tx: MempoolTransaction): TakerMakerResult | null {
  const spendable = getSpendableOutputs(tx.vout);
  if (spendable.length < 3) return null;

  // Identify denomination
  const valueCounts = new Map<number, number>();
  for (const o of spendable) {
    valueCounts.set(o.value, (valueCounts.get(o.value) ?? 0) + 1);
  }

  // Pick the most frequent repeated value as the denomination
  let denomination = 0;
  let maxCount = 0;
  for (const [val, count] of valueCounts) {
    if (count >= 2 && (count > maxCount || (count === maxCount && val > denomination))) {
      denomination = val;
      maxCount = count;
    }
  }

  if (denomination === 0) return null;

  // Change outputs = non-denomination outputs
  const changeOutputs = spendable
    .map((o, i) => ({ value: o.value, index: i }))
    .filter((o) => o.value !== denomination);

  if (changeOutputs.length < 2) return null;

  // The taker's change is typically the smallest change output
  // because: taker_change = taker_input - denomination - full_fee
  // while: maker_change = maker_input - denomination + tiny_fee_income
  // Since the taker pays the fee and makers earn fee income,
  // the taker's change is reduced and makers' change is slightly increased.
  const sortedChange = [...changeOutputs].sort((a, b) => a.value - b.value);
  const takerChange = sortedChange[0];
  const makerChanges = sortedChange.slice(1);

  const findings: Finding[] = [];

  findings.push({
    id: "joinmarket-taker-maker",
    severity: "medium",
    confidence: "medium",
    title: `Taker/maker analysis: smallest change (${fmtN(takerChange.value)} sats) likely belongs to taker`,
    description:
      `In JoinMarket, the taker pays the full mining fee (${fmtN(tx.fee)} sats) while makers ` +
      "earn tiny fee income. This means the taker's change output is the smallest. " +
      `The output at index ${takerChange.index} (${fmtN(takerChange.value)} sats) is the ` +
      "most likely taker change. The taker's privacy is structurally weaker than the makers' privacy.",
    recommendation:
      "If you are the taker, your change output is more identifiable. " +
      "Consider spending it through another CoinJoin round, or convert to Monero/Lightning. " +
      "If you are a maker, your privacy is stronger - your change is less distinguishable.",
    scoreImpact: -3,
    params: {
      takerChangeIndex: takerChange.index,
      takerChangeValue: takerChange.value,
      makerChangeCount: makerChanges.length,
      denomination,
      fee: tx.fee,
    },
  });

  return {
    takerChangeIndex: takerChange.index,
    makerChangeIndices: makerChanges.map((c) => c.index),
    denomination,
    findings,
  };
}

/**
 * Estimate the effective anonymity set for a JoinMarket CoinJoin.
 *
 * JoinMarket change outputs link rounds, so multi-round anonymity
 * is ADDITIVE, not multiplicative:
 *   effectiveAnonSet = participants + chainedRounds * (participants - 1)
 *
 * For a single round with no chaining, effectiveAnonSet = participants.
 * This is weaker than Whirlpool (where rounds are fully unlinkable and
 * the set grows multiplicatively).
 */
function estimateJoinMarketAnonSet(
  participants: number,
  chainedRounds: number = 0,
): number {
  if (participants < 2) return 1;
  // Additive formula: each chained round adds (participants - 1) new
  // possible sources, not a full multiplicative factor, because change
  // outputs create a traceable link between rounds.
  return participants + chainedRounds * (participants - 1);
}

/**
 * Run the full JoinMarket analysis suite on a transaction.
 * Only meaningful for JoinMarket-style CoinJoin transactions.
 */
export function analyzeJoinMarket(tx: MempoolTransaction): Finding[] {
  const findings: Finding[] = [];

  // Run subset-sum attack
  const ssResult = subsetSumAttack(tx);
  findings.push(...ssResult.findings);

  // Run taker/maker identification (only if subset-sum didn't already identify)
  if (!ssResult.found) {
    const tmResult = identifyTakerMaker(tx);
    if (tmResult) {
      findings.push(...tmResult.findings);
    }
  }

  // Estimate effective anonymity set for this single round.
  // Count equal-value outputs as participants (each gets one denomination output).
  const spendable = getSpendableOutputs(tx.vout);
  const valueCounts = new Map<number, number>();
  for (const o of spendable) {
    valueCounts.set(o.value, (valueCounts.get(o.value) ?? 0) + 1);
  }
  let participants = 0;
  for (const [, count] of valueCounts) {
    if (count >= 2 && count > participants) {
      participants = count;
    }
  }

  if (participants >= 2) {
    // Single round: chainedRounds = 0, so effectiveAnonSet = participants
    const effectiveAnonSet = estimateJoinMarketAnonSet(participants, 0);
    findings.push({
      id: "joinmarket-anon-set",
      severity: effectiveAnonSet >= 4 ? "good" : "medium",
      confidence: "medium",
      title: `JoinMarket anonymity set: ${effectiveAnonSet} participants`,
      description:
        `This JoinMarket round has ${participants} equal-output participants, ` +
        `giving an effective anonymity set of ${effectiveAnonSet}. ` +
        "JoinMarket's change outputs link rounds, so multi-round anonymity grows " +
        "additively (participants + chainedRounds * (participants - 1)), not " +
        "multiplicatively. For stronger privacy, use more participants per round " +
        "rather than relying on many rounds.",
      recommendation:
        "For maximum JoinMarket privacy, prefer rounds with more makers (larger anonymity set per round). " +
        "Whirlpool provides multiplicative anonymity set growth across rounds because it has no change outputs.",
      scoreImpact: 0, // Informational - CoinJoin impact is scored by h4-joinmarket
      params: {
        participants,
        effectiveAnonSet,
        chainedRounds: 0,
      },
    });
  }

  return findings;
}
