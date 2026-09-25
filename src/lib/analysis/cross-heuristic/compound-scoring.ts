import type { Finding } from "@/lib/types";

/**
 * Chain bonuses that all reward the same fact: the inputs come from a
 * CoinJoin. The Ashigaru Ricochet variant (params.wallet) is a separate
 * fact (hops after a Ricochet hop 0) and is not part of the group.
 */
function isCoinJoinProvenanceBonus(f: Finding): boolean {
  if (f.scoreImpact <= 0) return false;
  return f.id === "chain-coinjoin-input"
    || f.id === "chain-coinjoin-ancestry"
    || (f.id === "chain-ricochet" && f.params?.wallet === undefined);
}

/** Keep the score of the strongest finding in a group of overlapping findings, zero the rest. */
function keepStrongest(group: Finding[]): void {
  const [, ...rest] = [...group].sort((a, b) => Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact));
  for (const f of rest) {
    f.scoreImpact = 0;
    f.params = { ...f.params, context: "overlap" };
  }
}

/**
 * Apply compound scoring adjustments for corroborating heuristics:
 * - RBF x Change detection boost
 * - Multi-heuristic change detection confidence boost
 * - Post-mix to known entity escalation
 * - Post-mix backward CoinJoin dedup
 * - One bonus for CoinJoin provenance, one penalty for a backward entity
 */
export function applyCompoundScoringAdjustments(findings: Finding[]): void {
  // Chain findings count toward the grade, so the same fact must not be
  // scored by several chain modules. CoinJoin provenance (backward,
  // entity-proximity ancestry, ricochet) scores once. A backward entity
  // found by both entity proximity and taint (the parent's inputs) scores once.
  keepStrongest(findings.filter(isCoinJoinProvenanceBonus));
  keepStrongest(findings.filter(
    (f) => (f.id === "chain-entity-proximity-backward" || f.id === "chain-taint-backward") && f.scoreImpact < 0,
  ));

  // RBF x Change detection: RBF confirms which output is change. When both
  // h6-rbf-signaled and h2-change-detected fire, boost change confidence and
  // flag the compound (rbfCompound). RBF replacement reduces the change output
  // value, proving to any observer which output is change.
  const h6Rbf = findings.find((f) => f.id === "h6-rbf-signaled");
  const h2ChangeForRbf = findings.find((f) => f.id === "h2-change-detected" && f.scoreImpact < 0);
  if (h6Rbf && h2ChangeForRbf) {
    h2ChangeForRbf.confidence = "high";
    h2ChangeForRbf.scoreImpact += -2;
    // Localized text: the *_rbf context keys of h2-change-detected.description
    h2ChangeForRbf.params = {
      ...h2ChangeForRbf.params,
      confidence: "high",
      rbfCompound: 1,
      context: "rbf",
    };
    h2ChangeForRbf.description +=
      " RBF is signaled: a fee bump would shrink the change output, confirming to any observer which output is change.";
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
    if (findings.some((f) => (f.id === "h5-low-entropy" || f.id === "h5-zero-entropy" || f.id === "h5-zero-entropy-sweep") && f.scoreImpact < 0)) {
      boostCount++;
    }

    if (boostCount > 0) {
      const boost = Math.max(boostCount * -2, -6);
      h2Finding.scoreImpact += boost;
      h2Finding.params = {
        ...h2Finding.params,
        compoundBoost: boost,
        corroboratorCount: boostCount,
      };
      // Cap at "high" (Likely) - never "deterministic" for h2-change-detected.
      // Only h2-same-address-io is truly deterministic (output address matches
      // input address). Heuristic-based change detection can never be
      // "mathematically certain" regardless of corroboration count.
      if (boostCount >= 2 || h2Finding.severity === "low") {
        h2Finding.severity = boostCount >= 2 ? "high" : "medium";
        h2Finding.confidence = "high";
        // The i18n title interpolates params.confidence: keep it in sync with the badge
        h2Finding.params = { ...h2Finding.params, confidence: "high" };
      }
    }
  }

  // Post-mix to known entity: when post-mix consolidation is detected AND
  // outputs match known entity addresses, escalate severity. This catches
  // items 8.4: "Send to known exchange from post-mix" and
  // "Consolidation + exchange send in same tx".
  const hasPostMixConsolidation = findings.some(
    (f) => f.id === "post-mix-consolidation"
        || f.id === "chain-post-coinjoin-consolidation"
        || f.id === "chain-post-mix-consolidation",
  );
  const entityFinding = findings.find((f) => f.id === "entity-known-output");

  if (entityFinding && hasPostMixConsolidation) {
    entityFinding.severity = "critical";
    entityFinding.scoreImpact = -10;
    // Localized text: the finding.entity-known-output.*.postmix locale keys.
    // English copy for views without i18n (CLI, MCP):
    entityFinding.title = "Post-mix funds sent to known entity";
    entityFinding.description =
      "This transaction sends CoinJoin/post-mix outputs to a known exchange or service. " +
      "The receiving entity can identify that funds came from a CoinJoin, which may trigger compliance flags and source-of-funds requests. " +
      "The entity can also attempt to trace backward through the CoinJoin to de-anonymize the sender.";
    entityFinding.recommendation =
      "Never send directly from post-mix to KYC exchanges. Add intermediate hops, use P2P platforms (Bisq, RoboSats, HodlHodl), or route through Lightning Network.";
    entityFinding.params = {
      ...entityFinding.params,
      _variant: "postmix",
      context: "postmix-consolidation-to-entity",
    };
  }

  // Post-mix + backward CoinJoin dedup: when post-mix consolidation reduces
  // mixing benefit, scale down the CoinJoin provenance bonus.
  // For the chain-level detection (chain-post-mix-consolidation), scale the
  // bonus based on consolidation count: 2-3 keeps most of the bonus, 4+ loses it.
  // For heuristic-level detection (post-mix-consolidation, chain-post-coinjoin-consolidation),
  // zero it completely since those represent more severe scenarios.
  if (hasPostMixConsolidation) {
    const chainPostMix = findings.find((f) => f.id === "chain-post-mix-consolidation");
    const postMixCount = chainPostMix ? Number(chainPostMix.params?.postMixInputCount ?? 0) : 0;
    const isChainLevelOnly = chainPostMix && !findings.some(
      (f) => f.id === "post-mix-consolidation" || f.id === "chain-post-coinjoin-consolidation",
    );

    for (const f of findings) {
      if (isCoinJoinProvenanceBonus(f)) {
        if (isChainLevelOnly && postMixCount <= 3) {
          // Light consolidation (2-3): keep half the bonus
          f.scoreImpact = Math.round(f.scoreImpact * 0.5);
          f.params = { ...f.params, context: "reduced-by-consolidation" };
        } else {
          // Heavy consolidation (4+) or heuristic-level detection: zero it
          f.scoreImpact = 0;
          f.params = { ...f.params, context: "negated-by-consolidation" };
        }
      }
    }
  }
}
