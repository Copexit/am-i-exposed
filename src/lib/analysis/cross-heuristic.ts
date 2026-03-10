import type { Finding, TxType } from "@/lib/types";
import { isCoinJoinFinding } from "./heuristics/coinjoin";

/**
 * Cross-heuristic intelligence: adjust findings based on interactions
 * between different heuristics. This runs after all heuristics complete.
 */
export function applyCrossHeuristicRules(findings: Finding[]): void {
  const isCoinJoin = findings.some(isCoinJoinFinding);
  const isStonewall = findings.some(
    (f) => (f.id === "h4-stonewall" || f.id === "h4-simplified-stonewall") && f.scoreImpact > 0,
  );

  if (isCoinJoin) {
    for (const f of findings) {
      // CIOH suppression for ALL CoinJoin types including Stonewall.
      // Even solo Stonewall is designed to create CIOH ambiguity - the multiple
      // inputs are intentional to make the tx look like a multi-party CoinJoin.
      // For Stonewall: reduce to -3 (not 0, since all inputs ARE one wallet,
      // but the ambiguity is the feature). For other CoinJoins: fully suppress.
      if (f.id === "h3-cioh") {
        if (isStonewall) {
          f.severity = "low";
          f.params = { ...f.params, context: "stonewall" };
          f.scoreImpact = -3;
        } else {
          f.severity = "low";
          f.params = { ...f.params, context: "coinjoin" };
          f.scoreImpact = 0;
        }
      }
      // Round amounts in CoinJoin are the denomination, not a privacy leak.
      // In Stonewall specifically, round amounts are hidden behind the equal-value pair structure.
      if (f.id === "h1-round-amount" || f.id === "h1-round-usd-amount" || f.id === "h1-round-eur-amount") {
        f.severity = "low";
        f.params = { ...f.params, context: isStonewall ? "stonewall" : "coinjoin" };
        f.scoreImpact = 0;
      }
      // Change detection in CoinJoin is less reliable
      // NOTE: h2-self-send is NOT suppressed - sending back to your own
      // input address is a privacy failure even in CoinJoin context
      if (f.id === "h2-change-detected") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Script type mixing is expected in CoinJoin (participants use different wallets)
      if (f.id === "script-mixed") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Low entropy is unreliable for CoinJoin structures - the one-to-one
      // assignment model doesn't capture many-to-many Boltzmann ambiguity
      if (f.id === "h5-low-entropy") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
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
        const isWhirlpool = findings.some((x) => x.id === "h4-whirlpool");
        if (isWabiSabi) {
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
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Timing analysis is meaningless for CoinJoin (participants broadcast together)
      if (f.id === "timing-unconfirmed") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Fee fingerprinting reveals the coordinator, not the participant's wallet
      if (f.id === "h6-round-fee-rate" || f.id === "h6-rbf-signaled" || f.id === "h6-cpfp-detected") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // No anonymity set finding: CoinJoin structure itself provides privacy
      // beyond simple output value matching, so the penalty is unwarranted.
      // For Stonewall: the 2 equal outputs plus 2 distinct change outputs create
      // higher effective ambiguity than the raw anonymity set of 2 suggests,
      // because each change output could belong to either party.
      if (f.id === "anon-set-none" || f.id === "anon-set-moderate") {
        f.severity = "low";
        if (isStonewall && f.id === "anon-set-moderate") {
          f.params = { ...f.params, context: "stonewall" };
          f.description =
            f.description +
            " In Stonewall, the 2 equal outputs plus 2 distinct change outputs create structural ambiguity:" +
            " an observer cannot determine which change belongs to which equal-value output," +
            " effectively raising the ambiguity beyond what the raw anonymity set of 2 suggests.";
        } else {
          f.params = { ...f.params, context: "coinjoin" };
        }
        f.scoreImpact = 0;
      }
      // Multisig/escrow detection is misleading in CoinJoin context -
      // multisig inputs may belong to different participants
      if (f.id.startsWith("h17-")) {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Consolidation/batching/unnecessary input patterns are expected in CoinJoin
      if (f.id.startsWith("consolidation-") || f.id === "unnecessary-input") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // BIP69 ordering is coordinator-determined in CoinJoin, not a privacy signal
      if (f.id === "bip69-detected") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Witness analysis reflects different participants' wallets, not a single user
      if (f.id === "witness-mixed-types" || f.id === "witness-mixed-depths"
        || f.id === "witness-mixed-sig-types" || f.id === "witness-deep-stack") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Coin selection patterns are coordinator-determined in CoinJoin
      if (f.id.startsWith("h-coin-selection-")) {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // OP_RETURN is intentionally NOT suppressed - protocol markers in CoinJoin
      // are additional metadata that may fingerprint the coordinator or participants.
      // Whirlpool uses OP_RETURN for pool-pairing; WabiSabi does not.
    }
  }

  // Note: exchange-withdrawal-pattern is NOT suppressed for CoinJoin because
  // it structurally cannot overlap: exchange withdrawals require <= 2 inputs
  // while all CoinJoin types (Whirlpool, WabiSabi, JoinMarket, Stonewall)
  // require 3+ inputs. Explicit suppression is unnecessary.

  // Multisig script-type adjustment: multisig inputs inherently use different
  // script types (P2SH/P2WSH) from single-sig outputs. The "script-mixed"
  // penalty is misleading in this context - it's not a privacy leak but a
  // structural property of multisig spending.
  const hasMultisig = findings.some((f) => f.id.startsWith("h17-"));
  if (hasMultisig) {
    for (const f of findings) {
      if (f.id === "script-mixed") {
        f.severity = "low";
        f.params = { ...f.params, context: "multisig" };
        f.scoreImpact = 0;
      }
    }
  }

  // CIOH + consolidation + unnecessary input dedup: when CIOH fires on a
  // non-CoinJoin tx, the consolidation and unnecessary-input findings are
  // redundant (they describe the same multi-input problem).
  const ciohFinding = findings.find((f) => f.id === "h3-cioh" && f.scoreImpact < 0);
  if (ciohFinding && !isCoinJoin) {
    for (const f of findings) {
      if (f.id === "unnecessary-input") {
        f.severity = "low";
        f.params = { ...f.params, context: "cioh-covers" };
        f.scoreImpact = 0;
      }
      if (f.id.startsWith("consolidation-") && f.scoreImpact < -2) {
        f.params = { ...f.params, context: "cioh-covers" };
        f.scoreImpact = -2;
      }
    }
  }

  // Consolidation triple-penalty reduction: when h2-self-send fires as a
  // consolidation (N-in, 1-out to self), zero-entropy (h5) is inherent and
  // adds no information beyond what CIOH already captures. Suppress it.
  const isConsolidationSelfSend = findings.some(
    (f) => f.id === "h2-self-send" && f.params?.allMatch === 1,
  );
  if (isConsolidationSelfSend) {
    for (const f of findings) {
      if (f.id === "h5-zero-entropy") {
        f.severity = "low";
        f.params = { ...f.params, context: "consolidation" };
        f.scoreImpact = 0;
      }
    }
  }

  // RBF x Change detection: RBF confirms which output is change. When both
  // h6-rbf-signaled and h2-change-detected fire, boost change confidence and
  // add compound note. RBF replacement reduces the change output value,
  // proving to any observer which output is change.
  const h6Rbf = findings.find((f) => f.id === "h6-rbf-signaled");
  const h2ChangeForRbf = findings.find((f) => f.id === "h2-change-detected" && f.scoreImpact < 0);
  if (h6Rbf && h2ChangeForRbf) {
    h2ChangeForRbf.confidence = "high";
    h2ChangeForRbf.scoreImpact += -2;
    h2ChangeForRbf.description +=
      " RBF is signaled on this transaction. If fee-bumped via RBF, the change output value will decrease, confirming which output is change.";
    h2ChangeForRbf.params = {
      ...h2ChangeForRbf.params,
      rbfCompound: 1,
    };
  }

  // Compound confidence boost: when change detection is corroborated by
  // independent heuristics (wallet fingerprint, peel chain, low entropy),
  // boost its impact. Each corroborator adds -2 impact (max -6).
  const h2Finding = findings.find((f) => f.id === "h2-change-detected");
  if (h2Finding) {
    let boostCount = 0;
    // Wallet fingerprint provides independent confirmation (nVersion/nLockTime)
    if (findings.some((f) => f.id === "h11-wallet-fingerprint" && f.scoreImpact < 0)) {
      boostCount++;
    }
    // Peel chain confirms spending pattern
    if (findings.some((f) => f.id === "peel-chain" && f.scoreImpact < 0)) {
      boostCount++;
    }
    // Low entropy confirms identifiability
    if (findings.some((f) => (f.id === "h5-low-entropy" || f.id === "h5-zero-entropy") && f.scoreImpact < 0)) {
      boostCount++;
    }

    if (boostCount > 0) {
      const boost = Math.max(boostCount * -2, -6);
      h2Finding.scoreImpact += boost;
      h2Finding.params = {
        ...h2Finding.params,
        compoundBoost: boost,
        corroborators: boostCount,
      };
      if (boostCount >= 2) {
        h2Finding.severity = "high";
        h2Finding.confidence = "deterministic";
      } else if (h2Finding.severity === "low") {
        h2Finding.severity = "medium";
        h2Finding.confidence = "high";
      }
    }
  }

  // Post-mix to known entity: when post-mix consolidation is detected AND
  // outputs match known entity addresses, escalate severity. This catches
  // items 8.4: "Send to known exchange from post-mix" and
  // "Consolidation + exchange send in same tx".
  const hasPostMixConsolidation = findings.some(
    (f) => f.id === "post-mix-consolidation" || f.id === "chain-post-coinjoin-consolidation",
  );
  const hasEntityOutput = findings.some((f) => f.id === "entity-known-output");
  const hasPostMixDirectSpend = findings.some((f) => f.id === "chain-post-coinjoin-direct-spend");

  if (hasEntityOutput && (hasPostMixConsolidation || hasPostMixDirectSpend)) {
    const entityFinding = findings.find((f) => f.id === "entity-known-output");
    if (entityFinding) {
      entityFinding.severity = "critical";
      entityFinding.scoreImpact = -10;
      entityFinding.title = "Post-mix funds sent to known entity";
      entityFinding.description =
        "This transaction sends CoinJoin/post-mix outputs to a known exchange or service. " +
        "The receiving entity can identify that funds came from a CoinJoin, which may trigger " +
        "compliance flags and source-of-funds requests. The entity can also attempt to trace " +
        "backward through the CoinJoin to de-anonymize the sender.";
      entityFinding.recommendation =
        "Never send directly from post-mix to KYC exchanges. Add intermediate hops, use P2P " +
        "platforms (Bisq, RoboSats, HodlHodl), or route through Lightning Network.";
      entityFinding.params = {
        ...entityFinding.params,
        context: hasPostMixConsolidation ? "postmix-consolidation-to-entity" : "postmix-direct-to-entity",
      };
    }
  }

  // Post-mix + backward CoinJoin dedup: when post-mix consolidation negates
  // mixing benefit, zero backward's positive CJ-input finding to avoid
  // conflicting signals (post-mix says bad, backward says good).
  if (hasPostMixConsolidation) {
    for (const f of findings) {
      if (f.id === "chain-coinjoin-input" && f.scoreImpact > 0) {
        f.scoreImpact = 0;
        f.params = { ...f.params, context: "negated-by-consolidation" };
      }
    }
  }

  // Wasabi fingerprint + address reuse paradox: Wasabi is designed to prevent
  // address reuse, so detecting both signals is a contradiction worth flagging.
  const hasWasabiFingerprint = findings.some(
    (f) =>
      f.id === "h11-wallet-fingerprint" &&
      typeof f.params?.walletGuess === "string" &&
      (f.params.walletGuess as string).toLowerCase().includes("wasabi"),
  );
  const hasAddressReuse = findings.some(
    (f) => f.id === "h8-address-reuse" && f.scoreImpact < 0,
  );

  if (hasWasabiFingerprint && hasAddressReuse) {
    findings.push({
      id: "cross-wasabi-reuse-paradox",
      severity: "high",
      confidence: "high",
      title: "Wasabi wallet fingerprint detected with address reuse",
      description:
        "This transaction shows a Wasabi Wallet fingerprint (nVersion=1, nLockTime=0) " +
        "but the address has been reused. Wasabi is designed to prevent address reuse, " +
        "making this a contradiction. Either the fingerprint is coincidental (false positive) " +
        "or recommended Wasabi practices are not being followed, severely undermining " +
        "any privacy benefit from CoinJoin mixing.",
      recommendation:
        "If using Wasabi, enable automatic address generation and never manually reuse addresses. " +
        "Address reuse undoes the unlinkability that CoinJoin provides.",
      scoreImpact: 0,
      params: { context: "wasabi-reuse-paradox" },
    });
  }

  // Compound stacking: when a deterministic (100% certain) finding is present,
  // ensure the score is capped at F (grade F = score < 25, meaning total impact
  // from base 70 must be at least -46). Deterministic findings make all other
  // privacy measures irrelevant - one certain link reveals everything.
  // Only h2-same-address-io (partial self-send) is truly deterministic in the
  // Blockchair sense: change is revealed to third-party observers, leaking the
  // payment amount. Full self-sends (h2-self-send) have no external payment to
  // leak and are already heavily penalized (-15 to -25).
  const DETERMINISTIC_FINDING_IDS = new Set([
    "h2-same-address-io",    // Same address in input and output (partial - change revealed)
    "h2-sweep",              // 1-in, 1-out sweep (0 entropy, fully deterministic)
  ]);

  const hasDeterministicFinding = findings.some(
    (f) => DETERMINISTIC_FINDING_IDS.has(f.id) && f.scoreImpact < 0,
  );

  if (hasDeterministicFinding) {
    const totalImpact = findings.reduce((sum, f) => sum + f.scoreImpact, 0);
    const targetImpact = -46; // Ensures F from base 70

    if (totalImpact > targetImpact) {
      findings.push({
        id: "compound-deterministic-cap",
        severity: "critical",
        confidence: "deterministic",
        title: "Deterministic privacy failure - score capped",
        description:
          "A 100% certain privacy leak was detected. The score is capped at F " +
          "because no amount of positive signals can offset a deterministic identification.",
        recommendation:
          "Fix the deterministic issue before addressing other findings.",
        scoreImpact: targetImpact - totalImpact,
      });
    }
  }
}

/**
 * Classify a transaction based on detected findings.
 * Priority: most specific pattern first, fallback to structural patterns.
 */
export function classifyTransactionType(findings: Finding[]): TxType {
  const has = (id: string) => findings.some((f) => f.id === id && f.scoreImpact !== 0);
  const hasAny = (id: string) => findings.some((f) => f.id === id);

  // CoinJoin variants (most specific first)
  if (hasAny("h4-whirlpool")) return "whirlpool-coinjoin";
  if (findings.some((f) => f.id === "h4-coinjoin" && f.params?.isWabiSabi === 1)) return "wabisabi-coinjoin";
  if (hasAny("h4-joinmarket")) return "joinmarket-coinjoin";
  if (hasAny("h4-coinjoin")) return "generic-coinjoin";

  // Samourai/Ashigaru specific patterns
  if (hasAny("h4-stonewall")) return "stonewall";
  if (hasAny("h4-simplified-stonewall")) return "simplified-stonewall";
  if (hasAny("tx0-premix")) return "tx0-premix";
  if (hasAny("bip47-notification")) return "bip47-notification";

  // Coinbase
  if (hasAny("coinbase-transaction")) return "coinbase";

  // Structural patterns
  if (hasAny("h2-self-send")) return "self-transfer";
  if (has("consolidation-fan-in")) return "consolidation";
  if (has("exchange-withdrawal-pattern")) return "exchange-withdrawal";
  if (has("consolidation-fan-out")) return "batch-payment";
  if (has("peel-chain")) return "peel-chain";

  return "simple-payment";
}
