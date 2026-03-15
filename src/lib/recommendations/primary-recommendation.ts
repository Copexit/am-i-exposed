import type { Finding, Grade, TxType } from "@/lib/types";
import { isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";

export interface PrimaryRec {
  id: string;
  urgency: "immediate" | "soon" | "when-convenient";
  headlineKey: string;
  headlineDefault: string;
  detailKey: string;
  detailDefault: string;
  tool?: { name: string; url: string };
  guideLink?: string;
}

export interface RecommendationContext {
  findings: Finding[];
  grade: Grade;
  txType?: TxType;
  walletGuess: string | null;
}

/**
 * Deterministic cascade: walks tiers top-to-bottom, returns first match.
 * Mirrors chain analysis damage hierarchy (see docs/adr-recommendations.md).
 */
export function selectRecommendations(
  ctx: RecommendationContext,
): [PrimaryRec, PrimaryRec | null] {
  const ids = new Set(ctx.findings.map((f) => f.id));
  const hasCoinJoin = ctx.findings.some(isCoinJoinFinding);

  // --- Tier 0: Deterministic failures (immediate) ---

  if (ids.has("h2-same-address-io") || ids.has("h2-self-send")) {
    return [
      {
        id: "rec-self-send",
        urgency: "immediate",
        headlineKey: "primaryRec.selfSend.headline",
        headlineDefault: "Your wallet sends change back to the input address",
        detailKey: "primaryRec.selfSend.detail",
        detailDefault:
          "Switch to a wallet that generates fresh change addresses for every transaction. " +
          "This is a critical privacy failure - the change output is 100% identifiable.",
        tool: pickTool("wallet-switch", ctx.walletGuess),
        guideLink: "/guide#coin-control",
      },
      null,
    ];
  }

  if (ids.has("h8-address-reuse")) {
    return [
      {
        id: "rec-address-reuse",
        urgency: "immediate",
        headlineKey: "primaryRec.addressReuse.headline",
        headlineDefault: "Stop reusing this address",
        detailKey: "primaryRec.addressReuse.detail",
        detailDefault:
          "If this is your address: generate a new address for every receive. " +
          "If you intend to send to this address: ask the receiver to share a new address. " +
          "Address reuse is the most damaging privacy practice in Bitcoin.",
        tool: pickTool("wallet-switch", ctx.walletGuess),
        guideLink: "/guide#silent-payments",
      },
      null,
    ];
  }

  // --- Tier 1: Critical findings (immediate) ---

  const hasPostMix = ids.has("post-mix-consolidation") || ids.has("chain-post-coinjoin-consolidation") || ids.has("chain-post-mix-consolidation");
  const hasEntityOutput = ids.has("entity-known-output");

  if (hasEntityOutput && hasPostMix) {
    return [
      {
        id: "rec-postmix-to-entity",
        urgency: "immediate",
        headlineKey: "primaryRec.postmixEntity.headline",
        headlineDefault: "Do not send mixed coins to a KYC exchange",
        detailKey: "primaryRec.postmixEntity.detail",
        detailDefault:
          "Many exchanges freeze CoinJoin-tainted deposits. Even if they don't, " +
          "sending privacy-focused coins to a KYC entity links your on-chain history to your identity. " +
          "Never cross KYC and non-KYC paths.",
        guideLink: "/guide#coinjoin-ln",
      },
      null,
    ];
  }

  if (hasPostMix) {
    return [
      {
        id: "rec-postmix-consolidation",
        urgency: "immediate",
        headlineKey: "primaryRec.postmixConsolidation.headline",
        headlineDefault: "Do not consolidate all post-CoinJoin funds",
        detailKey: "primaryRec.postmixConsolidation.detail",
        detailDefault:
          "Amount correlation can link your CoinJoin input to the consolidated output, " +
          "undoing the mix. Use a single UTXO when spending. If you must consolidate, " +
          "ensure the total does not approximate your original CoinJoin input amount.",
        guideLink: "/guide#coin-control",
      },
      null,
    ];
  }

  if (ids.has("dust-attack")) {
    return [
      {
        id: "rec-dust",
        urgency: "immediate",
        headlineKey: "primaryRec.dust.headline",
        headlineDefault: "Freeze the dust UTXO - do not spend it",
        detailKey: "primaryRec.dust.detail",
        detailDefault:
          "Do not join this UTXO with any other in your wallet. " +
          "If you can spend it alone, send it back to the sender.",
        tool: { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
        guideLink: "/guide#coin-control",
      },
      null,
    ];
  }

  // --- Tier 2: Structural issues (soon) ---

  if (hasEntityOutput) {
    const detail = hasCoinJoin
      ? "Avoid sending mixed UTXOs to centralized entities. " +
        "If you have no choice, open a Lightning channel with them and send that way."
      : "Sending to a known entity links your UTXOs to your identity at that entity. " +
        "Use Lightning if possible.";
    return [
      {
        id: "rec-entity-output",
        urgency: "soon",
        headlineKey: "primaryRec.entityOutput.headline",
        headlineDefault: "Avoid sending directly to known entities",
        detailKey: hasCoinJoin ? "primaryRec.entityOutputCJ.detail" : "primaryRec.entityOutput.detail",
        detailDefault: detail,
        tool: pickTool("lightning", ctx.walletGuess),
        guideLink: "/guide#lightning",
      },
      null,
    ];
  }

  const ciohFinding = ctx.findings.find(
    (f) => f.id === "h3-cioh" && f.scoreImpact < 0,
  );
  if (ciohFinding && !hasCoinJoin) {
    const inputCount = Number(ciohFinding.params?.inputCount ?? 0);
    const secondary: PrimaryRec | null = inputCount >= 10
      ? {
          id: "rec-cioh-stonewall",
          urgency: "soon",
          headlineKey: "primaryRec.ciohStonewall.headline",
          headlineDefault: "Use Stonewall if consolidation is unavoidable",
          detailKey: "primaryRec.ciohStonewall.detail",
          detailDefault:
            "If you have no choice but to consolidate from different origins, " +
            "use Stonewall to make analysis harder for observers.",
          guideLink: "/guide#stonewall",
        }
      : null;
    return [
      {
        id: "rec-cioh",
        urgency: "soon",
        headlineKey: "primaryRec.cioh.headline",
        headlineDefault: "Avoid combining UTXOs from different sources",
        detailKey: "primaryRec.cioh.detail",
        detailDefault:
          "Every time you consolidate, you reveal additional information about your economic activity to everyone who sent you each coin joined in this transaction. " +
          "Choose a single UTXO that covers the payment. " +
          "If you must consolidate, do it with coins from the same origin.",
        tool: pickTool("coin-control", ctx.walletGuess),
        guideLink: "/guide#coin-control",
      },
      secondary,
    ];
  }

  if (ids.has("peel-chain") && ids.has("h2-change-detected")) {
    return [
      {
        id: "rec-peel-chain",
        urgency: "soon",
        headlineKey: "primaryRec.peelChain.headline",
        headlineDefault: "Break the payment chain - manage change individually",
        detailKey: "primaryRec.peelChain.detail",
        detailDefault:
          "Making payments with change from previous payments links transactions in cascade, " +
          "leaving a clear trail of your economic activity. " +
          "Freeze the change and use a different UTXO for each payment. " +
          "If you need to spend change, use it in collaborative transactions (PayJoin as a receiver, Stonewall) to increase ambiguity.",
        tool: pickTool("payjoin", ctx.walletGuess),
        guideLink: "/guide#payjoin-v2",
      },
      null,
    ];
  }

  const changeCompound = ctx.findings.find(
    (f) => f.id === "h2-change-detected" && Number(f.params?.corroboratorCount ?? 0) >= 2,
  );
  if (changeCompound) {
    return [
      {
        id: "rec-change-compound",
        urgency: "soon",
        headlineKey: "primaryRec.changeCompound.headline",
        headlineDefault: "Change is easily detectable - use collaborative transactions",
        detailKey: "primaryRec.changeCompound.detail",
        detailDefault:
          "In basic transactions, change is easily identifiable by heuristics. " +
          "Participate in collaborative transactions between sender and receiver " +
          "(PayJoin/Stowaway) to make external analysis significantly harder.",
        tool: pickTool("payjoin", ctx.walletGuess),
        guideLink: "/guide#payjoin-v2",
      },
      null,
    ];
  }

  // --- Tier 3: Moderate issues (when-convenient) ---

  if (ids.has("exchange-withdrawal-pattern")) {
    return [
      {
        id: "rec-exchange-withdrawal",
        urgency: "when-convenient",
        headlineKey: "primaryRec.exchangeWithdrawal.headline",
        headlineDefault: "Keep KYC and non-KYC funds in separate wallets",
        detailKey: "primaryRec.exchangeWithdrawal.detail",
        detailDefault: "Use separate wallets to keep KYC funds apart from non-KYC funds. Never mix these paths.",
        guideLink: "/guide#coin-control",
      },
      null,
    ];
  }

  if (ids.has("h2-change-detected")) {
    return [
      {
        id: "rec-change-single",
        urgency: "when-convenient",
        headlineKey: "primaryRec.changeSingle.headline",
        headlineDefault: "Manage change outputs individually",
        detailKey: "primaryRec.changeSingle.detail",
        detailDefault:
          "Use change individually - spend it totally or use it in collaborative " +
          "transactions like PayJoin as a receiver to make analysis harder.",
        tool: pickTool("payjoin", ctx.walletGuess),
        guideLink: "/guide#payjoin-v2",
      },
      null,
    ];
  }

  if ((ids.has("h5-low-entropy") || ids.has("h5-zero-entropy")) && !hasCoinJoin) {
    // Skip zero-entropy for 1-in-1-out sweeps (they have scoreImpact 0)
    const entropyFinding = ctx.findings.find(
      (f) => (f.id === "h5-low-entropy" || f.id === "h5-zero-entropy") && f.scoreImpact < 0,
    );
    if (entropyFinding) {
      return [
        {
          id: "rec-low-entropy",
          urgency: "when-convenient",
          headlineKey: "primaryRec.lowEntropy.headline",
          headlineDefault: "Increase transaction entropy with collaborative payments",
          detailKey: "primaryRec.lowEntropy.detail",
          detailDefault: "Add complexity with collaborative payments: PayJoin/Stowaway or Stonewall.",
          tool: pickTool("payjoin", ctx.walletGuess),
          guideLink: "/guide#stonewall",
        },
        null,
      ];
    }
  }

  // Round amount recommendation is irrelevant for CoinJoin/Stonewall - pool
  // denominations are intentionally round. Only show for non-CoinJoin txs.
  if (
    !hasCoinJoin &&
    (ids.has("h1-round-amount") || ids.has("h1-round-usd-amount") || ids.has("h1-round-eur-amount"))
  ) {
    return [
      {
        id: "rec-round-amount",
        urgency: "when-convenient",
        headlineKey: "primaryRec.roundAmount.headline",
        headlineDefault: "Avoid round payment amounts",
        detailKey: "primaryRec.roundAmount.detail",
        detailDefault:
          "Round amounts make change detection easier. " +
          "If unavoidable, use Lightning - amounts are not visible on-chain.",
        tool: pickTool("lightning", ctx.walletGuess),
        guideLink: "/guide#lightning",
      },
      null,
    ];
  }

  // --- Tier 4: Positive / low-impact (when-convenient) ---

  // Stonewall/STONEWALLx2 already provides strong privacy - don't suggest "consider CoinJoin"
  const hasStonewall = ids.has("h4-stonewall") || ids.has("h4-simplified-stonewall");
  if (hasStonewall && (ctx.grade === "A+" || ctx.grade === "B")) {
    return [
      {
        id: "rec-stonewall",
        urgency: "when-convenient",
        headlineKey: "primaryRec.stonewall.headline",
        headlineDefault: "Good Stonewall privacy - spend outputs carefully",
        detailKey: "primaryRec.stonewall.detail",
        detailDefault:
          "Stonewall creates ambiguity about which outputs belong to which party. " +
          "To preserve this, spend outputs individually and avoid consolidating them " +
          "with non-Stonewall UTXOs.",
        guideLink: "/guide#stonewall",
      },
      null,
    ];
  }

  if (ctx.grade === "A+" && hasCoinJoin) {
    return [
      {
        id: "rec-a-plus-cj",
        urgency: "when-convenient",
        headlineKey: "primaryRec.aPlusCJ.headline",
        headlineDefault: "Strong privacy - spend post-mix one UTXO at a time",
        detailKey: "primaryRec.aPlusCJ.detail",
        detailDefault:
          "Keep doing this. Spend post-mix outputs individually when possible. " +
          "Avoid consolidating all mixed UTXOs.",
        guideLink: "/guide#coin-control",
      },
      {
        id: "rec-a-plus-cj-ln",
        urgency: "when-convenient",
        headlineKey: "primaryRec.aPlusCJLn.headline",
        headlineDefault: "Consider Lightning for post-mix spending",
        detailKey: "primaryRec.aPlusCJLn.detail",
        detailDefault: "If spending post-mix UTXOs at a centralized exchange, consider doing it via Lightning. Lightning payments are off-chain and invisible to chain analysis.",
        guideLink: "/guide#lightning",
      },
    ];
  }

  if (ctx.grade === "A+") {
    return [
      {
        id: "rec-a-plus",
        urgency: "when-convenient",
        headlineKey: "primaryRec.aPlus.headline",
        headlineDefault: "Strong privacy - maintain these practices",
        detailKey: "primaryRec.aPlus.detail",
        detailDefault:
          "Consider collaborative transactions (PayJoin) or Lightning for even better privacy.",
        guideLink: "/guide#payjoin-v2",
      },
      null,
    ];
  }

  if (ctx.grade === "B") {
    return [
      {
        id: "rec-b-grade",
        urgency: "when-convenient",
        headlineKey: "primaryRec.bGrade.headline",
        headlineDefault: "Good privacy - consider CoinJoin, PayJoin, or Lightning",
        detailKey: "primaryRec.bGrade.detail",
        detailDefault: hasCoinJoin
          ? "Good mix. Spend post-mix one UTXO at a time and avoid full consolidation."
          : "Consider CoinJoin, PayJoin, or Lightning for stronger privacy.",
        guideLink: hasCoinJoin ? "/guide#coin-control" : "/guide#payjoin-v2",
      },
      null,
    ];
  }

  // Fallback
  return [
    {
      id: "rec-fallback",
      urgency: "when-convenient",
      headlineKey: "primaryRec.fallback.headline",
      headlineDefault: "Review the findings above for specific improvements",
      detailKey: "primaryRec.fallback.detail",
      detailDefault: "Check each finding for targeted recommendations.",
      guideLink: "/guide",
    },
    null,
  ];
}

/** Pick the most relevant tool, avoiding what the user already has. */
function pickTool(
  need: "wallet-switch" | "coin-control" | "payjoin" | "lightning",
  walletGuess: string | null,
): { name: string; url: string } | undefined {
  const w = walletGuess?.toLowerCase() ?? "";

  switch (need) {
    case "wallet-switch":
      if (w.includes("sparrow")) return { name: "Ashigaru", url: "https://ashigaru.rs" };
      if (w.includes("ashigaru")) return { name: "Sparrow Wallet", url: "https://sparrowwallet.com" };
      return { name: "Sparrow Wallet", url: "https://sparrowwallet.com" };
    case "coin-control":
      if (w.includes("sparrow")) return undefined; // already has it
      if (w.includes("ashigaru")) return undefined;
      return { name: "Sparrow Wallet", url: "https://sparrowwallet.com" };
    case "payjoin":
      // Recommend a PayJoin/Stowaway wallet the user doesn't already have
      if (w.includes("cake")) return { name: "Bull Bitcoin", url: "https://www.bullbitcoin.com/wallet" };
      if (w.includes("bull")) return { name: "Cake Wallet", url: "https://cakewallet.com" };
      if (w.includes("ashigaru") || w.includes("samourai")) return { name: "Cake Wallet", url: "https://cakewallet.com" };
      return { name: "Cake Wallet", url: "https://cakewallet.com" };
    case "lightning":
      return { name: "Phoenix", url: "https://phoenix.acinq.co" };
  }
}
