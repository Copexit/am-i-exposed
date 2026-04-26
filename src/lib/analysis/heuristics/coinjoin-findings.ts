/**
 * Finding builders for H4: CoinJoin Detection.
 *
 * Extracted from coinjoin.ts to reduce file size. Each function builds
 * the full Finding object for a specific CoinJoin detection pattern.
 */

import type { Finding } from "@/lib/types";
import { formatBtc } from "@/lib/format";
import { SAMOURAI_SEIZURE_TS, ASHIGARU_LAUNCH_TS, type WhirlpoolPool } from "@/lib/constants";

const EXCHANGE_WARNING =
  "Centralized exchanges including Binance, Coinbase, Gemini, Bitstamp, Swan Bitcoin, Bitvavo, Bitfinex, and BitMEX " +
  "have been documented flagging, freezing, or closing accounts for CoinJoin-associated deposits. " +
  "This list is not exhaustive - other exchanges may have similar policies. " +
  "Some exchanges retroactively flag CoinJoin activity months or years after the transaction. " +
  "For safe off-ramping, consider decentralized alternatives like Bisq, RoboSats, or Hodl Hodl that do not apply chain surveillance.";

export function buildWhirlpoolFinding(pool: WhirlpoolPool, txTime: number | undefined): Finding {
  const denom = formatBtc(pool.sats);
  const isSamourai = pool.era === "samourai";
  const eraLabel = isSamourai ? "Samourai-era" : "Ashigaru";

  const eraSentence = isSamourai
    ? `The ${denom} denomination is a Samourai-era pool size (active 2019 - April 2024). ` +
      "This was almost certainly created with Samourai Wallet, Sparrow, or another Whirlpool-compatible client " +
      "while the original coordinator was operational."
    : `The ${denom} denomination is an Ashigaru pool size (introduced June 2025). ` +
      "This was created with Ashigaru Terminal using the decentralized ZeroLink coordinator.";

  let temporalNote = "";
  if (txTime !== undefined) {
    if (isSamourai && txTime > SAMOURAI_SEIZURE_TS) {
      temporalNote =
        " Note: this transaction was confirmed after the April 2024 Samourai seizure, " +
        "when the original coordinator was offline. It may be from a privately-run or forked coordinator, " +
        "an offline Sparrow mix, or another unusual case worth investigating.";
    } else if (!isSamourai && txTime < ASHIGARU_LAUNCH_TS) {
      temporalNote =
        " Note: this transaction was confirmed before the Ashigaru Whirlpool launch (June 2025), " +
        "which is unexpected for this denomination - check the timestamp source.";
    }
  }

  return {
    id: "h4-whirlpool",
    severity: "good",
    confidence: "deterministic",
    title: `Whirlpool CoinJoin detected (${denom} ${eraLabel} pool)`,
    params: { denom, era: pool.era, _variant: pool.era },
    description:
      "This transaction matches the Whirlpool CoinJoin pattern: 5, 8, or 9 equal outputs at a standard denomination. " +
      "Whirlpool provides strong forward-looking privacy by breaking deterministic transaction links. " +
      eraSentence +
      temporalNote,
    recommendation:
      "Whirlpool is one of the strongest CoinJoin implementations. Make sure to also remix (multiple rounds) for maximum privacy. " +
      EXCHANGE_WARNING,
    scoreImpact: 30,
  };
}

export function buildWabiSabiMultiTierFinding(
  vinCount: number,
  voutCount: number,
  groupCount: number,
  totalEqual: number,
): Finding {
  const impact = totalEqual >= 20 ? 25 : 20;
  return {
    id: "h4-coinjoin",
    severity: "good",
    confidence: "high",
    title: `WabiSabi CoinJoin: ${groupCount} denomination tiers, ${totalEqual} equal outputs across ${voutCount} total`,
    params: { groups: groupCount, totalEqual, vout: voutCount, vin: vinCount, isWabiSabi: 1 },
    description:
      `This transaction has ${vinCount} inputs and ${voutCount} outputs with ${groupCount} groups of equal-value outputs, ` +
      "consistent with a WabiSabi (Wasabi Wallet 2.0) CoinJoin using multiple denomination tiers. " +
      "This pattern breaks the link between inputs and outputs, significantly improving privacy.",
    recommendation:
      "WabiSabi CoinJoins provide excellent privacy through large anonymity sets and multiple denomination tiers. Continue using CoinJoin for maximum privacy. " +
      EXCHANGE_WARNING,
    scoreImpact: impact,
  };
}

export function buildJoinMarketFinding(
  count: number,
  denomination: number,
  vinCount: number,
  total: number,
  changeCount: number,
  isChangeless: boolean,
  confidence: Finding["confidence"],
): Finding {
  return {
    id: "h4-joinmarket",
    severity: "good",
    confidence,
    title: `JoinMarket CoinJoin: ${count} equal outputs of ${formatBtc(denomination)}`,
    params: {
      count,
      denomination: formatBtc(denomination),
      vin: vinCount,
      vout: total,
      takerChangeIdentifiable: isChangeless ? 0 : 1,
      takerChangeCount: changeCount,
    },
    description:
      `This transaction has ${vinCount} inputs and ${total} outputs with ${count} outputs at the same value (${formatBtc(denomination)}), ` +
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
  };
}

