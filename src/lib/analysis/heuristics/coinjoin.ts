import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";
import { formatBtc } from "@/lib/format";
import { getSpendableOutputs } from "./tx-utils";

const EXCHANGE_WARNING =
  "Centralized exchanges including Binance, Coinbase, Gemini, Bitstamp, Swan Bitcoin, Bitvavo, Bitfinex, and BitMEX " +
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
  const spendableOutputs = getSpendableOutputs(tx.vout);
  const whirlpool = detectWhirlpool(spendableOutputs.map((o) => o.value));
  if (whirlpool) {
    findings.push({
      id: "h4-whirlpool",
      severity: "good",
      confidence: "deterministic",
      title: `Whirlpool CoinJoin detected (${formatBtc(whirlpool.denomination)} pool)`,
      params: { denom: formatBtc(whirlpool.denomination) },
      description:
        "This transaction matches the Whirlpool CoinJoin pattern: 5, 8, or 9 equal outputs at a standard denomination. " +
        "Whirlpool provides strong forward-looking privacy by breaking deterministic transaction links. " +
        "Note: since the Samourai Wallet seizure (April 2024), Whirlpool no longer uses a centralized coordinator. " +
        "Ashigaru implements decentralized Whirlpool coordination.",
      recommendation:
        "Whirlpool is one of the strongest CoinJoin implementations. Make sure to also remix (multiple rounds) for maximum privacy. " +
        EXCHANGE_WARNING,
      scoreImpact: 30,
    });
    return { findings };
  }

  // Check for WabiSabi / Wasabi pattern (many inputs, many outputs)
  // WabiSabi rounds can have as few as ~10 participants; requiring both
  // inputs >= 10 AND outputs >= 10 avoids exchange batch withdrawal false
  // positives (those typically have 1-3 inputs with many outputs)
  const isWabiSabi = tx.vin.length >= 10 && spendableOutputs.length >= 10;

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
        confidence: "high",
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

    // Count denomination tiers (groups with 2+ equal outputs) to distinguish
    // JoinMarket (single tier + change) from WabiSabi (multiple tiers).
    const allOutputCounts = new Map<number, number>();
    for (const o of spendableOutputs) {
      allOutputCounts.set(o.value, (allOutputCounts.get(o.value) ?? 0) + 1);
    }
    const denomTiers = [...allOutputCounts.entries()].filter(([, c]) => c >= 2);
    // JoinMarket: one dominant denomination tier. Secondary tiers from coincidental
    // equal change amounts don't disqualify - only the primary tier matters.
    // WabiSabi has many tiers of intentionally similar size.
    const isDominantSingleDenom = denomTiers.length === 1 ||
      (denomTiers.length >= 2 && count >= 2 * denomTiers.filter(([v]) => v !== denomination).reduce((sum, [, c]) => sum + c, 0));

    if (isDominantSingleDenom && isWabiSabi && count < total) {
      // Large JoinMarket CoinJoin: 10+ in/out, single denomination + change outputs.
      // JoinMarket uses one denomination for all mixing participants.
      // WabiSabi uses multiple denomination tiers - that path is handled below.
      // Require count < total so all-equal-output CoinJoins stay generic.
      const changeCount = spendableOutputs.filter((o) => o.value !== denomination).length;
      const isChangeless = changeCount === 0;

      // Verify equal outputs go to distinct addresses
      const equalAddresses = new Set<string>();
      for (const o of spendableOutputs) {
        if (o.value === denomination && o.scriptpubkey_address) {
          equalAddresses.add(o.scriptpubkey_address);
        }
      }

      findings.push({
        id: "h4-joinmarket",
        severity: "good",
        confidence: equalAddresses.size >= count ? "high" : "medium",
        title: `JoinMarket CoinJoin: ${count} equal outputs of ${formatBtc(denomination)}`,
        params: {
          count,
          denomination: formatBtc(denomination),
          vin: tx.vin.length,
          vout: total,
          takerChangeIdentifiable: isChangeless ? 0 : 1,
          takerChangeCount: changeCount,
        },
        description:
          `This transaction has ${tx.vin.length} inputs and ${total} outputs with ${count} outputs at the same value (${formatBtc(denomination)}), ` +
          "consistent with a JoinMarket CoinJoin. Unlike Whirlpool (fixed pool sizes) or WabiSabi (multiple denomination tiers), " +
          "JoinMarket uses a single arbitrary denomination chosen by the taker, with separate change outputs for each maker and the taker. " +
          (isChangeless
            ? "This is a changeless CoinJoin - no participant change is identifiable, providing stronger privacy. "
            : `The ${changeCount} change output${changeCount > 1 ? "s are" : " is"} trivially linkable to specific inputs via subset-sum analysis, ` +
              "since the taker pays an on-chain fee to makers. An observer can match each change to its corresponding input by finding which input subsets produce the denomination plus change. ") +
          `The anonymity set is ${count} (the number of equal outputs), which is lower than typical Whirlpool (5 per round) or WabiSabi (50+) CoinJoins.`,
        recommendation:
          "JoinMarket provides privacy through its decentralized maker/taker model, but has known weaknesses: " +
          "change outputs are vulnerable to subset-sum analysis (CoinJoin Sudoku), and the single denomination makes the transaction pattern identifiable. " +
          (isChangeless
            ? "This changeless CoinJoin avoids subset-sum linkage - the ideal pattern. "
            : "Never consolidate change outputs with mixed outputs - this undoes the mixing. ") +
          "For stronger privacy, consider multiple rounds of mixing or using Whirlpool/WabiSabi which avoid on-chain fee leakage. " +
          EXCHANGE_WARNING,
        scoreImpact: count >= 10 ? 25 : 20,
      });
    } else {
      // Multiple denomination tiers = WabiSabi, or non-large generic CoinJoin
      const impact = count >= 10 ? 25 : count >= 5 ? 20 : 15;

      const label = isWabiSabi
        ? `WabiSabi CoinJoin: ${count} equal outputs across ${total} total`
        : `Likely CoinJoin: ${count} equal outputs of ${formatBtc(denomination)}`;

      findings.push({
        id: "h4-coinjoin",
        severity: "good",
        confidence: "high",
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
  }

  // Check for Stonewall pattern: steganographic CoinJoin (Samourai/Ashigaru Wallet)
  // Stonewall is the most specific small CoinJoin pattern (exactly 4 outputs,
  // 2-4 inputs, 1 equal pair + 2 distinct change) and must be checked before
  // JoinMarket to avoid misattribution.
  // NOTE: Solo Stonewall vs STONEWALLx2 cannot be reliably distinguished on-chain.
  // That ambiguity IS the privacy feature. We report a single finding.
  if (findings.length === 0) {
    const stonewall = detectStonewall(tx.vin, spendableOutputs);
    if (stonewall) {
      const isSolo = stonewall.distinctInputAddresses === 1;
      const whirlpoolBonus = stonewall.whirlpoolOrigin ? 10 : 0;
      const whirlpoolContext = stonewall.whirlpoolOrigin
        ? ` All ${tx.vin.length} inputs are Whirlpool pool outputs, indicating this is a post-CoinJoin spend - the ideal pattern for forward privacy.`
        : "";

      // Historical context: Samourai Wallet was seized April 24, 2024.
      // Sparrow supported Stonewall before the seizure but removed it after.
      // After April 2024, Stonewall txs are almost certainly from Ashigaru.
      const SAMOURAI_SEIZURE_TS = 1713916800; // 2024-04-24T00:00:00Z
      const txTime = tx.status?.block_time;
      const isPostSeizure = txTime ? txTime >= SAMOURAI_SEIZURE_TS : false;
      const historicalNote = txTime
        ? isPostSeizure
          ? " This transaction was confirmed after the Samourai Wallet seizure (April 2024). " +
            "Sparrow removed Stonewall support after that date, so this was likely created with Ashigaru."
          : " This transaction predates the Samourai seizure (April 2024), so it could have been created " +
            "with Samourai Wallet, Sparrow, or another compatible wallet."
        : "";
      findings.push({
        id: "h4-stonewall",
        severity: "good",
        confidence: stonewall.whirlpoolOrigin ? "high" : "medium",
        title: stonewall.whirlpoolOrigin
          ? `Stonewall from Whirlpool: ${tx.vin.length} mixed inputs, 2 equal outputs of ${formatBtc(stonewall.denomination)}`
          : `Possible Stonewall: 2 equal outputs of ${formatBtc(stonewall.denomination)}`,
        params: {
          denomination: formatBtc(stonewall.denomination),
          distinctAddresses: stonewall.distinctInputAddresses,
          whirlpoolOrigin: stonewall.whirlpoolOrigin ? 1 : 0,
        },
        description:
          `This transaction matches the Stonewall pattern: ${tx.vin.length} inputs from ${stonewall.distinctInputAddresses} distinct address${stonewall.distinctInputAddresses > 1 ? "es" : ""}, ` +
          `4 outputs with 2 equal values (${formatBtc(stonewall.denomination)}). ` +
          "Stonewall creates genuine ambiguity: an observer cannot tell if this is a single-wallet Stonewall or a two-wallet STONEWALLx2. " +
          "The 2 equal outputs make the payment amount ambiguous, and each change output could belong to either party." +
          whirlpoolContext +
          historicalNote,
        recommendation:
          stonewall.whirlpoolOrigin
            ? "Excellent spending pattern: Stonewall from Whirlpool provides strong forward privacy. " +
              "The critical post-transaction rule: never spend two outputs from this transaction together."
            : "Stonewall provides real privacy by creating ambiguity. " +
              "The critical post-transaction rule: never spend two outputs from this transaction together. " +
              "Treat each output as belonging to a separate wallet.",
        scoreImpact: 15 + whirlpoolBonus,
        remediation: {
          keyPrefix: isSolo ? "h4-stonewall-solo" : "h4-stonewall-x2",
          qualifier: isSolo
            ? "Likely solo Stonewall: all inputs appear to come from one wallet. The sender controls 3 of 4 outputs (1 decoy + 2 change)."
            : "Possible STONEWALLx2: inputs came from 2+ addresses. Each party must manage their outputs independently.",
          steps: isSolo
            ? [
                "Never spend two outputs from this transaction together - doing so reveals that you control both, breaking Stonewall ambiguity.",
                "Use coin control to label each output and track them separately.",
                "When spending change outputs, avoid co-spending with other UTXOs linked to this transaction's inputs.",
                "For stronger forward privacy, mix change outputs through Whirlpool before spending.",
              ]
            : [
                "Never spend two outputs from this transaction together - the sender's change and the collaborator's outputs must remain independent.",
                "If you are the collaborator, keep your equal-valued output and change output strictly separated. Spending them together reveals which equal-valued output is the real payment.",
                "Use coin control to label and isolate each output from this transaction.",
                "For stronger forward privacy, mix change outputs through Whirlpool before spending.",
              ],
          tools: [
            { name: "Ashigaru (Stonewall/STONEWALLx2)", url: "https://ashigaru.rs" },
            { name: "Sparrow Wallet (Coin Control)", url: "https://sparrowwallet.com" },
          ],
          urgency: "when-convenient" as const,
        },
      });
    }
  }

  // Check for simplified Stonewall: 3 outputs where 2 have equal value + 1 change.
  // Manual version when full STONEWALL conditions aren't met.
  if (findings.length === 0) {
    const simplified = detectSimplifiedStonewall(tx.vin, spendableOutputs);
    if (simplified) {
      findings.push({
        id: "h4-simplified-stonewall",
        severity: "good",
        confidence: "medium",
        title: `Simplified Stonewall: 2 equal outputs of ${formatBtc(simplified.denomination)} + change`,
        params: {
          denomination: formatBtc(simplified.denomination),
        },
        description:
          `This transaction has 3 outputs: 2 equal-value outputs (${formatBtc(simplified.denomination)}) and 1 change output. ` +
          "This is a simplified Stonewall - a manual decoy technique where the sender creates " +
          "a second output of the same amount to create ambiguity about which is the real payment.",
        recommendation:
          "Simplified Stonewall provides basic ambiguity but is weaker than a full Stonewall. " +
          "When possible, use Ashigaru's built-in Stonewall for stronger privacy guarantees.",
        scoreImpact: 5,
        remediation: {
          steps: [
            "Never spend the decoy output alongside other UTXOs linked to this transaction's inputs.",
            "Use coin control to label the decoy and change outputs separately.",
            "Consider using Ashigaru's full Stonewall feature for stronger privacy in future transactions.",
          ],
          tools: [
            { name: "Ashigaru (Stonewall)", url: "https://ashigaru.rs" },
            { name: "Sparrow Wallet (Coin Control)", url: "https://sparrowwallet.com" },
          ],
          urgency: "when-convenient" as const,
        },
      });
    }
  }

  // Check for JoinMarket pattern: small-scale CoinJoin with maker/taker model
  // Only check if no other CoinJoin was detected (Stonewall already checked above)
  if (findings.length === 0) {
    const joinmarket = detectJoinMarket(tx.vin, spendableOutputs);
    if (joinmarket) {
      // Identify taker's change output: non-equal-value outputs that don't match the denomination
      const takerChangeOutputs = spendableOutputs.filter((o) => o.value !== joinmarket.denomination);
      const takerChangeCount = takerChangeOutputs.length;
      const isChangeless = takerChangeCount === 0;
      const takerNote = isChangeless
        ? " This is a changeless JoinMarket CoinJoin - the taker's change is not identifiable, providing stronger privacy."
        : ` The ${takerChangeCount} non-equal output${takerChangeCount > 1 ? "s are" : " is"} likely the taker's change, which is linked to the taker's identity.`;

      findings.push({
        id: "h4-joinmarket",
        severity: "good",
        confidence: "medium",
        title: `Likely JoinMarket CoinJoin: ${joinmarket.equalCount} equal outputs of ${formatBtc(joinmarket.denomination)}`,
        params: {
          count: joinmarket.equalCount,
          denomination: formatBtc(joinmarket.denomination),
          vin: tx.vin.length,
          vout: spendableOutputs.length,
          takerChangeIdentifiable: isChangeless ? 0 : 1,
          takerChangeCount,
        },
        description:
          `This transaction has ${tx.vin.length} inputs from ${joinmarket.distinctInputAddresses} distinct addresses and ` +
          `${joinmarket.equalCount} outputs with the same value (${formatBtc(joinmarket.denomination)}), ` +
          "consistent with a JoinMarket CoinJoin using the maker/taker model. " +
          "Unlike Whirlpool or WabiSabi, JoinMarket uses a single arbitrary denomination chosen by the taker, " +
          "and the taker pays an on-chain fee to makers - making change outputs vulnerable to subset-sum analysis (CoinJoin Sudoku)." +
          takerNote +
          ` The anonymity set is ${joinmarket.equalCount} (the number of equal outputs).`,
        recommendation:
          "JoinMarket provides privacy through its decentralized maker/taker model, but has known weaknesses: " +
          "change outputs are vulnerable to subset-sum analysis, and the single denomination makes the pattern identifiable. " +
          (isChangeless
            ? "This changeless CoinJoin avoids subset-sum linkage - the ideal pattern. "
            : "The taker's change output should be managed carefully - never consolidate it with other mixed outputs. ") +
          "For stronger privacy, consider multiple rounds of mixing or protocols that avoid on-chain fee leakage (Whirlpool, WabiSabi). " +
          EXCHANGE_WARNING,
        scoreImpact: isChangeless ? 20 : 15,
      });
    }
  }

  // If any CoinJoin was detected, add an informational warning about exchange flagging risks.
  // Skip for Stonewall-only: Stonewall is steganographic (designed to look like a normal payment),
  // so exchange flagging is unlikely and the warning would be misleading.
  // Stonewall is steganographic (designed to look like a normal payment),
  // so exchange flagging warnings would be misleading.
  const isStonewallOnly = findings.length === 1 && (
    findings[0].id === "h4-stonewall" ||
    findings[0].id === "h4-simplified-stonewall"
  );
  if (findings.length > 0 && !isStonewallOnly) {
    findings.push({
      id: "h4-exchange-flagging",
      severity: "low",
      confidence: "medium",
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
  "h4-whirlpool", "h4-coinjoin", "h4-joinmarket", "h4-stonewall", "h4-simplified-stonewall",
]);

/** Check if a finding indicates a positive CoinJoin detection. */
export function isCoinJoinFinding(f: Finding): boolean {
  return COINJOIN_FINDING_IDS.has(f.id) && f.scoreImpact > 0;
}

function detectWhirlpool(values: number[]): { denomination: number } | null {
  // Whirlpool mix txs have 5+ equal outputs at a known denomination.
  // Classic: exactly 5 equal outputs (5-6 total with optional OP_RETURN).
  // Post-Sparrow 1.7.6: 8 or 9 equal outputs at the same denominations.
  // Coordinator fees are in the separate TX0 premix transaction, not in the mix.
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
): { denomination: number; distinctInputAddresses: number; whirlpoolOrigin: boolean } | null {
  // Stonewall: typically 2-4 inputs, exactly 4 spendable outputs (2 equal + 2 change)
  // Solo Stonewall typically has 2-3 inputs from one wallet.
  // STONEWALLx2 can have up to 4 inputs (2 from each party).
  // Exception: Stonewall from Whirlpool can have many more inputs (all at the
  // same Whirlpool denomination), e.g. 12 inputs at 0.5 BTC each.
  if (vin.length < 2) return null;
  if (spendableOutputs.length !== 4) return null;

  // Check if all inputs share a Whirlpool denomination (Stonewall from Whirlpool).
  // Only flag as Whirlpool-origin when there are 5+ inputs at the same Whirlpool
  // denomination - with 2-4 inputs, coincidental matches are possible.
  const inputValues = vin.map((v) => v.prevout?.value).filter((v): v is number => v != null);
  const allSameValue = inputValues.length >= 2 && inputValues.every((v) => v === inputValues[0]);
  const isWhirlpoolOrigin = allSameValue && inputValues.length >= 5 && WHIRLPOOL_DENOMS.includes(inputValues[0]);

  // Standard Stonewall: 2-4 inputs. Allow more only for Whirlpool-origin.
  if (vin.length > 4 && !isWhirlpoolOrigin) return null;

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
    whirlpoolOrigin: isWhirlpoolOrigin,
  };
}

function detectSimplifiedStonewall(
  vin: Parameters<typeof analyzeCoinJoin>[0]["vin"],
  spendableOutputs: { value: number; scriptpubkey_address?: string }[],
): { denomination: number } | null {
  // Simplified Stonewall: 2+ inputs, exactly 3 spendable outputs
  // 2 outputs with equal value (payment + decoy) + 1 change
  // Real Stonewall always has 2+ inputs (wallet constructs a self-spend structure)
  if (spendableOutputs.length !== 3) return null;
  if (vin.length < 2) return null;

  // Count output values - need exactly 1 pair
  const counts = new Map<number, number>();
  for (const o of spendableOutputs) {
    counts.set(o.value, (counts.get(o.value) ?? 0) + 1);
  }

  // counts.size === 2 means: one value twice + one value once
  if (counts.size !== 2) return null;

  let equalValue = 0;
  for (const [value, count] of counts) {
    if (count === 2) equalValue = value;
  }
  if (equalValue === 0) return null;

  // Skip dust amounts and Whirlpool denominations
  if (equalValue < 10_000) return null;
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

