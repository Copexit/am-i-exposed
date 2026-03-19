import type { Finding, Grade } from "@/lib/types";
import { isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";

export interface Action {
  priority: number;
  textKey: string;
  textDefault: string;
  detailKey: string;
  detailDefault: string;
}

/**
 * Generates prioritized remediation actions based on findings.
 * Focuses on the most impactful things the user can actually do.
 */
export function generateActions(findings: Finding[], grade: Grade): Action[] {
  const actions: Action[] = [];
  const ids = new Set(findings.map((f) => f.id));

  // Address reuse - highest priority
  if (ids.has("h8-address-reuse")) {
    const reuseFinding = findings.find((f) => f.id === "h8-address-reuse");
    if (reuseFinding?.severity === "critical") {
      actions.push({
        priority: 1,
        textKey: "remediation.stopReusingAddress",
        textDefault: "Stop reusing this address immediately",
        detailKey: "remediation.stopReusingAddressDetail",
        detailDefault:
          "Generate a new address for every receive. Most wallets do this automatically. " +
          "Send remaining funds to a fresh wallet using coin control. When possible, spend exact amounts to avoid change. " +
          "For stronger unlinking, use CoinJoin - but note that some exchanges may flag CoinJoin deposits.",
      });
    } else {
      actions.push({
        priority: 2,
        textKey: "remediation.avoidAddressReuse",
        textDefault: "Avoid further address reuse",
        detailKey: "remediation.avoidAddressReuseDetail",
        detailDefault:
          "Use a new address for each transaction. Enable HD wallet features if available.",
      });
    }
  }

  // Self-send (change back to input address) - critical priority
  if (ids.has("h2-self-send")) {
    actions.push({
      priority: 1,
      textKey: "remediation.switchWalletSelfSend",
      textDefault: "Switch wallets - yours sends change back to the same address",
      detailKey: "remediation.switchWalletSelfSendDetail",
      detailDefault:
        "Your wallet is sending change back to the same address you spent from. " +
        "This destroys your privacy by revealing your exact balance and linking all your transactions. " +
        "Switch to Sparrow Wallet, Ashigaru, Bitcoin Core, or any HD wallet that generates fresh change addresses automatically.",
    });
  }

  // Dust attack
  if (ids.has("dust-attack")) {
    actions.push({
      priority: 1,
      textKey: "remediation.doNotSpendDust",
      textDefault: "Do NOT spend the dust output",
      detailKey: "remediation.doNotSpendDustDetail",
      detailDefault:
        "Freeze this UTXO in your wallet's coin control. Spending it will link your addresses. " +
        "If you must clean it up, send it to a new address separately. For stronger unlinking, use CoinJoin - but note that some exchanges may flag CoinJoin deposits.",
    });
  }

  // Change detection
  if (ids.has("h2-change-detected")) {
    actions.push({
      priority: 3,
      textKey: "remediation.betterChangeHandling",
      textDefault: "Use wallets with better change handling",
      detailKey: "remediation.betterChangeHandlingDetail",
      detailDefault:
        "Use a wallet that sends change to the same address type as the payment (e.g., all bc1q). " +
        "Ashigaru handles this automatically. Sparrow Wallet warns about type mismatches but does not correct them. " +
        "For stronger protection: Stonewall creates a same-value decoy output that increases ambiguity " +
        "(the change is still present but which output is the payment becomes unclear). " +
        "PayJoin breaks the common input ownership heuristic by having the receiver contribute an input, " +
        "making it harder to identify participants.",
    });
    // Small change disposal (4.6)
    actions.push({
      priority: 4,
      textKey: "remediation.smallChangeDisposal",
      textDefault: "Dispose of small change safely",
      detailKey: "remediation.smallChangeDisposalDetail",
      detailDefault:
        "Small change outputs are toxic - they link future transactions back to this one. " +
        "Options: (1) increase the mining fee to consume the change entirely (e.g., 1000 sats of change becomes part of the fee), " +
        "(2) use a submarine swap to send it to Lightning (Boltz, Phoenix), " +
        "(3) swap to Liquid via atomic path (SideSwap, Boltz), " +
        "(4) swap to Monero - atomic swaps (UnstoppableSwap, Bisq) can cost over 2%, " +
        "for small amounts Unstoppable Wallet offers cheaper non-atomic swaps, " +
        "(5) accumulate small amounts via Lightning over time, then consolidate to a single UTXO after a delay.",
    });
  }

  // CoinJoin detected - encourage continuing and warn about exchange risks
  const coinJoinFound = findings.some(isCoinJoinFinding);
  if (coinJoinFound) {
    if (grade === "A+") {
      actions.push({
        priority: 5,
        textKey: "remediation.continueCoinJoin",
        textDefault: "Excellent! Continue using CoinJoin",
        detailKey: "remediation.continueCoinJoinDetail",
        detailDefault:
          "Your CoinJoin transaction provides strong privacy. Continue using Whirlpool " +
          "or Wasabi for future transactions. Avoid consolidating CoinJoin " +
          "outputs with non-CoinJoin UTXOs.",
      });
    }
    actions.push({
      priority: 4,
      textKey: "remediation.useDecentralizedExchanges",
      textDefault: "Use decentralized exchanges for CoinJoin outputs",
      detailKey: "remediation.useDecentralizedExchangesDetail",
      detailDefault:
        "Centralized exchanges (Binance, Coinbase, Gemini, Bitstamp, Swan, and others) " +
        "have been documented flagging and freezing accounts for CoinJoin-associated deposits. " +
        "This list is not exhaustive. Use decentralized, non-custodial alternatives that do not apply chain surveillance.",
    });
  }

  // Legacy address type
  if (ids.has("h10-p2pkh") || ids.has("h10-p2sh")) {
    actions.push({
      priority: 4,
      textKey: "remediation.upgradeNativeSegwit",
      textDefault: "Upgrade to a Native SegWit (bc1q) wallet",
      detailKey: "remediation.upgradeNativeSegwitDetail",
      detailDefault:
        "Native SegWit (P2WPKH, bc1q) addresses have the largest anonymity set of any address type, " +
        "making transactions blend in with the majority of Bitcoin activity. They also have lower fees " +
        "than legacy addresses. Sparrow Wallet, Ashigaru, and Bitcoin Core all default to Native SegWit.",
    });
  }

  // OP_RETURN
  if (findings.some((f) => f.id.startsWith("h7-op-return"))) {
    actions.push({
      priority: 4,
      textKey: "remediation.avoidOpReturn",
      textDefault: "Avoid services that embed OP_RETURN data",
      detailKey: "remediation.avoidOpReturnDetail",
      detailDefault:
        "OP_RETURN data is permanent and public. If a service you use embeds data in transactions, " +
        "consider alternatives that don't leave metadata on-chain.",
    });
  }

  // Bare multisig
  if (ids.has("script-multisig")) {
    actions.push({
      priority: 2,
      textKey: "remediation.switchMultisig",
      textDefault: "Switch from bare multisig to Taproot MuSig2",
      detailKey: "remediation.switchMultisigDetail",
      detailDefault:
        "Bare multisig exposes all public keys on-chain. Use P2WSH-wrapped multisig at minimum, " +
        "or ideally Taproot with MuSig2/FROST which looks identical to single-sig.",
    });
  }

  // Wallet fingerprint
  if (ids.has("h11-wallet-fingerprint")) {
    actions.push({
      priority: 5,
      textKey: "remediation.walletFingerprint",
      textDefault: "Use a wallet with a large anonymity set",
      detailKey: "remediation.walletFingerprintDetail",
      detailDefault:
        "Every wallet leaves a fingerprint - the goal is not invisibility but blending in with millions. " +
        "Bitcoin Core, Sparrow, and Electrum have the largest user bases, making their fingerprints the least identifying. " +
        "Wallets like Exodus or Trust Wallet have small, distinctive fingerprints that reveal poor privacy practices.",
    });
    // Fingerprint randomization guidance (6.6)
    actions.push({
      priority: 6,
      textKey: "remediation.fingerprintRandomization",
      textDefault: "Randomize your wallet fingerprint between transactions",
      detailKey: "remediation.fingerprintRandomizationDetail",
      detailDefault:
        "Sparrow Wallet allows manually changing nVersion and nLockTime before signing " +
        "(Headers > Version and Absolute Locktime fields). Alternating between nVersion=1/2 " +
        "and different nLockTime values makes consecutive transactions look like they come " +
        "from different wallets, breaking the fingerprint chain.",
    });
  }

  // CIOH (not CoinJoin)
  if (
    ids.has("h3-cioh") &&
    !coinJoinFound &&
    findings.find((f) => f.id === "h3-cioh")?.scoreImpact !== 0
  ) {
    actions.push({
      priority: 3,
      textKey: "remediation.minimizeMultiInput",
      textDefault: "Minimize multi-input transactions",
      detailKey: "remediation.minimizeMultiInputDetail",
      detailDefault:
        "Consolidating UTXOs links your addresses together. Use coin control to select specific UTXOs when spending. " +
        "When possible, spend exact amounts to avoid creating change. If you must consolidate, " +
        "consider CoinJoin - but note that some exchanges may flag CoinJoin deposits.",
    });
    // Segregated spending guidance (6.7)
    actions.push({
      priority: 3,
      textKey: "remediation.segregatedSpending",
      textDefault: "Never mix KYC and non-KYC UTXOs",
      detailKey: "remediation.segregatedSpendingDetail",
      detailDefault:
        "Use coin control to spend one UTXO at a time. Never combine inputs from different sources " +
        "(exchange withdrawals, P2P purchases, CoinJoin outputs) in the same transaction. " +
        "Label each UTXO with its source, risk level, and amount to make informed spending decisions.",
    });
  }

  // Low-entropy simple transactions
  if (ids.has("h5-low-entropy") || ids.has("h5-zero-entropy")) {
    actions.push({
      priority: 4,
      textKey: "remediation.usePayJoin",
      textDefault: "Use PayJoin or CoinJoin for better transaction entropy",
      detailKey: "remediation.usePayJoinDetail",
      detailDefault:
        "Simple 1-in/2-out transactions have low entropy, making analysis straightforward. " +
        "When possible, spend exact amounts to avoid change outputs. PayJoin (BIP78) adds inputs from the receiver to break common analysis heuristics.",
    });
  }

  // Connection privacy (6.8) - show for any poor grade
  if (grade === "C" || grade === "D" || grade === "F") {
    actions.push({
      priority: 6,
      textKey: "remediation.connectionPrivacy",
      textDefault: "Protect your network connection",
      detailKey: "remediation.connectionPrivacyDetail",
      detailDefault:
        "Your wallet's network connection reveals your IP and all addresses to the server. " +
        "Basic: clearnet public server (for small amounts). " +
        "Intermediate: connect via Tor to mask your IP. " +
        "Advanced: run your own node with Tor for full sovereignty - the server never sees your queries.",
    });
  }

  // General fallback for poor scores
  if (actions.length === 0 && (grade === "D" || grade === "F")) {
    actions.push({
      priority: 1,
      textKey: "remediation.freshStart",
      textDefault: "Consider a fresh start with better privacy practices",
      detailKey: "remediation.freshStartDetail",
      detailDefault:
        "Use a privacy-focused wallet (Sparrow, Ashigaru, Wasabi), generate a new seed, and use coin control when sending. " +
        "When possible, spend exact amounts to avoid change. For stronger privacy, use CoinJoin before depositing " +
        "to the new wallet - but note that some exchanges may flag CoinJoin deposits. Use Tor for all Bitcoin network activity.",
    });
  }

  // Sort by priority (lowest number = highest priority)
  actions.sort((a, b) => a.priority - b.priority);

  return actions.slice(0, 5);
}
