import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";

const EXCHANGE_WARNING =
  "Centralized exchanges including Binance, Coinbase, Gemini, Bitstamp, Swan Bitcoin, BitVavo, Bitfinex, and BitMEX " +
  "have been documented flagging, freezing, or closing accounts for CoinJoin-associated deposits. " +
  "This list is not exhaustive - other exchanges may have similar policies. " +
  "Some exchanges retroactively flag CoinJoin activity months or years after the transaction. " +
  "For safe off-ramping, consider decentralized alternatives like Bisq, RoboSats, or Hodl Hodl that do not apply chain surveillance.";


/**
 * H4: CoinJoin Detection
 *
 * CoinJoins are the ONLY positive privacy signal. Detects:
 * - Whirlpool: exactly 5 equal outputs at known denominations
 * - Wasabi/generic: many equal outputs (3+) with possible coordinator fee
 * - Equal-output pattern: general collaborative transaction detection
 *
 * Impact: +15 to +30
 */
export const analyzeCoinJoin: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // Need at least 2 inputs and 2 outputs
  if (tx.vin.length < 2 || tx.vout.length < 2) return { findings };

  // Check for Whirlpool pattern first (most specific)
  // Filter to spendable outputs (exclude OP_RETURN) for pattern matching
  const spendableOutputs = tx.vout.filter((o) => o.scriptpubkey_type !== "op_return");
  const whirlpool = detectWhirlpool(spendableOutputs.map((o) => o.value));
  if (whirlpool) {
    findings.push({
      id: "h4-whirlpool",
      severity: "good",
      title: `Whirlpool CoinJoin detected (${formatBtc(whirlpool.denomination)} pool)`,
      params: { denom: formatBtc(whirlpool.denomination) },
      description:
        "This transaction matches the Whirlpool CoinJoin pattern: 5 equal outputs at a standard denomination. " +
        "Whirlpool provides strong forward-looking privacy by breaking deterministic transaction links.",
      recommendation:
        "Whirlpool is one of the strongest CoinJoin implementations. Make sure to also remix (multiple rounds) for maximum privacy. " +
        EXCHANGE_WARNING,
      scoreImpact: 30,
    });
    return { findings };
  }

  // Check for WabiSabi / Wasabi pattern (many inputs, many outputs)
  // WabiSabi rounds can have as few as ~10 participants
  // WabiSabi rounds typically have 50+ participants; use >= 20 to avoid
  // false positives from exchange batched withdrawals (commonly 15-30 outputs)
  const isWabiSabi = tx.vin.length >= 20 && spendableOutputs.length >= 20;

  // Check for generic equal-output CoinJoin
  const equalOutput = detectEqualOutputs(spendableOutputs.map((o) => o.value));

  // WabiSabi multi-tier detection: if the structure looks like WabiSabi (many in/out)
  // but no single denomination has 5+ outputs, check for multiple denomination groups
  if (!equalOutput && isWabiSabi) {
    const counts = new Map<number, number>();
    for (const o of spendableOutputs) {
      counts.set(o.value, (counts.get(o.value) ?? 0) + 1);
    }
    const groups = [...counts.entries()].filter(([, c]) => c >= 2);
    const totalEqual = groups.reduce((sum, [, c]) => sum + c, 0);

    if (totalEqual >= 10 && groups.length >= 3) {
      const impact = totalEqual >= 20 ? 25 : 20;
      findings.push({
        id: "h4-coinjoin",
        severity: "good",
        title: `WabiSabi CoinJoin: ${groups.length} denomination tiers, ${totalEqual} equal outputs across ${spendableOutputs.length} total`,
        params: { groups: groups.length, totalEqual, vout: spendableOutputs.length, vin: tx.vin.length, isWabiSabi: 1 },
        description:
          `This transaction has ${tx.vin.length} inputs and ${spendableOutputs.length} outputs with ${groups.length} groups of equal-value outputs, ` +
          "consistent with a WabiSabi (Wasabi Wallet 2.0) CoinJoin using multiple denomination tiers. " +
          "This pattern breaks the link between inputs and outputs, significantly improving privacy.",
        recommendation:
          "WabiSabi CoinJoins provide excellent privacy through large anonymity sets and multiple denomination tiers. Continue using CoinJoin for maximum privacy. " +
          EXCHANGE_WARNING,
        scoreImpact: impact,
      });
      return { findings };
    }
  }

  if (equalOutput) {
    const { count, denomination, total } = equalOutput;

    // Higher confidence with more equal outputs
    const impact = count >= 10 ? 25 : count >= 5 ? 20 : 15;

    const label = isWabiSabi
      ? `WabiSabi CoinJoin: ${count} equal outputs across ${total} total`
      : `Likely CoinJoin: ${count} equal outputs of ${formatBtc(denomination)}`;

    findings.push({
      id: "h4-coinjoin",
      severity: "good",
      title: label,
      params: { count, denomination: formatBtc(denomination), total, vin: tx.vin.length, isWabiSabi: isWabiSabi ? 1 : 0 },
      description:
        (isWabiSabi
          ? `This transaction has ${tx.vin.length} inputs and ${total} outputs, consistent with a WabiSabi (Wasabi Wallet 2.0) CoinJoin. `
          : "") +
        `${count} of ${total} outputs have the same value (${formatBtc(denomination)}). ` +
        "This pattern is characteristic of collaborative CoinJoin transactions that break the " +
        "link between inputs and outputs, significantly improving privacy.",
      recommendation:
        (isWabiSabi
          ? "WabiSabi CoinJoins provide excellent privacy through large anonymity sets and multiple denomination tiers. Continue using CoinJoin for maximum privacy. "
          : "CoinJoin is a strong privacy technique. For maximum benefit, ensure you are using a reputable CoinJoin coordinator and consider multiple rounds. ") +
        EXCHANGE_WARNING,
      scoreImpact: impact,
    });
  }

  // Check for JoinMarket pattern: small-scale CoinJoin with maker/taker model
  // Only check if no other CoinJoin was detected
  if (findings.length === 0) {
    const joinmarket = detectJoinMarket(tx.vin, spendableOutputs);
    if (joinmarket) {
      findings.push({
        id: "h4-joinmarket",
        severity: "good",
        title: `Likely JoinMarket CoinJoin: ${joinmarket.equalCount} equal outputs of ${formatBtc(joinmarket.denomination)}`,
        params: { count: joinmarket.equalCount, denomination: formatBtc(joinmarket.denomination), vin: tx.vin.length, vout: spendableOutputs.length },
        description:
          `This transaction has ${tx.vin.length} inputs from ${joinmarket.distinctInputAddresses} distinct addresses and ` +
          `${joinmarket.equalCount} outputs with the same value (${formatBtc(joinmarket.denomination)}), ` +
          "consistent with a JoinMarket CoinJoin using the maker/taker model. " +
          "JoinMarket provides privacy by combining inputs from multiple participants into a single transaction, " +
          "making it difficult to determine which input funded which output.",
        recommendation:
          "JoinMarket provides good privacy through its decentralized maker/taker model. " +
          "For stronger privacy, consider multiple rounds of mixing. " +
          EXCHANGE_WARNING,
        scoreImpact: 15,
      });
    }
  }

  // Check for Stonewall pattern: steganographic CoinJoin (Samourai Wallet)
  // Only check if no other CoinJoin was detected
  if (findings.length === 0) {
    const stonewall = detectStonewall(tx.vin, spendableOutputs);
    if (stonewall) {
      findings.push({
        id: "h4-stonewall",
        severity: "good",
        title: `Possible Stonewall: 2 equal outputs of ${formatBtc(stonewall.denomination)}`,
        params: {
          denomination: formatBtc(stonewall.denomination),
          distinctAddresses: stonewall.distinctInputAddresses,
        },
        description:
          `This transaction matches the Stonewall pattern: ${tx.vin.length} inputs from ${stonewall.distinctInputAddresses} distinct address${stonewall.distinctInputAddresses > 1 ? "es" : ""}, ` +
          `4 outputs with 2 equal values (${formatBtc(stonewall.denomination)}). ` +
          "Stonewall creates genuine ambiguity: an observer cannot tell if this is a single-wallet Stonewall or a two-wallet STONEWALLx2. " +
          "The 2 equal outputs make the payment amount ambiguous, and each change output could belong to either party.",
        recommendation:
          "Stonewall transactions provide real privacy by creating doubt about the payment amount and fund ownership. " +
          "For stronger privacy, combine with Whirlpool mixing before spending. " +
          EXCHANGE_WARNING,
        scoreImpact: 15,
      });
    }
  }

  // If any CoinJoin was detected, add an informational warning about exchange flagging risks
  if (findings.length > 0) {
    findings.push({
      id: "h4-exchange-flagging",
      severity: "low",
      title: "Exchanges may flag this transaction",
      description:
        "Multiple centralized exchanges are documented to flag or freeze accounts associated with CoinJoin transactions. " +
        "Some exchanges retroactively flag CoinJoin usage months or years after the fact. " +
        "In documented cases, Bitstamp flagged CoinJoins years later, BitMEX flagged accounts months after withdrawal to a mixer, " +
        "and BlockFi closed a user's collateral loan because the deposited coins had CoinJoin history from a previous owner " +
        "(the user had never mixed coins themselves). " +
        "This is based on publicly documented incidents and is not an exhaustive list of exchange behavior.",
      recommendation:
        "Do not deposit CoinJoin outputs directly to a centralized exchange. " +
        "Use decentralized, non-custodial exchanges (Bisq, RoboSats, Hodl Hodl) that do not apply chain surveillance. " +
        "Maintain strict separation between privacy wallets and exchange wallets.",
      scoreImpact: 0,
    });
  }

  return { findings };
};

