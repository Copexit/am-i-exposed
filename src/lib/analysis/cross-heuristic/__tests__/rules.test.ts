import { describe, it, expect } from "vitest";
import type { Finding, TxType } from "@/lib/types";
import type { FindingId } from "@/lib/analysis/finding-metadata";
import { applyCoinJoinSuppressions } from "../coinjoin-suppressions";
import { applyCompoundScoringAdjustments } from "../compound-scoring";
import { applyDeterministicScoreCap } from "../deterministic-cap";
import { applyWalletContradictionRules } from "../wallet-rules";
import { applyBehavioralRollup } from "../behavioral-rollup";
import { applyCrossHeuristicRules, classifyTransactionType } from "../index";

function f(id: FindingId, over: Partial<Finding> = {}): Finding {
  return {
    id,
    severity: "medium",
    title: id,
    description: "desc",
    recommendation: "rec",
    scoreImpact: -5,
    ...over,
  };
}

function byId(fs: Finding[], id: FindingId): Finding {
  const found = fs.find((x) => x.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

const total = (fs: Finding[]) => fs.reduce((s, x) => s + x.scoreImpact, 0);

describe("applyCoinJoinSuppressions", () => {
  it.each<FindingId>([
    "h2-change-detected",
    "script-mixed",
    "dust-spending",
    "h5-low-entropy",
    "dust-attack",
    "dust-outputs",
    "timing-unconfirmed",
    "h6-round-fee-rate",
    "h6-rbf-signaled",
    "h6-cpfp-detected",
    "anon-set-none",
    "anon-set-moderate",
    "h17-multisig-info",
    "consolidation-fan-in",
    "unnecessary-input",
    "bip69-detected",
    "witness-mixed-types",
    "witness-deep-stack",
    "h-coin-selection-bnb",
    "peel-chain",
    "chain-forward-peel",
  ])("zeroes %s with coinjoin context", (id) => {
    const fs = [f(id, { severity: "high" })];
    applyCoinJoinSuppressions(fs, false);
    expect(fs[0]).toMatchObject({ severity: "low", scoreImpact: 0, params: { context: "coinjoin" } });
  });

  it("tags CIOH and round amounts with stonewall context when stonewall", () => {
    const fs = [f("h3-cioh"), f("h1-round-amount")];
    applyCoinJoinSuppressions(fs, true);
    expect(byId(fs, "h3-cioh").params).toEqual({ context: "stonewall", _variant: "stonewall" });
    expect(byId(fs, "h1-round-amount").params).toEqual({ context: "stonewall" });
    expect(fs.every((x) => x.scoreImpact === 0)).toBe(true);
  });

  it("leaves self-send and OP_RETURN untouched", () => {
    const fs = [f("h2-self-send", { scoreImpact: -20 }), f("h7-op-return", { scoreImpact: -1 })];
    applyCoinJoinSuppressions(fs, false);
    expect(fs.map((x) => x.scoreImpact)).toEqual([-20, -1]);
  });

  it("gives stonewall anon-set-moderate its own context and explanation", () => {
    const fs = [f("anon-set-moderate")];
    applyCoinJoinSuppressions(fs, true);
    expect(fs[0]?.params?.context).toBe("stonewall");
    expect(fs[0]?.description).toMatch(/^desc In Stonewall/);
    // anon-set-none stays coinjoin even in a stonewall
    const none = [f("anon-set-none")];
    applyCoinJoinSuppressions(none, true);
    expect(none[0]?.params?.context).toBe("coinjoin");
  });

  it("sets entropy context without changing its impact", () => {
    const cj = [f("h5-entropy", { scoreImpact: 3 })];
    applyCoinJoinSuppressions(cj, false);
    expect(cj[0]).toMatchObject({ scoreImpact: 3, description: "desc", params: { context: "coinjoin" } });
    const sw = [f("h5-entropy", { scoreImpact: 3 })];
    applyCoinJoinSuppressions(sw, true);
    expect(sw[0]?.params?.context).toBe("stonewall");
    expect(sw[0]?.description).toContain("Stonewall transaction");
  });

  it.each([
    [{ isWabiSabi: 1 }, "h4-coinjoin", false, "Wasabi Wallet"],
    [{ isWasabi1: 1 }, "h4-coinjoin", false, "Wasabi Wallet"],
    [{}, "h4-whirlpool", false, "Ashigaru/Sparrow"],
    [{}, "h4-stonewall", true, "Ashigaru"],
  ] as const)("infers the wallet from CoinJoin params %o on %s", (params, cjId, stonewall, wallet) => {
    const fs = [f(cjId, { scoreImpact: 10, params: { ...params } }), f("h11-wallet-fingerprint")];
    applyCoinJoinSuppressions(fs, stonewall);
    const wf = byId(fs, "h11-wallet-fingerprint");
    expect(wf).toMatchObject({ severity: "low", scoreImpact: 0 });
    expect(wf.params).toMatchObject({ walletGuess: wallet, context: "identified_coinjoin" });
    expect(wf.params?.intentionalFingerprint).toBe(stonewall ? 1 : undefined);
  });

  it("keeps the fingerprint signals variant when no wallet is inferable", () => {
    const plain = [f("h4-coinjoin", { scoreImpact: 10 }), f("h11-wallet-fingerprint")];
    applyCoinJoinSuppressions(plain, false);
    expect(byId(plain, "h11-wallet-fingerprint").params).toEqual({ context: "signals_other_coinjoin" });

    const withCtx = [f("h11-wallet-fingerprint", { params: { context: "signals_locktime" } })];
    applyCoinJoinSuppressions(withCtx, false);
    expect(withCtx[0]?.params?.context).toBe("signals_locktime_coinjoin");
  });

  it("rewrites linkability recommendations for post-mix practice", () => {
    const fs = [f("linkability-deterministic"), f("linkability-equal-subset")];
    applyCoinJoinSuppressions(fs, false);
    expect(fs[0]?.recommendation).toMatch(/Spend post-mix outputs individually/);
    expect(fs[1]?.recommendation).toMatch(/Spend mixed equal-value outputs/);
    expect(fs.every((x) => x.params?.context === "coinjoin" && x.scoreImpact === -5)).toBe(true);
  });
});

describe("applyCompoundScoringAdjustments", () => {
  it("RBF plus change boosts change to high confidence and -2", () => {
    const fs = [f("h6-rbf-signaled", { scoreImpact: -1 }), f("h2-change-detected")];
    applyCompoundScoringAdjustments(fs);
    const ch = byId(fs, "h2-change-detected");
    expect(ch.scoreImpact).toBe(-7);
    expect(ch.confidence).toBe("high");
    expect(ch.params).toMatchObject({ rbfCompound: 1, confidence: "high", context: "rbf" });
    // English text (CLI/MCP) explains the compound
    expect(ch.description).toContain("RBF");
  });

  it("does not RBF-boost a suppressed change finding", () => {
    const fs = [f("h6-rbf-signaled"), f("h2-change-detected", { scoreImpact: 0, severity: "low" })];
    applyCompoundScoringAdjustments(fs);
    expect(byId(fs, "h2-change-detected").params?.rbfCompound).toBeUndefined();
  });

  it("one corroborator adds -2 and lifts low severity to medium", () => {
    const fs = [f("h2-change-detected", { severity: "low" }), f("peel-chain")];
    applyCompoundScoringAdjustments(fs);
    const ch = byId(fs, "h2-change-detected");
    expect(ch).toMatchObject({ scoreImpact: -7, severity: "medium", confidence: "high" });
    expect(ch.params).toMatchObject({ compoundBoost: -2, corroboratorCount: 1 });
  });

  it("one corroborator on a medium finding keeps severity and confidence", () => {
    const fs = [f("h2-change-detected"), f("h5-zero-entropy")];
    applyCompoundScoringAdjustments(fs);
    const ch = byId(fs, "h2-change-detected");
    expect(ch).toMatchObject({ scoreImpact: -7, severity: "medium" });
    expect(ch.confidence).toBeUndefined();
  });

  it("three corroborators cap at -6 and set high severity", () => {
    const fs = [f("h2-change-detected"), f("h11-wallet-fingerprint"), f("peel-chain"), f("h5-low-entropy")];
    applyCompoundScoringAdjustments(fs);
    const ch = byId(fs, "h2-change-detected");
    expect(ch).toMatchObject({ scoreImpact: -11, severity: "high", confidence: "high" });
    expect(ch.params).toMatchObject({ compoundBoost: -6, corroboratorCount: 3, confidence: "high" });
  });

  it("ignores corroborators with zero impact", () => {
    const fs = [f("h2-change-detected"), f("peel-chain", { scoreImpact: 0 })];
    applyCompoundScoringAdjustments(fs);
    expect(byId(fs, "h2-change-detected").scoreImpact).toBe(-5);
  });

  it("escalates an entity output to critical under post-mix consolidation", () => {
    const fs = [f("entity-known-output", { params: { entityName: "X" } }), f("post-mix-consolidation")];
    applyCompoundScoringAdjustments(fs);
    expect(byId(fs, "entity-known-output")).toMatchObject({
      severity: "critical",
      scoreImpact: -10,
      params: { entityName: "X", _variant: "postmix", context: "postmix-consolidation-to-entity" },
    });
    // English text (CLI/MCP) carries the escalated warning too
    const e = byId(fs, "entity-known-output");
    expect(e.title).toBe("Post-mix funds sent to known entity");
    expect(e.recommendation).toContain("Never send directly from post-mix to KYC exchanges");
  });

  it("leaves an entity output alone without post-mix consolidation", () => {
    const fs = [f("entity-known-output")];
    applyCompoundScoringAdjustments(fs);
    expect(fs[0]).toMatchObject({ severity: "medium", scoreImpact: -5 });
  });

  it("halves the CoinJoin input bonus for light chain-level consolidation", () => {
    const fs = [
      f("chain-post-mix-consolidation", { params: { postMixInputCount: 3 } }),
      f("chain-coinjoin-input", { scoreImpact: 5 }),
    ];
    applyCompoundScoringAdjustments(fs);
    expect(byId(fs, "chain-coinjoin-input")).toMatchObject({
      scoreImpact: 3,
      params: { context: "reduced-by-consolidation" },
    });
  });

  it.each([
    ["heavy chain-level", [f("chain-post-mix-consolidation", { params: { postMixInputCount: 4 } })]],
    ["heuristic-level", [f("post-mix-consolidation")]],
    [
      "chain plus coinjoin-level",
      [
        f("chain-post-mix-consolidation", { params: { postMixInputCount: 2 } }),
        f("chain-post-coinjoin-consolidation"),
      ],
    ],
  ])("zeroes the CoinJoin input bonus for %s consolidation", (_label, extra) => {
    const fs = [...extra, f("chain-coinjoin-input", { scoreImpact: 5 })];
    applyCompoundScoringAdjustments(fs);
    expect(byId(fs, "chain-coinjoin-input")).toMatchObject({
      scoreImpact: 0,
      params: { context: "negated-by-consolidation" },
    });
  });
});

describe("applyCompoundScoringAdjustments: chain overlap", () => {
  it("scores CoinJoin provenance once for a spend from one CoinJoin output", () => {
    const fs = [
      f("chain-coinjoin-input", { severity: "good", scoreImpact: 8 }),
      f("chain-coinjoin-ancestry", { severity: "good", scoreImpact: 5 }),
      f("chain-ricochet", { severity: "good", scoreImpact: 5, params: { hops: 2 } }),
    ];
    applyCompoundScoringAdjustments(fs);
    expect(total(fs)).toBe(8);
    expect(byId(fs, "chain-coinjoin-ancestry").params?.context).toBe("overlap");
  });

  it("keeps an Ashigaru Ricochet hop bonus apart from CoinJoin provenance", () => {
    const fs = [
      f("chain-coinjoin-ancestry", { severity: "good", scoreImpact: 5 }),
      f("chain-ricochet", { severity: "good", scoreImpact: 5, params: { wallet: "Ashigaru" } }),
    ];
    applyCompoundScoringAdjustments(fs);
    expect(total(fs)).toBe(10);
  });

  it("post-mix consolidation cancels whichever CoinJoin provenance bonus survives", () => {
    const fs = [
      f("post-mix-consolidation", { scoreImpact: -5 }),
      f("chain-coinjoin-input", { severity: "good", scoreImpact: 8 }),
      f("chain-coinjoin-ancestry", { severity: "good", scoreImpact: 5 }),
    ];
    applyCompoundScoringAdjustments(fs);
    expect(total(fs)).toBe(-5);

    const ancestryOnly = [f("post-mix-consolidation", { scoreImpact: -5 }), f("chain-coinjoin-ancestry", { severity: "good", scoreImpact: 5 })];
    applyCompoundScoringAdjustments(ancestryOnly);
    expect(total(ancestryOnly)).toBe(-5);
  });

  it("scores a backward entity once when proximity and taint both find it (same category)", () => {
    const fs = [
      f("chain-entity-proximity-backward", { scoreImpact: -4, params: { category: "exchange" } }),
      f("chain-taint-backward", { scoreImpact: -5, params: { sourceCategories: "mining,exchange" } }),
    ];
    applyCompoundScoringAdjustments(fs);
    expect(total(fs)).toBe(-5);
    expect(byId(fs, "chain-entity-proximity-backward").scoreImpact).toBe(0);
  });

  it("keeps both penalties when proximity and taint found different entity categories", () => {
    const fs = [
      f("chain-entity-proximity-backward", { scoreImpact: -4, params: { category: "darknet" } }),
      f("chain-taint-backward", { scoreImpact: -5, params: { sourceCategories: "exchange" } }),
    ];
    applyCompoundScoringAdjustments(fs);
    expect(total(fs)).toBe(-9);
  });
});

describe("applyDeterministicScoreCap", () => {
  it("pushes a cap bringing total impact to -46", () => {
    const fs = [f("h2-same-address-io", { scoreImpact: -10 }), f("h4-coinjoin", { scoreImpact: 15 })];
    applyDeterministicScoreCap(fs);
    expect(byId(fs, "compound-deterministic-cap").scoreImpact).toBe(-51);
    expect(total(fs)).toBe(-46);
  });

  it("adds nothing when the score is already at or below the cap", () => {
    const fs = [f("h2-same-address-io", { scoreImpact: -46 })];
    applyDeterministicScoreCap(fs);
    expect(fs).toHaveLength(1);
  });

  it("ignores a suppressed deterministic finding and non-deterministic ids", () => {
    const fs = [f("h2-same-address-io", { scoreImpact: 0 }), f("h2-self-send", { scoreImpact: -20 })];
    applyDeterministicScoreCap(fs);
    expect(fs).toHaveLength(2);
  });
});

describe("applyWalletContradictionRules", () => {
  it("flags a Wasabi fingerprint plus address reuse (case-insensitive)", () => {
    const fs = [
      f("h11-wallet-fingerprint", { params: { walletGuess: "WASABI Wallet" } }),
      f("h8-address-reuse", { scoreImpact: -20 }),
    ];
    applyWalletContradictionRules(fs);
    expect(byId(fs, "cross-wasabi-reuse-paradox")).toMatchObject({
      severity: "high",
      scoreImpact: 0,
      params: { context: "wasabi-reuse-paradox" },
    });
  });

  it.each([
    ["another wallet", [f("h11-wallet-fingerprint", { params: { walletGuess: "Electrum" } }), f("h8-address-reuse")]],
    [
      "suppressed reuse",
      [f("h11-wallet-fingerprint", { params: { walletGuess: "Wasabi" } }), f("h8-address-reuse", { scoreImpact: 0 })],
    ],
    ["a non-string guess", [f("h11-wallet-fingerprint", { params: { walletGuess: 1 } }), f("h8-address-reuse")]],
  ])("does nothing for %s", (_label, fs) => {
    applyWalletContradictionRules(fs);
    expect(fs).toHaveLength(2);
  });
});

describe("applyBehavioralRollup", () => {
  it("emits a high rollup at two signals and a critical one at four", () => {
    const two = [f("bip69-detected"), f("h6-round-fee-rate"), f("h3-cioh")];
    applyBehavioralRollup(two);
    expect(byId(two, "behavioral-fingerprint-rollup")).toMatchObject({
      severity: "high",
      scoreImpact: -6,
      params: { signalCount: 2, signals: "bip69-detected, h6-round-fee-rate" },
    });

    const four = [f("bip69-detected"), f("h6-round-fee-rate"), f("witness-deep-stack"), f("h-coin-selection-bnb")];
    applyBehavioralRollup(four);
    expect(byId(four, "behavioral-fingerprint-rollup")).toMatchObject({
      severity: "critical",
      scoreImpact: -12,
      params: { context: "strong", signalCount: 4 },
    });
  });

  it("does not count zero-impact or non-behavioral findings", () => {
    const fs = [f("bip69-detected"), f("h6-round-fee-rate", { scoreImpact: 0 }), f("h3-cioh")];
    applyBehavioralRollup(fs);
    expect(fs).toHaveLength(3);
  });
});

describe("applyCrossHeuristicRules (index-local rules)", () => {
  it("suppresses script-mixed, CIOH and consolidation under multisig", () => {
    const fs = [f("h17-multisig-info", { scoreImpact: 0 }), f("script-mixed"), f("h3-cioh"), f("consolidation-fan-in")];
    applyCrossHeuristicRules(fs);
    for (const id of ["script-mixed", "h3-cioh", "consolidation-fan-in"] as const) {
      expect(byId(fs, id)).toMatchObject({ scoreImpact: 0, params: { context: "multisig" } });
    }
  });

  it("CIOH covers unnecessary-input and softens heavy consolidation to -2", () => {
    const fs = [f("h3-cioh"), f("unnecessary-input"), f("consolidation-fan-out", { scoreImpact: -8 })];
    applyCrossHeuristicRules(fs);
    expect(byId(fs, "unnecessary-input")).toMatchObject({ scoreImpact: 0, params: { context: "cioh-covers" } });
    expect(byId(fs, "consolidation-fan-out")).toMatchObject({ scoreImpact: -2, params: { context: "cioh-covers" } });
    expect(byId(fs, "h3-cioh").scoreImpact).toBe(-5);
  });

  it("self-send consolidation suppresses zero-entropy; fan-in removes the sweep", () => {
    const fs = [f("h2-self-send", { params: { allMatch: 1 } }), f("h5-zero-entropy")];
    applyCrossHeuristicRules(fs);
    expect(byId(fs, "h5-zero-entropy")).toMatchObject({ scoreImpact: 0, params: { context: "consolidation" } });

    const sweep = [f("consolidation-fan-in"), f("h5-zero-entropy-sweep")];
    applyCrossHeuristicRules(sweep);
    expect(sweep.map((x) => x.id)).toEqual(["consolidation-fan-in"]);
  });

  it("runs CoinJoin suppression only for a positive CoinJoin finding", () => {
    const suppressedCj = [f("h4-coinjoin", { scoreImpact: 0 }), f("dust-spending")];
    applyCrossHeuristicRules(suppressedCj);
    expect(byId(suppressedCj, "dust-spending").scoreImpact).toBe(-5);

    const cj = [f("h4-coinjoin", { scoreImpact: 10 }), f("dust-spending")];
    applyCrossHeuristicRules(cj);
    expect(byId(cj, "dust-spending").scoreImpact).toBe(0);
  });

  it("applies the deterministic cap after the behavioral rollup", () => {
    const fs = [f("h2-same-address-io", { scoreImpact: -10 }), f("bip69-detected"), f("h6-round-fee-rate")];
    applyCrossHeuristicRules(fs);
    expect(fs.at(-1)?.id).toBe("compound-deterministic-cap");
    expect(total(fs)).toBe(-46);
  });
});

describe("classifyTransactionType", () => {
  it.each<[string, Finding[], TxType]>([
    ["nothing", [], "simple-payment"],
    ["whirlpool over generic", [f("h4-whirlpool", { scoreImpact: 0 }), f("h4-coinjoin")], "whirlpool-coinjoin"],
    ["wasabi1", [f("h4-coinjoin", { params: { isWasabi1: 1 } })], "wasabi1-coinjoin"],
    ["wabisabi", [f("h4-coinjoin", { params: { isWabiSabi: 1 } })], "wabisabi-coinjoin"],
    ["joinmarket over generic", [f("h4-joinmarket"), f("h4-coinjoin")], "joinmarket-coinjoin"],
    ["generic", [f("h4-coinjoin")], "generic-coinjoin"],
    ["stonewall", [f("h4-stonewall")], "stonewall"],
    ["simplified stonewall", [f("h4-simplified-stonewall")], "simplified-stonewall"],
    ["tx0", [f("tx0-premix")], "tx0-premix"],
    ["bip47", [f("bip47-notification")], "bip47-notification"],
    ["ricochet", [f("chain-ricochet")], "ricochet"],
    ["coinbase", [f("coinbase-transaction")], "coinbase"],
    ["HodlHodl entity over peel", [f("entity-known-input", { params: { entityName: "HodlHodl" } }), f("peel-chain")], "p2p-escrow"],
    ["hodlhodl multisig", [f("h17-hodlhodl")], "p2p-escrow"],
    ["self-send over fan-in", [f("h2-self-send"), f("consolidation-fan-in")], "self-transfer"],
    ["fan-in", [f("consolidation-fan-in")], "consolidation"],
    ["exchange withdrawal", [f("exchange-withdrawal-pattern")], "exchange-withdrawal"],
    ["fan-out", [f("consolidation-fan-out")], "batch-payment"],
    ["peel", [f("peel-chain")], "peel-chain"],
    ["suppressed structural", [f("peel-chain", { scoreImpact: 0 }), f("consolidation-fan-in", { scoreImpact: 0 })], "simple-payment"],
    ["other entity", [f("entity-known-output", { params: { entityName: "Binance" } })], "simple-payment"],
  ])("%s -> %s", (_label, fs, expected) => {
    expect(classifyTransactionType(fs)).toBe(expected);
  });
});
