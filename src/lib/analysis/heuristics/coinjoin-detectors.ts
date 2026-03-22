import { WHIRLPOOL_DENOMS } from "@/lib/constants";
import { countOutputValues } from "./tx-utils";

/** Minimum denomination for CoinJoin equal outputs (below this, likely noise/dust). */
const MIN_COINJOIN_DENOM = 10_000;

/**
 * Detect Whirlpool CoinJoin pattern.
 *
 * Whirlpool mix txs have 5+ equal outputs at a known denomination.
 * Classic: exactly 5 equal outputs (5-6 total with optional OP_RETURN).
 * Post-Sparrow 1.7.6: 8 or 9 equal outputs at the same denominations.
 * Coordinator fees are in the separate TX0 premix transaction, not in the mix.
 */
export function detectWhirlpool(values: number[]): { denomination: number } | null {
  if (values.length < 5 || values.length > 10) return null;

  for (const denom of WHIRLPOOL_DENOMS) {
    const matchCount = values.filter((v) => v === denom).length;
    // Accept 5, 8, or 9 equal outputs at a Whirlpool denomination.
    // Non-matching outputs (if any) must be OP_RETURN zero-value markers.
    if ((matchCount === 5 || matchCount === 8 || matchCount === 9) && values.length - matchCount <= 1) {
      return { denomination: denom };
    }
  }
  return null;
}

/**
 * Detect equal-output CoinJoin pattern.
 *
 * Counts occurrences of each output value and returns the most common
 * value with 5+ occurrences (3 equal outputs is too weak - exchange
 * batched withdrawals and payroll transactions routinely produce 3-4
 * equal outputs).
 */
export function detectEqualOutputs(
  values: number[],
): { count: number; denomination: number; total: number } | null {
  // Count occurrences of each output value
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  // Find the most common value with 5+ occurrences
  let bestValue = 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount && count >= 5) {
      bestCount = count;
      bestValue = value;
    }
  }

  if (bestCount < 5) return null;

  return {
    count: bestCount,
    denomination: bestValue,
    total: values.length,
  };
}

/**
 * Detect JoinMarket CoinJoin pattern.
 *
 * JoinMarket uses a maker/taker model with 2-10 inputs, 3-8 spendable outputs,
 * and 2-4 equal-valued outputs at a non-Whirlpool denomination above the dust
 * threshold. Inputs must come from at least 2 distinct addresses, and equal
 * outputs must go to distinct addresses.
 */
export function detectJoinMarket(
  vin: { prevout?: { scriptpubkey_address?: string; value?: number } | null }[],
  spendableOutputs: { value: number; scriptpubkey_address?: string }[],
): { equalCount: number; denomination: number; distinctInputAddresses: number } | null {
  // JoinMarket: maker/taker model with 2-10 inputs, 3-8 spendable outputs
  if (vin.length < 2 || vin.length > 10) return null;
  if (spendableOutputs.length < 3 || spendableOutputs.length > 8) return null;

  // Require inputs from at least 2 distinct addresses (multi-party evidence)
  const inputAddresses = new Set<string>();
  for (const v of vin) {
    if (v.prevout?.scriptpubkey_address) {
      inputAddresses.add(v.prevout.scriptpubkey_address);
    }
  }
  if (inputAddresses.size < 2) return null;

  // Count output values - look for 2-4 equal-valued outputs
  const counts = countOutputValues(spendableOutputs);

  // Find equal output groups with 2-4 occurrences
  let bestValue = 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count >= 2 && count <= 4 && count > bestCount) {
      // Skip if the value matches a Whirlpool denomination (would be caught earlier)
      if (WHIRLPOOL_DENOMS.includes(value)) continue;
      bestCount = count;
      bestValue = value;
    }
  }

  // Need at least 2 equal outputs
  if (bestCount < 2) return null;

  // The equal outputs should not be the only outputs (need change outputs too)
  if (bestCount === spendableOutputs.length) return null;

  // Require that the equal output value is a meaningful amount (not dust)
  if (bestValue < MIN_COINJOIN_DENOM) return null;

  // Equal-valued outputs must go to distinct addresses (multi-party evidence).
  // If they go to the same address, this is not a CoinJoin.
  const equalAddresses = new Set<string>();
  for (const o of spendableOutputs) {
    if (o.value === bestValue && o.scriptpubkey_address) {
      equalAddresses.add(o.scriptpubkey_address);
    }
  }
  if (equalAddresses.size < bestCount) return null;

  return {
    equalCount: bestCount,
    denomination: bestValue,
    distinctInputAddresses: inputAddresses.size,
  };
}