/** Set of finding IDs that identify CoinJoin transactions. */
const COINJOIN_FINDING_IDS = new Set([
  "h4-whirlpool", "h4-coinjoin", "h4-joinmarket", "h4-stonewall",
]);

/** Check if a finding indicates a positive CoinJoin detection. */
export function isCoinJoinFinding(f: Finding): boolean {
  return COINJOIN_FINDING_IDS.has(f.id) && f.scoreImpact > 0;
}

function detectWhirlpool(values: number[]): { denomination: number } | null {
  // Whirlpool mix txs have exactly 5 equal outputs at a known denomination.
  // Allow up to 6 total to account for a possible OP_RETURN marker.
  // (Coordinator fees are in the separate TX0 premix transaction, not in the mix.)
  if (values.length < 5 || values.length > 6) return null;

  for (const denom of WHIRLPOOL_DENOMS) {
    const matchCount = values.filter((v) => v === denom).length;
    if (matchCount === 5) {
      return { denomination: denom };
    }
  }
  return null;
}

function detectEqualOutputs(
  values: number[],
): { count: number; denomination: number; total: number } | null {
  // Count occurrences of each output value
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  // Find the most common value with 5+ occurrences
  // (3 equal outputs is too weak - exchange batched withdrawals and payroll
  // transactions routinely produce 3-4 equal outputs)
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

function detectJoinMarket(
  vin: Parameters<typeof analyzeCoinJoin>[0]["vin"],
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
  const counts = new Map<number, number>();
  for (const o of spendableOutputs) {
    counts.set(o.value, (counts.get(o.value) ?? 0) + 1);
  }

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
  if (bestValue < 10_000) return null;

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

function detectStonewall(
  vin: Parameters<typeof analyzeCoinJoin>[0]["vin"],
  spendableOutputs: { value: number; scriptpubkey_address?: string }[],
): { denomination: number; distinctInputAddresses: number } | null {
  // Stonewall: 2-3 inputs, exactly 4 spendable outputs (2 equal + 2 change)
  // This is a steganographic transaction designed to look like a normal payment.
  if (vin.length < 2 || vin.length > 3) return null;
  if (spendableOutputs.length !== 4) return null;

  // Count output values
  const counts = new Map<number, number>();
  for (const o of spendableOutputs) {
    counts.set(o.value, (counts.get(o.value) ?? 0) + 1);
  }

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
  if (equalValue < 10_000) return null;

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
  };
}

function formatBtc(sats: number): string {
  return `${(sats / 100_000_000).toFixed(8).replace(/\.?0+$/, "")} BTC`;
}