export function buildGenericCoinJoinFinding(
  count: number,
  denomination: number,
  total: number,
  vinCount: number,
  isActualWabiSabi: boolean,
): Finding {
  const impact = count >= 10 ? 25 : count >= 5 ? 20 : 15;
  const label = isActualWabiSabi
    ? `WabiSabi CoinJoin: ${count} equal outputs across ${total} total`
    : `Likely CoinJoin: ${count} equal outputs of ${formatBtc(denomination)}`;

  return {
    id: "h4-coinjoin",
    severity: "good",
    confidence: "high",
    title: label,
    params: { count, denomination: formatBtc(denomination), total, vin: vinCount, isWabiSabi: isActualWabiSabi ? 1 : 0 },
    description:
      (isActualWabiSabi
        ? `This transaction has ${vinCount} inputs and ${total} outputs, consistent with a WabiSabi (Wasabi Wallet 2.0) CoinJoin. `
        : "") +
      `${count} of ${total} outputs have the same value (${formatBtc(denomination)}). ` +
      "This pattern is characteristic of collaborative CoinJoin transactions that break the " +
      "link between inputs and outputs, significantly improving privacy.",
    recommendation:
      (isActualWabiSabi
        ? "WabiSabi CoinJoins provide excellent privacy through large anonymity sets and multiple denomination tiers. Continue using CoinJoin for maximum privacy. "
        : "CoinJoin is a strong privacy technique. For maximum benefit, ensure you are using a reputable CoinJoin coordinator and consider multiple rounds. ") +
      EXCHANGE_WARNING,
    scoreImpact: impact,
  };
}

export function buildStonewallFinding(
  stonewall: { denomination: number; distinctInputAddresses: number; whirlpoolOrigin: boolean },
  vinCount: number,
  txTime: number | undefined,
): Finding {
  const isSolo = stonewall.distinctInputAddresses === 1;
  const whirlpoolBonus = stonewall.whirlpoolOrigin ? 10 : 0;
  const whirlpoolContext = stonewall.whirlpoolOrigin
    ? ` All ${vinCount} inputs are Whirlpool pool outputs, indicating this is a post-CoinJoin spend - the ideal pattern for forward privacy.`
    : "";

  const isPostSeizure = txTime ? txTime >= SAMOURAI_SEIZURE_TS : false;
  const historicalNote = txTime
    ? isPostSeizure
      ? " This transaction was confirmed after the Samourai Wallet seizure (April 2024). " +
        "Sparrow removed Stonewall support after that date, so this was likely created with Ashigaru."
      : " This transaction predates the Samourai seizure (April 2024), so it could have been created " +
        "with Samourai Wallet, Sparrow, or another compatible wallet."
    : "";

  return {
    id: "h4-stonewall",
    severity: "good",
    confidence: stonewall.whirlpoolOrigin ? "high" : "medium",
    title: stonewall.whirlpoolOrigin
      ? `Stonewall from Whirlpool: ${vinCount} mixed inputs, 2 equal outputs of ${formatBtc(stonewall.denomination)}`
      : `Possible Stonewall: 2 equal outputs of ${formatBtc(stonewall.denomination)}`,
    params: {
      denomination: formatBtc(stonewall.denomination),
      distinctAddresses: stonewall.distinctInputAddresses,
      whirlpoolOrigin: stonewall.whirlpoolOrigin ? 1 : 0,
    },
    description:
      `This transaction matches the Stonewall pattern: ${vinCount} inputs from ${stonewall.distinctInputAddresses} distinct address${stonewall.distinctInputAddresses > 1 ? "es" : ""}, ` +
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
  };
}

export function buildSimplifiedStonewallFinding(denomination: number): Finding {
  return {
    id: "h4-simplified-stonewall",
    severity: "good",
    confidence: "medium",
    title: `Simplified Stonewall: 2 equal outputs of ${formatBtc(denomination)} + change`,
    params: { denomination: formatBtc(denomination) },
    description:
      `This transaction has 3 outputs: 2 equal-value outputs (${formatBtc(denomination)}) and 1 change output. ` +
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
  };
}

export function buildSmallJoinMarketFinding(
  joinmarket: { equalCount: number; denomination: number; distinctInputAddresses: number },
  vinCount: number,
  spendableCount: number,
  takerChangeCount: number,
  isChangeless: boolean,
): Finding {
  const takerNote = isChangeless
    ? " This is a changeless JoinMarket CoinJoin - the taker's change is not identifiable, providing stronger privacy."
    : ` The ${takerChangeCount} non-equal output${takerChangeCount > 1 ? "s are" : " is"} likely the taker's change, which is linked to the taker's identity.`;

  return {
    id: "h4-joinmarket",
    severity: "good",
    confidence: "medium",
    title: `Likely JoinMarket CoinJoin: ${joinmarket.equalCount} equal outputs of ${formatBtc(joinmarket.denomination)}`,
    params: {
      count: joinmarket.equalCount,
      denomination: formatBtc(joinmarket.denomination),
      vin: vinCount,
      vout: spendableCount,
      takerChangeIdentifiable: isChangeless ? 0 : 1,
      takerChangeCount,
    },
    description:
      `This transaction has ${vinCount} inputs from ${joinmarket.distinctInputAddresses} distinct addresses and ` +
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
  };
}

export function buildExchangeFlaggingFinding(): Finding {
  return {
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
  };
}
