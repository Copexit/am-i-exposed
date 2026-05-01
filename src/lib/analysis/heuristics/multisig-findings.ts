/**
 * Finding builders for H17: Multisig/Escrow Detection.
 *
 * Extracted from multisig-detection.ts to reduce file size. Each function
 * builds the full Finding object for a specific detection pattern.
 */

import type { Finding } from "@/lib/types";

const P2P_TOOLS: { name: string; url: string }[] = [
  { name: "RoboSats (Lightning P2P)", url: "https://learn.robosats.org" },
  { name: "Sparrow Wallet (CoinJoin)", url: "https://sparrowwallet.com" },
];

const COIN_CONTROL_TOOLS: { name: string; url: string }[] = [
  { name: "RoboSats (Lightning P2P)", url: "https://learn.robosats.org" },
  { name: "Sparrow Wallet (Coin Control)", url: "https://sparrowwallet.com" },
];

export function buildBisqDepositFinding(
  inputCount: number,
  outputCount: number,
  contractHash: string,
): Finding {
  return {
    id: "h17-bisq-deposit",
    severity: "high",
    confidence: "high",
    title: "Bisq escrow deposit detected (OP_RETURN contract hash)",
    params: { inputCount, outputCount, contractHash },
    description:
      "This transaction matches the Bisq P2P exchange deposit pattern: multiple inputs " +
      "(from both traders) funding a 2-of-2 multisig escrow address, with a 20-byte " +
      "OP_RETURN contract hash that cryptographically commits both parties to the trade. " +
      "This pattern is highly specific to Bisq and is not used by other common services.",
    recommendation:
      "Bisq deposit transactions are identifiable on-chain due to the OP_RETURN contract " +
      "hash and 2-of-2 multisig output. For more private P2P trading, consider protocols " +
      "that do not leave distinctive on-chain fingerprints.",
    scoreImpact: -3,
    remediation: {
      steps: [
        "The Bisq deposit fingerprint (OP_RETURN + multisig) cannot be undone for this transaction.",
        "Use CoinJoin before funding Bisq trades to reduce linkability to your other UTXOs.",
        "For future trades, consider Lightning-based P2P exchanges (RoboSats) which leave no on-chain escrow footprint.",
      ],
      tools: P2P_TOOLS,
      urgency: "when-convenient",
    },
  };
}

export function buildHodlHodlAddressFinding(
  scriptType: string,
  feeAddress: string,
  feeAmount: number,
): Finding {
  return {
    id: "h17-hodlhodl",
    severity: "high",
    confidence: "high",
    title: "Likely HodlHodl escrow release (2-of-3 multisig)",
    params: { m: 2, n: 3, scriptType, feeAddress, feeAmount },
    description:
      "This transaction matches the HodlHodl P2P exchange pattern: a 2-of-3 multisig input " +
      "with a small fee output to a known HodlHodl fee address. This identifies the transaction " +
      "as a P2P exchange escrow release with high confidence. The multisig structure reveals " +
      "that three parties (buyer, seller, arbitrator) were involved in custody.",
    recommendation:
      "HodlHodl escrow transactions are identifiable on-chain due to the 2-of-3 multisig structure " +
      "and reused fee address. For more private P2P trading, consider protocols that use " +
      "Taproot-based escrow or Lightning-based settlement (e.g., RoboSats).",
    scoreImpact: -3,
    remediation: {
      steps: [
        "The 2-of-3 multisig structure and fee address pattern cannot be undone for this transaction.",
        "For future P2P trades, consider Lightning-based exchanges (RoboSats) which leave no on-chain escrow footprint.",
        "If continuing to use HodlHodl, be aware that the platform's fee address links your trade to other HodlHodl trades.",
        "Use CoinJoin before or after trading to break the link between the escrow and your other UTXOs.",
      ],
      tools: COIN_CONTROL_TOOLS,
      urgency: "when-convenient",
    },
  };
}

