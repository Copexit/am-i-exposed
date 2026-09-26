import type { MempoolVin, MempoolVout } from "@/lib/api/types";
import { getAddressType } from "@/lib/bitcoin/address-type";
import { isRoundAmount, getMatchingRoundFiat, ROUND_USD_TOLERANCE_DEFAULT } from "./round-amount";

/** Mutable accumulator passed through all sub-heuristic checks. */
export interface ChangeSignalAccumulator {
  /** Maps output index (0 or 1) to signal vote count. */
  changeIndices: Map<number, number>;
  /** Human-readable description of each signal that fired. */
  signals: string[];
}

/**
 * Sub-heuristic 1: Address type mismatch
 *
 * If all inputs share a single address type and exactly one output matches it,
 * that output is likely change. Weight is 2 because this is one of the
 * strongest change detection signals.
 */
export function checkAddressTypeMismatch(
  vin: MempoolVin[],
  vout: MempoolVout[],
  changeIndices: Map<number, number>,
  signals: string[],
): void {
  // Collect input address types
  const inputTypes = new Set<string>();
  for (const v of vin) {
    if (v.prevout?.scriptpubkey_address) {
      inputTypes.add(getAddressType(v.prevout.scriptpubkey_address));
    }
  }

  if (inputTypes.size !== 1) return; // Mixed inputs, can't determine

  const [inputType] = inputTypes;
  const [out0, out1] = vout;
  if (!out0 || !out1) return;
  const out0Type = getAddressType(out0.scriptpubkey_address!);
  const out1Type = getAddressType(out1.scriptpubkey_address!);

  // If one output matches input type and the other doesn't.
  // Weight is 2 because address type mismatch is one of the strongest change
  // detection signals - alone it should produce "medium confidence".
  if (out0Type === inputType && out1Type !== inputType) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 2);
    signals.push("change matches input address type");
  } else if (out1Type === inputType && out0Type !== inputType) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 2);
    signals.push("change matches input address type");
  }
}

/**
 * Sub-heuristic 2: Round amount
 *
 * If exactly one output is a round BTC amount, the other is likely change.
 */
export function checkRoundAmount(
  vout: MempoolVout[],
  changeIndices: Map<number, number>,
  signals: string[],
): void {
  const [out0, out1] = vout;
  if (!out0 || !out1) return;
  const round0 = isRoundAmount(out0.value);
  const round1 = isRoundAmount(out1.value);

  // If exactly one output is round, the other is likely change
  if (round0 && !round1) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("non-round output is likely change");
  } else if (round1 && !round0) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("non-round output is likely change");
  }
}

/**
 * Sub-heuristic 3: Value disparity
 *
 * If one output is 100x+ larger than the other, the larger one is likely
 * change (the sender's remaining funds).
 */
export function checkValueDisparity(
  vout: MempoolVout[],
  changeIndices: Map<number, number>,
  signals: string[],
): void {
  const [out0, out1] = vout;
  if (!out0 || !out1) return;
  const v0 = out0.value;
  const v1 = out1.value;
  const ratio = Math.max(v0, v1) / Math.min(v0, v1);

  // 100x+ difference: larger output is likely change (sender's remaining funds)
  if (ratio < 100) return;

  if (v0 > v1) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("large value disparity between outputs");
  } else {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("large value disparity between outputs");
  }
}

/** Shadow change threshold: output below this fraction of the smallest input. */
const SHADOW_CHANGE_RATIO = 0.1;

/**
 * Sub-heuristic 4: Unnecessary input (optimal change)
 *
 * Wallets do not add inputs they do not need. If output X were the change,
 * the payment plus fee could only have required every input when X is smaller
 * than the smallest input (otherwise the smallest input was unnecessary).
 * When exactly one output passes that test, it is the change.
 *
 * Outputs below SHADOW_CHANGE_RATIO of the smallest input are left to
 * checkShadowChange, which is the same rule with a stricter threshold.
 *
 * Reference: Bitcoin Wiki "Privacy" (unnecessary input heuristic);
 * Kalodner et al., BlockSci (2017), "optimal change".
 */
export function checkUnnecessaryInput(
  vin: MempoolVin[],
  vout: MempoolVout[],
  changeIndices: Map<number, number>,
  signals: string[],
): void {
  // Need multiple inputs for this heuristic
  if (vin.length < 2) return;

  let smallestInput = Infinity;
  for (const v of vin) {
    if (!v.prevout) return; // Can't evaluate without full prevout data
    smallestInput = Math.min(smallestInput, v.prevout.value);
  }

  const [out0, out1] = vout;
  if (!out0 || !out1) return;
  const candidate0 = out0.value < smallestInput;
  const candidate1 = out1.value < smallestInput;
  if (candidate0 === candidate1) return;

  const idx = candidate0 ? 0 : 1;
  if ((candidate0 ? out0 : out1).value < smallestInput * SHADOW_CHANGE_RATIO) return; // shadow change covers it
  changeIndices.set(idx, (changeIndices.get(idx) ?? 0) + 1);
  signals.push("unnecessary inputs suggest change");
}

/**
 * Sub-heuristic 5: Round fiat amount (USD/EUR)
 *
 * If exactly one output matches a round fiat amount at the historical
 * exchange rate, the other is likely change.
 */