/**
 * Detect Stonewall CoinJoin pattern.
 *
 * Stonewall: 2+ inputs, exactly 4 spendable outputs (2 equal + 2 change).
 * Solo Stonewall typically has 2-3 inputs from one wallet.
 * STONEWALLx2 can have inputs from 2 parties (2+ each).
 * Either variant may consolidate many UTXOs, so no upper input limit is
 * imposed - the 4-output pattern (1 equal pair + 2 distinct change) is
 * already highly specific.
 * Stonewall from Whirlpool: all inputs share a Whirlpool denomination.
 */
export function detectStonewall(
  vin: { prevout?: { scriptpubkey_address?: string; value?: number } | null }[],
  spendableOutputs: { value: number; scriptpubkey_address?: string }[],
): { denomination: number; distinctInputAddresses: number; whirlpoolOrigin: boolean } | null {
  if (vin.length < 2) return null;
  if (spendableOutputs.length !== 4) return null;

  // Check if all inputs share a Whirlpool denomination (Stonewall from Whirlpool).
  // Only flag as Whirlpool-origin when there are 5+ inputs at the same Whirlpool
  // denomination - with 2-4 inputs, coincidental matches are possible.
  const inputValues = vin.map((v) => v.prevout?.value).filter((v): v is number => v != null);
  const allSameValue = inputValues.length >= 2 && inputValues.every((v) => v === inputValues[0]);
  const isWhirlpoolOrigin = allSameValue && inputValues.length >= 5 && WHIRLPOOL_DENOMS.includes(inputValues[0]);

  // Count output values
  const counts = countOutputValues(spendableOutputs);

  // Need exactly 1 pair of equal outputs + 2 distinct change outputs
  // counts.size === 3 means: one value twice, two other values once each
  if (counts.size !== 3) return null;

  let equalValue = 0;
  for (const [value, count] of counts) {
    if (count === 2) equalValue = value;
  }
  if (equalValue === 0) return null;

  // Skip Whirlpool denominations (would be caught by Whirlpool detection)
  if (WHIRLPOOL_DENOMS.includes(equalValue)) return null;

  // Skip dust amounts
  if (equalValue < MIN_COINJOIN_DENOM) return null;

  // Equal-valued outputs must go to distinct addresses (multi-party evidence)
  const equalAddresses = new Set<string>();
  for (const o of spendableOutputs) {
    if (o.value === equalValue && o.scriptpubkey_address) {
      equalAddresses.add(o.scriptpubkey_address);
    }
  }
  if (equalAddresses.size < 2) return null;

  // Count distinct input addresses
  const inputAddresses = new Set<string>();
  for (const v of vin) {
    if (v.prevout?.scriptpubkey_address) {
      inputAddresses.add(v.prevout.scriptpubkey_address);
    }
  }

  return {
    denomination: equalValue,
    distinctInputAddresses: inputAddresses.size,
    whirlpoolOrigin: isWhirlpoolOrigin,
  };
}

/**
 * Detect Wasabi 1.0 CoinJoin pattern.
 *
 * Wasabi 1.0 (2018-2022) coinjoins have a distinctive structure:
 * - Many inputs (typically 10-100+) from many distinct addresses
 * - One dominant denomination tier: 5+ equal outputs at a single value
 * - Additional change outputs of varying sizes
 * - Change outputs are mixed in with the equal-value outputs
 * - NOT Whirlpool (which has only equal outputs, no change)
 * - NOT WabiSabi (which has multiple denomination tiers)
 *
 * The key differentiator from generic equal-output detection is the
 * combination of high input count + single denomination + change outputs.
 */