export function buildHodlHodlPatternFinding(
  scriptType: string,
  feeAmount: number,
  feeRatio: number,
): Finding {
  return {
    id: "h17-hodlhodl",
    severity: "high",
    confidence: "medium",
    title: "Likely HodlHodl escrow release (2-of-3 multisig, fee pattern)",
    params: {
      m: 2, n: 3, scriptType, feeAmount,
      feeRatio: Math.round(feeRatio * 10000) / 100,
    },
    description:
      "This transaction matches the HodlHodl P2P exchange pattern: a 2-of-3 multisig input " +
      "releasing to exactly 2 outputs, where the smaller output (" +
      `${(feeRatio * 100).toFixed(2)}% of input) is consistent with HodlHodl's combined ` +
      "buyer+seller platform fee (typically 0.9-1.0%). The 2-of-3 multisig structure " +
      "indicates buyer, seller, and HodlHodl arbitrator shared custody.",
    recommendation:
      "HodlHodl escrow transactions are identifiable on-chain due to the 2-of-3 multisig structure " +
      "and characteristic fee pattern. For more private P2P trading, consider protocols that use " +
      "Taproot-based escrow or Lightning-based settlement (e.g., RoboSats).",
    scoreImpact: -3,
    remediation: {
      steps: [
        "The 2-of-3 multisig structure and fee pattern cannot be undone for this transaction.",
        "For future P2P trades, consider Lightning-based exchanges (RoboSats) which leave no on-chain escrow footprint.",
        "Use CoinJoin before or after trading to break the link between the escrow and your other UTXOs.",
      ],
      tools: P2P_TOOLS,
      urgency: "when-convenient",
    },
  };
}

export function buildEscrow2of3Finding(scriptType: string): Finding {
  return {
    id: "h17-escrow-2of3",
    severity: "medium",
    confidence: "high",
    title: "2-of-3 multisig escrow detected",
    params: { m: 2, n: 3, scriptType },
    description:
      "This transaction spends from a 2-of-3 multisig input, a pattern consistent with " +
      "P2P exchange escrow (HodlHodl, Bisq), cold storage (Unchained, Casa, Nunchuk), or " +
      "business escrow. The script reveals that three parties share custody.",
    recommendation:
      "If using multisig for cold storage, consider migrating to Taproot-based multisig " +
      "(MuSig2 or FROST) which looks identical to single-sig on-chain, eliminating this fingerprint.",
    scoreImpact: -2,
    remediation: {
      steps: [
        "The 2-of-3 multisig structure is revealed on-chain when the output is spent.",
        "Consider Taproot-based multisig (MuSig2/FROST) for future setups - it is indistinguishable from single-sig.",
        "If using collaborative custody (Unchained, Casa), be aware that the multisig pattern is visible to chain observers.",
      ],
      tools: [
        { name: "Sparrow Wallet (MuSig2)", url: "https://sparrowwallet.com" },
      ],
      urgency: "when-convenient",
    },
  };
}

export function buildBisqEscrowFinding(
  scriptType: string,
  feeAddress: string,
  feeAmount: number,
): Finding {
  return {
    id: "h17-bisq",
    severity: "high",
    confidence: "high",
    title: "Likely Bisq escrow release (2-of-2 multisig)",
    params: { m: 2, n: 2, scriptType, feeAddress, feeAmount },
    description:
      "This transaction matches the Bisq P2P exchange pattern: a 2-of-2 multisig input " +
      "with an output to a known Bisq fee address. Both buyer and seller deposit collateral " +
      "into the escrow, and this transaction releases the funds upon trade completion. " +
      "The 2-of-2 multisig structure and fee address reveal this as a Bisq trade.",
    recommendation:
      "Bisq escrow transactions are identifiable on-chain due to the 2-of-2 multisig structure " +
      "and reused fee address. Bisq v2 aims to use Taproot-based escrow which would eliminate " +
      "this fingerprint. Use CoinJoin after receiving from Bisq to break the link.",
    scoreImpact: -3,
    remediation: {
      steps: [
        "The 2-of-2 multisig structure and fee address pattern cannot be undone for this transaction.",
        "Use CoinJoin after receiving from Bisq to break the link between the trade and your other UTXOs.",
        "For future trades, consider Lightning-based P2P exchanges (RoboSats) which leave no on-chain escrow footprint.",
        "Bisq v2 is migrating toward Taproot-based escrow which will reduce on-chain fingerprinting.",
      ],
      tools: P2P_TOOLS,
      urgency: "when-convenient",
    },
  };
}