export function checkRoundFiatAmount(
  vout: MempoolVout[],
  fiatPerBtc: number,
  currency: "usd" | "eur",
  changeIndices: Map<number, number>,
  signals: string[],
  tolerancePct: number = ROUND_USD_TOLERANCE_DEFAULT,
): void {
  const [out0, out1] = vout;
  if (!out0 || !out1) return;
  const round0 = getMatchingRoundFiat(out0.value, fiatPerBtc, tolerancePct) !== null;
  const round1 = getMatchingRoundFiat(out1.value, fiatPerBtc, tolerancePct) !== null;
  const label = currency.toUpperCase();

  // If exactly one output is a round fiat amount, the other is likely change
  if (round0 && !round1) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push(`round ${label} amount output is likely payment`);
  } else if (round1 && !round0) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push(`round ${label} amount output is likely payment`);
  }
}

/**
 * Sub-heuristic 6: Optimal change
 *
 * If one output accounts for > 90% of the total input value (minus fee),
 * it is very likely the change output. The sender spent only a small
 * fraction of their input, returning the rest as change.
 */
export function checkOptimalChange(
  vin: MempoolVin[],
  vout: MempoolVout[],
  fee: number,
  changeIndices: Map<number, number>,
  signals: string[],
): void {
  let totalInput = 0;
  for (const v of vin) {
    totalInput += v.prevout?.value ?? 0;
  }
  if (totalInput === 0) return;

  const totalSpendable = totalInput - fee;
  if (totalSpendable <= 0) return;

  const [out0, out1] = vout;
  if (!out0 || !out1) return;
  const ratio0 = out0.value / totalSpendable;
  const ratio1 = out1.value / totalSpendable;

  // One output gets > 95% of input value - likely change.
  // Threshold is 95% (not 90%) because 90-95% is ambiguous: it could be a
  // large self-transfer to cold storage rather than a small payment + big change.
  if (ratio0 > 0.95 && ratio1 <= 0.95) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("optimal change: output receives >95% of input value");
  } else if (ratio1 > 0.95 && ratio0 <= 0.95) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("optimal change: output receives >95% of input value");
  }
}

/**
 * Sub-heuristic 7: Shadow change
 *
 * When one output is significantly smaller than the smallest input,
 * it is likely a small change leftover. The sender spent most of their
 * funds and the "shadow" is the tiny remainder.
 */
export function checkShadowChange(
  vin: MempoolVin[],
  vout: MempoolVout[],
  changeIndices: Map<number, number>,
  signals: string[],
): void {
  // Find smallest input value
  let smallestInput = Infinity;
  for (const v of vin) {
    const val = v.prevout?.value ?? 0;
    if (val > 0 && val < smallestInput) smallestInput = val;
  }
  if (smallestInput === Infinity) return;

  const [out0, out1] = vout;
  if (!out0 || !out1) return;
  const v0 = out0.value;
  const v1 = out1.value;

  // If one output is < 10% of the smallest input, it's likely shadow change
  const threshold = smallestInput * SHADOW_CHANGE_RATIO;
  if (v0 < threshold && v1 >= threshold) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("shadow change: output much smaller than smallest input");
  } else if (v1 < threshold && v0 >= threshold) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("shadow change: output much smaller than smallest input");
  }
}

/**
 * Sub-heuristic 8: Fresh address vs heavily reused address
 *
 * HD wallets generate fresh addresses for change. If one output goes to a
 * fresh address and the other to a heavily reused address (tx_count >= 5),
 * the fresh address is likely change.
 *
 * Weight is 1 (not 2) because fresh addresses are inherently ambiguous -
 * recipients also generate fresh addresses via HD wallets. The signal only
 * fires when the "reused" side has meaningful history (>= REUSE_THRESHOLD),
 * filtering out noise from barely-used addresses (cold storage, new users).
 *
 * Reference: Blockchair 100-indicator PDF, category 4
 */
export function checkFreshAddress(
  vout: MempoolVout[],
  outputTxCounts: Map<string, number>,
  changeIndices: Map<number, number>,
  signals: string[],
): void {
  const [out0, out1] = vout;
  if (!out0 || !out1) return;
  const addr0 = out0.scriptpubkey_address!;
  const addr1 = out1.scriptpubkey_address!;
  const count0 = outputTxCounts.get(addr0);
  const count1 = outputTxCounts.get(addr1);

  // Need data for both outputs
  if (count0 === undefined || count1 === undefined) return;

  // "Fresh" means this tx is the only time the address has appeared (tx_count <= 1).
  // The current tx itself may already be counted, so <= 1 is fresh.
  const fresh0 = count0 <= 1;
  const fresh1 = count1 <= 1;

  // Minimum reuse threshold: the "reused" side must have meaningful history.
  // tx_count 2-4 is ambiguous (cold storage, new user, simple wallet).
  // >= 5 indicates a service, exchange, merchant, or habitual address reuser.
  const REUSE_THRESHOLD = 5;

  if (fresh0 && count1 >= REUSE_THRESHOLD) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("fresh address vs. heavily reused address");
  } else if (fresh1 && count0 >= REUSE_THRESHOLD) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("fresh address vs. heavily reused address");
  }
}