export function detectWasabi1(
  vin: { prevout?: { scriptpubkey_address?: string; value?: number } | null }[],
  spendableOutputs: { value: number; scriptpubkey_address?: string }[],
): { equalCount: number; denomination: number; changeCount: number } | null {
  // Wasabi 1.0: typically 10-100+ inputs, 10-100+ outputs
  // Higher thresholds than JoinMarket to avoid overlap
  if (vin.length < 10 || spendableOutputs.length < 10) return null;

  // Require many distinct input addresses (multi-party evidence)
  const inputAddresses = new Set<string>();
  for (const v of vin) {
    if (v.prevout?.scriptpubkey_address) {
      inputAddresses.add(v.prevout.scriptpubkey_address);
    }
  }
  if (inputAddresses.size < 5) return null;

  // Count output values
  const counts = countOutputValues(spendableOutputs);

  // Find the dominant denomination (most common output value with 5+ occurrences)
  let bestValue = 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count >= 5 && count > bestCount && value >= MIN_COINJOIN_DENOM) {
      // Skip Whirlpool denominations
      if (WHIRLPOOL_DENOMS.includes(value)) continue;
      bestCount = count;
      bestValue = value;
    }
  }
  if (bestCount < 5) return null;

  // Must have change outputs (non-equal outputs present)
  const changeCount = spendableOutputs.length - bestCount;
  if (changeCount < 1) return null;

  // Wasabi 1.0 has a single dominant denomination. If there are multiple
  // denomination tiers with 3+ outputs each, it's more likely WabiSabi
  // or a custom multi-tier CoinJoin.
  let denomTierCount = 0;
  for (const [, count] of counts) {
    if (count >= 3) denomTierCount++;
  }
  if (denomTierCount > 1) return null;

  // Equal outputs must go to distinct addresses
  const equalAddresses = new Set<string>();
  for (const o of spendableOutputs) {
    if (o.value === bestValue && o.scriptpubkey_address) {
      equalAddresses.add(o.scriptpubkey_address);
    }
  }
  if (equalAddresses.size < bestCount) return null;

  return {
    equalCount: bestCount,
    denomination: bestValue,
    changeCount,
  };
}

/**
 * Detect simplified Stonewall pattern.
 *
 * Simplified Stonewall: 2+ inputs, exactly 3 spendable outputs.
 * 2 outputs with equal value (payment + decoy) + 1 change.
 * Real Stonewall always has 2+ inputs (wallet constructs a self-spend structure).
 */
export function detectSimplifiedStonewall(
  vin: { prevout?: { scriptpubkey_address?: string; value?: number } | null }[],
  spendableOutputs: { value: number; scriptpubkey_address?: string }[],
): { denomination: number } | null {
  if (spendableOutputs.length !== 3) return null;
  if (vin.length < 2) return null;

  // Count output values - need exactly 1 pair
  const counts = countOutputValues(spendableOutputs);

  // counts.size === 2 means: one value twice + one value once
  if (counts.size !== 2) return null;

  let equalValue = 0;
  for (const [value, count] of counts) {
    if (count === 2) equalValue = value;
  }
  if (equalValue === 0) return null;

  // Skip dust amounts and Whirlpool denominations
  if (equalValue < MIN_COINJOIN_DENOM) return null;
  if (WHIRLPOOL_DENOMS.includes(equalValue)) return null;

  // Equal-valued outputs must go to distinct addresses
  const equalAddresses = new Set<string>();
  for (const o of spendableOutputs) {
    if (o.value === equalValue && o.scriptpubkey_address) {
      equalAddresses.add(o.scriptpubkey_address);
    }
  }
  if (equalAddresses.size < 2) return null;

  return { denomination: equalValue };
}