export function buildLightningChannelFinding(
  scriptType: string,
  signals: string[],
): Finding {
  return {
    id: "lightning-channel-legacy",
    severity: "medium",
    confidence: "medium",
    title: "Likely legacy Lightning channel close",
    params: {
      m: 2, n: 2, scriptType,
      signals: signals.join("; "),
      likelyLN: 1,
    },
    description:
      "This transaction matches the pattern of a legacy P2WSH Lightning channel close: " +
      "2-of-2 multisig input with nLockTime > 0 and non-max nSequence. " +
      "The 2-of-2 P2WSH multisig funding output is identifiable by chain analysis as a Lightning channel. " +
      "Note: this pattern can also match 2-of-2 multisig spends using anti-fee-sniping (BIP-339).",
    recommendation:
      "Upgrade to Taproot channels (LND simple-taproot-channels, CLN) which use MuSig2 key aggregation. " +
      "Taproot channel opens and cooperative closes are indistinguishable from regular Taproot spends, " +
      "eliminating the Lightning channel fingerprint entirely.",
    scoreImpact: -3,
    remediation: {
      steps: [
        "The legacy P2WSH channel close is already on-chain and cannot be undone.",
        "For future channels, upgrade to Taproot channels (LND simple-taproot-channels).",
        "Taproot channels are indistinguishable from regular single-sig Taproot spends.",
      ],
      tools: [
        { name: "LND (Taproot Channels)", url: "https://lightning.engineering" },
        { name: "CLN (Core Lightning)", url: "https://corelightning.org" },
      ],
      urgency: "when-convenient" as const,
    },
  };
}

export function buildEscrow2of2Finding(
  scriptType: string,
  signals: string[],
): Finding {
  return {
    id: "h17-escrow-2of2",
    severity: "medium",
    confidence: "high",
    title: "2-of-2 multisig escrow detected",
    params: {
      m: 2, n: 2, scriptType,
      signals: signals.join("; "),
      likelyLN: 0,
    },
    description:
      "This transaction spends from a 2-of-2 multisig input to exactly 2 outputs, " +
      "a pattern consistent with P2P exchange escrow releases (Bisq) or custom escrow. " +
      (signals.length >= 2
        ? "The transaction metadata (" + signals.join(", ") + ") is consistent with a P2P exchange escrow release."
        : "The 2-of-2 structure reveals that two parties had to sign."),
    recommendation:
      "2-of-2 multisig escrow reveals multi-party involvement on-chain. For future P2P trades, " +
      "consider protocols using Taproot MuSig that hides the multisig structure.",
    scoreImpact: -2,
  };
}

export function buildGenericMultisigFinding(
  first: { m: number; n: number; scriptType: string },
  inputCount: number,
  typeList: string,
): Finding {
  return {
    id: "h17-multisig-info",
    severity: "low",
    confidence: "deterministic",
    title: `Wrapped multisig detected: ${typeList}`,
    params: {
      m: first.m, n: first.n, scriptType: first.scriptType,
      inputCount, types: typeList,
    },
    description:
      `This transaction spends from ${inputCount} wrapped multisig input${inputCount > 1 ? "s" : ""} (${typeList}). ` +
      "The M-of-N configuration is revealed when the multisig is spent, exposing the multi-party " +
      "nature of the input. This is visible to any chain observer.",
    recommendation:
      "Use Taproot (P2TR) with MuSig2 or FROST for multisig that is indistinguishable from " +
      "single-sig on-chain. This eliminates the multisig fingerprint entirely.",
    scoreImpact: 0,
  };
}
