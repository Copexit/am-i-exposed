import type { Finding } from "@/lib/types";
import { suppressFinding } from "./utils";

/**
 * Suppress findings that are misleading or irrelevant in CoinJoin/Stonewall
 * context. CoinJoin transactions are multi-party by design, so many single-user
 * heuristics produce false positives.
 */
export function applyCoinJoinSuppressions(findings: Finding[], isStonewall: boolean): void {
  for (const f of findings) {
    // CIOH suppression for ALL CoinJoin types including Stonewall.
    // Stonewall intentionally consolidates inputs to create the appearance
    // of a multi-party CoinJoin - CIOH is the expected structure, not a leak.
    if (f.id === "h3-cioh") {
      const ctx = isStonewall ? "stonewall" : "coinjoin";
      suppressFinding(f, ctx);
      f.params = { ...f.params, _variant: ctx };
    }
    // Round amounts in CoinJoin are the denomination, not a privacy leak.
    // In Stonewall specifically, round amounts are hidden behind the equal-value pair structure.
    if (f.id === "h1-round-amount" || f.id === "h1-round-usd-amount" || f.id === "h1-round-eur-amount") {
      suppressFinding(f, isStonewall ? "stonewall" : "coinjoin");
    }
    // Change detection in CoinJoin is less reliable
    // NOTE: h2-self-send is NOT suppressed - sending back to your own
    // input address is a privacy failure even in CoinJoin context
    if (f.id === "h2-change-detected") {
      suppressFinding(f, "coinjoin");
    }
    // Script type mixing is expected in CoinJoin (participants use different wallets)
    if (f.id === "script-mixed") {
      suppressFinding(f, "coinjoin");
    }
    // Dust spending in CoinJoin context: coordinator fees can be below dust
    // threshold and this is structural, not a privacy leak
    if (f.id === "dust-spending") {
      suppressFinding(f, "coinjoin");
    }
    // Low entropy is unreliable for CoinJoin structures - the one-to-one
    // assignment model doesn't capture many-to-many Boltzmann ambiguity
    if (f.id === "h5-low-entropy") {
      suppressFinding(f, "coinjoin");
    }
    // Entropy recommendation should reflect CoinJoin context.
    // For Stonewall: the two pairs of equal outputs create more ambiguity
    // than a normal 2-output payment (which has 0 bits entropy).
    if (f.id === "h5-entropy") {
      if (isStonewall) {
        f.params = { ...f.params, context: "stonewall" };
        // Enhance description to explain Stonewall's structural ambiguity
        f.description =
          f.description +
          " In this Stonewall transaction, the two equal-value outputs create ambiguity about which is the real payment." +
          " A normal 2-output payment has 0 bits (fully deterministic), so this entropy is a meaningful improvement.";
      } else {
        f.params = { ...f.params, context: "coinjoin" };
      }
    }
    // Wallet fingerprint is less relevant for CoinJoin - but we can infer the wallet
    // from the CoinJoin type detected by H4.
    // For Stonewall specifically, nVersion=1 is INTENTIONAL fingerprint disruption
    // by Samourai/Ashigaru - it should not be penalized.
    if (f.id === "h11-wallet-fingerprint") {
      f.severity = "low";
      // Infer wallet from CoinJoin type
      const isWabiSabi = findings.some(
        (x) => x.id === "h4-coinjoin" && x.params?.isWabiSabi === 1,
      );
      const isWasabi1 = findings.some(
        (x) => x.id === "h4-coinjoin" && x.params?.isWasabi1 === 1,
      );
      const isWhirlpool = findings.some((x) => x.id === "h4-whirlpool");
      if (isWabiSabi || isWasabi1) {
        f.params = { ...f.params, walletGuess: "Wasabi Wallet" };
      } else if (isWhirlpool) {
        f.params = { ...f.params, walletGuess: "Ashigaru/Sparrow" };
      } else if (isStonewall) {
        f.params = { ...f.params, walletGuess: "Ashigaru", intentionalFingerprint: 1 };
      }
      // Compose context: identified (if wallet known) or signals variant + coinjoin
      const hasWallet = !!f.params?.walletGuess;
      const base = hasWallet
        ? "identified"
        : ((f.params?.context as string) ?? "signals_other");
      f.params = { ...f.params, context: `${base}_coinjoin` };
      f.scoreImpact = 0;
    }
    // Dust outputs in CoinJoin may be coordinator fees (e.g. Whirlpool)
    if (f.id === "dust-attack" || f.id === "dust-outputs") {
      suppressFinding(f, "coinjoin");
    }
    // Timing analysis is meaningless for CoinJoin (participants broadcast together)
    if (f.id === "timing-unconfirmed") {
      suppressFinding(f, "coinjoin");
    }
    // Fee fingerprinting reveals the coordinator, not the participant's wallet
    if (f.id === "h6-round-fee-rate" || f.id === "h6-rbf-signaled" || f.id === "h6-cpfp-detected") {
      suppressFinding(f, "coinjoin");
    }
    // No anonymity set finding: CoinJoin structure itself provides privacy
    // beyond simple output value matching, so the penalty is unwarranted.
    // For Stonewall: the 2 equal outputs plus 2 distinct change outputs create
    // higher effective ambiguity than the raw anonymity set of 2 suggests,
    // because each change output could belong to either party.
    if (f.id === "anon-set-none" || f.id === "anon-set-moderate") {
      if (isStonewall && f.id === "anon-set-moderate") {
        suppressFinding(f, "stonewall");
        f.description =
          f.description +
          " In Stonewall, the 2 equal outputs plus 2 distinct change outputs create structural ambiguity:" +
          " an observer cannot determine which change belongs to which equal-value output," +
          " effectively raising the ambiguity beyond what the raw anonymity set of 2 suggests.";
      } else {
        suppressFinding(f, "coinjoin");
      }
    }
    // Multisig/escrow detection is misleading in CoinJoin context -
    // multisig inputs may belong to different participants
    if (f.id.startsWith("h17-")) {
      suppressFinding(f, "coinjoin");
    }
    // Consolidation/batching/unnecessary input patterns are expected in CoinJoin
    if (f.id.startsWith("consolidation-") || f.id === "unnecessary-input") {
      suppressFinding(f, "coinjoin");
    }
    // BIP69 ordering is coordinator-determined in CoinJoin, not a privacy signal
    if (f.id === "bip69-detected") {
      suppressFinding(f, "coinjoin");
    }
    // Witness analysis reflects different participants' wallets, not a single user
    if (f.id === "witness-mixed-types" || f.id === "witness-mixed-depths"
      || f.id === "witness-mixed-sig-types" || f.id === "witness-deep-stack") {
      suppressFinding(f, "coinjoin");
    }
    // Coin selection patterns are coordinator-determined in CoinJoin
    if (f.id.startsWith("h-coin-selection-")) {
      suppressFinding(f, "coinjoin");
    }
    // Linkability recommendations should not suggest CoinJoin when already CoinJoin.
    // The findings themselves are valid (ambiguity is good), but the recommendation
    // text needs to reflect post-mix best practices instead.
    if (f.id === "linkability-ambiguous") {
      f.recommendation =
        "Good transaction privacy. To preserve this ambiguity, spend post-mix outputs " +
        "one at a time and avoid consolidating them with non-CoinJoin UTXOs.";
      f.params = { ...f.params, context: "coinjoin" };
    }
    if (f.id === "linkability-deterministic") {
      f.recommendation =
        "Deterministic links reduce CoinJoin effectiveness. Avoid consolidating " +
        "mixed outputs with unmixed UTXOs. Spend post-mix outputs individually.";
      f.params = { ...f.params, context: "coinjoin" };
    }
    if (f.id === "linkability-equal-subset") {
      f.recommendation =
        "Non-equal outputs in this CoinJoin are deterministically linked. " +
        "This is expected for change/fee outputs. Spend mixed equal-value outputs " +
        "individually to preserve the ambiguity set.";
      f.params = { ...f.params, context: "coinjoin" };
    }
    // Peel chain findings are false positives on CoinJoin: post-mix outputs
    // spent individually (1-in, 2-out) is the expected spending pattern, not
    // a peel chain. Both the tx-level and chain-level findings are suppressed.
    if (f.id === "peel-chain" || f.id === "chain-forward-peel") {
      suppressFinding(f, "coinjoin");
    }
    // OP_RETURN is intentionally NOT suppressed - protocol markers in CoinJoin
    // are additional metadata that may fingerprint the coordinator or participants.
    // Whirlpool uses OP_RETURN for pool-pairing; WabiSabi does not.
  }
}
