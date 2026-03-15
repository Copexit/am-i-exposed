import { describe, it, expect } from "vitest";
import {
  selectRecommendations,
  type RecommendationContext,
} from "../primary-recommendation";
import type { Finding, Grade } from "@/lib/types";

/** Helper: create a minimal finding with given id and optional overrides */
function f(id: string, overrides?: Partial<Finding>): Finding {
  return {
    id,
    severity: "medium",
    title: id,
    description: "",
    recommendation: "",
    scoreImpact: -5,
    ...overrides,
  };
}

/** Helper: create a CoinJoin finding (positive scoreImpact, matching ID) */
function cjFinding(variant: "whirlpool" | "wabisabi" | "joinmarket" = "whirlpool"): Finding {
  const ids: Record<string, string> = {
    whirlpool: "h4-whirlpool",
    wabisabi: "h4-coinjoin",
    joinmarket: "h4-joinmarket",
  };
  return f(ids[variant], { scoreImpact: 15, severity: "good" });
}

function ctx(
  findings: Finding[],
  grade: Grade = "C",
  walletGuess: string | null = null,
): RecommendationContext {
  return { findings, grade, walletGuess };
}

// ── Tier 0: Deterministic failures ──────────────────────────────────

describe("Tier 0 - Deterministic failures", () => {
  it("h2-same-address-io triggers rec-self-send", () => {
    const [primary, secondary] = selectRecommendations(
      ctx([f("h2-same-address-io")]),
    );
    expect(primary.id).toBe("rec-self-send");
    expect(primary.urgency).toBe("immediate");
    expect(secondary).toBeNull();
  });

  it("h2-self-send triggers rec-self-send", () => {
    const [primary] = selectRecommendations(ctx([f("h2-self-send")]));
    expect(primary.id).toBe("rec-self-send");
  });

  it("h8-address-reuse triggers rec-address-reuse", () => {
    const [primary, secondary] = selectRecommendations(
      ctx([f("h8-address-reuse")]),
    );
    expect(primary.id).toBe("rec-address-reuse");
    expect(primary.urgency).toBe("immediate");
    expect(secondary).toBeNull();
  });

  it("Tier 0 takes priority over all lower tiers", () => {
    const [primary] = selectRecommendations(
      ctx([
        f("h2-same-address-io"),
        f("entity-known-output"),
        f("post-mix-consolidation"),
        f("h3-cioh", { params: { inputCount: 15 } }),
      ]),
    );
    expect(primary.id).toBe("rec-self-send");
  });
});

// ── Tier 1: Critical findings ───────────────────────────────────────

describe("Tier 1 - Critical findings", () => {
  it("entity-known-output + post-mix-consolidation triggers rec-postmix-to-entity", () => {
    const [primary] = selectRecommendations(
      ctx([f("entity-known-output"), f("post-mix-consolidation")]),
    );
    expect(primary.id).toBe("rec-postmix-to-entity");
    expect(primary.urgency).toBe("immediate");
  });

  it("entity-known-output + chain-post-coinjoin-consolidation also triggers rec-postmix-to-entity", () => {
    const [primary] = selectRecommendations(
      ctx([f("entity-known-output"), f("chain-post-coinjoin-consolidation")]),
    );
    expect(primary.id).toBe("rec-postmix-to-entity");
  });

  it("post-mix-consolidation alone triggers rec-postmix-consolidation", () => {
    const [primary] = selectRecommendations(
      ctx([f("post-mix-consolidation")]),
    );
    expect(primary.id).toBe("rec-postmix-consolidation");
    expect(primary.urgency).toBe("immediate");
  });

  it("dust-attack triggers rec-dust", () => {
    const [primary] = selectRecommendations(ctx([f("dust-attack")]));
    expect(primary.id).toBe("rec-dust");
    expect(primary.urgency).toBe("immediate");
    expect(primary.tool?.name).toBe("Sparrow Wallet");
  });
});

// ── Tier 2: Structural issues ───────────────────────────────────────

describe("Tier 2 - Structural issues", () => {
  it("entity-known-output without post-mix triggers rec-entity-output (soon)", () => {
    const [primary] = selectRecommendations(ctx([f("entity-known-output")]));
    expect(primary.id).toBe("rec-entity-output");
    expect(primary.urgency).toBe("soon");
  });

  it("entity-known-output with CoinJoin uses CJ-specific detail", () => {
    const [primary] = selectRecommendations(
      ctx([f("entity-known-output"), cjFinding()]),
    );
    expect(primary.id).toBe("rec-entity-output");
    expect(primary.detailKey).toBe("primaryRec.entityOutputCJ.detail");
    expect(primary.detailDefault).toContain("mixed UTXOs");
  });

  it("entity-known-output without CoinJoin uses generic detail", () => {
    const [primary] = selectRecommendations(ctx([f("entity-known-output")]));
    expect(primary.detailKey).toBe("primaryRec.entityOutput.detail");
    expect(primary.detailDefault).toContain("links your UTXOs");
  });

  it("h3-cioh with 10+ inputs gets secondary Stonewall rec", () => {
    const [primary, secondary] = selectRecommendations(
      ctx([f("h3-cioh", { scoreImpact: -8, params: { inputCount: 12 } })]),
    );
    expect(primary.id).toBe("rec-cioh");
    expect(primary.urgency).toBe("soon");
    expect(secondary).not.toBeNull();
    expect(secondary!.id).toBe("rec-cioh-stonewall");
  });

  it("h3-cioh with 3+ inputs gets secondary Stonewall rec", () => {
    const [primary, secondary] = selectRecommendations(
      ctx([f("h3-cioh", { scoreImpact: -5, params: { inputCount: 4 } })]),
    );
    expect(primary.id).toBe("rec-cioh");
    expect(secondary).not.toBeNull();
    expect(secondary!.id).toBe("rec-cioh-stonewall");
  });

  it("h3-cioh with 2 inputs has no secondary", () => {
    const [primary, secondary] = selectRecommendations(
      ctx([f("h3-cioh", { scoreImpact: -3, params: { inputCount: 2 } })]),
    );
    expect(primary.id).toBe("rec-cioh");
    expect(secondary).toBeNull();
  });

  it("h3-cioh with CoinJoin is skipped (CIOH not relevant for CoinJoin)", () => {
    const [primary] = selectRecommendations(
      ctx([
        f("h3-cioh", { scoreImpact: -5, params: { inputCount: 4 } }),
        cjFinding(),
      ], "B"),
    );
    // Should skip CIOH and fall through to grade-based rec
    expect(primary.id).not.toBe("rec-cioh");
  });

  it("h3-cioh with positive scoreImpact is skipped", () => {
    const [primary] = selectRecommendations(
      ctx([f("h3-cioh", { scoreImpact: 2, params: { inputCount: 4 } })], "C"),
    );
    expect(primary.id).not.toBe("rec-cioh");
  });

  it("peel-chain + h2-change-detected triggers rec-peel-chain", () => {
    const [primary] = selectRecommendations(
      ctx([f("peel-chain"), f("h2-change-detected")]),
    );
    expect(primary.id).toBe("rec-peel-chain");
    expect(primary.urgency).toBe("soon");
  });

  it("peel-chain alone does NOT trigger rec-peel-chain (requires change)", () => {
    const [primary] = selectRecommendations(ctx([f("peel-chain")], "C"));
    expect(primary.id).not.toBe("rec-peel-chain");
  });

  it("h2-change-detected with 2+ corroborators triggers rec-change-compound", () => {
    const [primary] = selectRecommendations(
      ctx([f("h2-change-detected", { params: { corroboratorCount: 3 } })]),
    );
    expect(primary.id).toBe("rec-change-compound");
    expect(primary.urgency).toBe("soon");
  });
});

// ── Tier 3: Moderate issues ─────────────────────────────────────────

describe("Tier 3 - Moderate issues", () => {
  it("exchange-withdrawal-pattern triggers rec-exchange-withdrawal", () => {
    const [primary] = selectRecommendations(
      ctx([f("exchange-withdrawal-pattern")]),
    );
    expect(primary.id).toBe("rec-exchange-withdrawal");
    expect(primary.urgency).toBe("when-convenient");
  });

  it("h2-change-detected with <2 corroborators triggers rec-change-single", () => {
    const [primary] = selectRecommendations(
      ctx([f("h2-change-detected", { params: { corroboratorCount: 1 } })]),
    );
    expect(primary.id).toBe("rec-change-single");
    expect(primary.urgency).toBe("when-convenient");
  });

  it("h5-low-entropy triggers rec-low-entropy", () => {
    const [primary] = selectRecommendations(
      ctx([f("h5-low-entropy", { scoreImpact: -3 })]),
    );
    expect(primary.id).toBe("rec-low-entropy");
    expect(primary.urgency).toBe("when-convenient");
  });

  it("h5-zero-entropy with scoreImpact 0 (sweep) is skipped", () => {
    const [primary] = selectRecommendations(
      ctx([f("h5-zero-entropy", { scoreImpact: 0 })], "C"),
    );
    expect(primary.id).not.toBe("rec-low-entropy");
  });

  it("h5-zero-entropy with negative scoreImpact triggers rec-low-entropy", () => {
    const [primary] = selectRecommendations(
      ctx([f("h5-zero-entropy", { scoreImpact: -3 })]),
    );
    expect(primary.id).toBe("rec-low-entropy");
  });

  it("entropy findings skipped when CoinJoin is present", () => {
    const [primary] = selectRecommendations(
      ctx([f("h5-low-entropy", { scoreImpact: -3 }), cjFinding()], "B"),
    );
    expect(primary.id).not.toBe("rec-low-entropy");
  });

  it("h1-round-amount triggers rec-round-amount", () => {
    const [primary] = selectRecommendations(ctx([f("h1-round-amount")]));
    expect(primary.id).toBe("rec-round-amount");
    expect(primary.urgency).toBe("when-convenient");
  });

  it("h1-round-usd-amount also triggers rec-round-amount", () => {
    const [primary] = selectRecommendations(ctx([f("h1-round-usd-amount")]));
    expect(primary.id).toBe("rec-round-amount");
  });

  it("h1-round-eur-amount also triggers rec-round-amount", () => {
    const [primary] = selectRecommendations(ctx([f("h1-round-eur-amount")]));
    expect(primary.id).toBe("rec-round-amount");
  });
});

// ── Tier 4: Positive / grade-based ──────────────────────────────────

describe("Tier 4 - Positive / grade-based", () => {
  it("A+ with CoinJoin returns dual rec (primary + Lightning secondary)", () => {
    const [primary, secondary] = selectRecommendations(
      ctx([cjFinding()], "A+"),
    );
    expect(primary.id).toBe("rec-a-plus-cj");
    expect(primary.urgency).toBe("when-convenient");
    expect(secondary).not.toBeNull();
    expect(secondary!.id).toBe("rec-a-plus-cj-ln");
  });

  it("A+ without CoinJoin returns rec-a-plus", () => {
    const [primary, secondary] = selectRecommendations(ctx([], "A+"));
    expect(primary.id).toBe("rec-a-plus");
    expect(secondary).toBeNull();
  });

  it("B grade returns rec-b-grade", () => {
    const [primary] = selectRecommendations(ctx([], "B"));
    expect(primary.id).toBe("rec-b-grade");
  });

  it("B grade with CoinJoin gets CoinJoin-specific detail", () => {
    const [primary] = selectRecommendations(ctx([cjFinding()], "B"));
    expect(primary.detailDefault).toContain("post-mix");
    expect(primary.guideLink).toBe("/guide#coin-control");
  });

  it("B grade without CoinJoin gets generic detail", () => {
    const [primary] = selectRecommendations(ctx([], "B"));
    expect(primary.detailDefault).toContain("Consider CoinJoin");
    expect(primary.guideLink).toBe("/guide#payjoin-v2");
  });

  it("fallback for C/D/F with no matching findings", () => {
    const [primary, secondary] = selectRecommendations(ctx([], "C"));
    expect(primary.id).toBe("rec-fallback");
    expect(primary.urgency).toBe("when-convenient");
    expect(secondary).toBeNull();
  });
});

// ── Wallet-aware tool selection ─────────────────────────────────────

describe("Wallet-aware tool selection (pickTool)", () => {
  it("wallet-switch: default recommends Sparrow", () => {
    const [primary] = selectRecommendations(
      ctx([f("h2-same-address-io")]),
    );
    expect(primary.tool?.name).toBe("Sparrow Wallet");
  });

  it("wallet-switch: Sparrow user gets Ashigaru", () => {
    const [primary] = selectRecommendations(
      ctx([f("h2-same-address-io")], "C", "Sparrow Wallet"),
    );
    expect(primary.tool?.name).toBe("Ashigaru");
  });

  it("wallet-switch: Ashigaru user gets Sparrow", () => {
    const [primary] = selectRecommendations(
      ctx([f("h2-same-address-io")], "C", "Ashigaru"),
    );
    expect(primary.tool?.name).toBe("Sparrow Wallet");
  });

  it("coin-control: Sparrow user gets no tool (already has it)", () => {
    const [primary] = selectRecommendations(
      ctx(
        [f("h3-cioh", { scoreImpact: -5, params: { inputCount: 4 } })],
        "C",
        "Sparrow Wallet",
      ),
    );
    expect(primary.id).toBe("rec-cioh");
    expect(primary.tool).toBeUndefined();
  });

  it("coin-control: unknown wallet gets Sparrow", () => {
    const [primary] = selectRecommendations(
      ctx([f("h3-cioh", { scoreImpact: -5, params: { inputCount: 4 } })]),
    );
    expect(primary.tool?.name).toBe("Sparrow Wallet");
  });

  it("payjoin: always recommends Cake Wallet", () => {
    const [primary] = selectRecommendations(
      ctx([f("peel-chain"), f("h2-change-detected")]),
    );
    expect(primary.tool?.name).toBe("Cake Wallet");
  });

  it("lightning: always recommends Phoenix", () => {
    const [primary] = selectRecommendations(ctx([f("h1-round-amount")]));
    expect(primary.tool?.name).toBe("Phoenix");
  });
});

// ── Cascade priority ordering ───────────────────────────────────────

describe("Cascade priority - higher tier wins", () => {
  it("Tier 0 beats Tier 1", () => {
    const [primary] = selectRecommendations(
      ctx([f("h8-address-reuse"), f("dust-attack")]),
    );
    expect(primary.id).toBe("rec-address-reuse");
  });

  it("Tier 1 beats Tier 2", () => {
    const [primary] = selectRecommendations(
      ctx([f("dust-attack"), f("entity-known-output")]),
    );
    expect(primary.id).toBe("rec-dust");
  });

  it("Tier 2 beats Tier 3", () => {
    const [primary] = selectRecommendations(
      ctx([
        f("entity-known-output"),
        f("h1-round-amount"),
        f("exchange-withdrawal-pattern"),
      ]),
    );
    expect(primary.id).toBe("rec-entity-output");
  });

  it("Tier 3 beats Tier 4", () => {
    const [primary] = selectRecommendations(
      ctx([f("h1-round-amount")], "A+"),
    );
    expect(primary.id).toBe("rec-round-amount");
  });

  it("within Tier 0: same-address-io beats address-reuse", () => {
    const [primary] = selectRecommendations(
      ctx([f("h2-same-address-io"), f("h8-address-reuse")]),
    );
    expect(primary.id).toBe("rec-self-send");
  });

  it("within Tier 1: postmix-to-entity beats standalone postmix", () => {
    const [primary] = selectRecommendations(
      ctx([
        f("entity-known-output"),
        f("post-mix-consolidation"),
        f("dust-attack"),
      ]),
    );
    expect(primary.id).toBe("rec-postmix-to-entity");
  });
});

// ── Every recommendation has required fields ────────────────────────

describe("All recommendations have required fields", () => {
  const scenarios: [string, RecommendationContext][] = [
    ["self-send", ctx([f("h2-same-address-io")])],
    ["address-reuse", ctx([f("h8-address-reuse")])],
    ["postmix-entity", ctx([f("entity-known-output"), f("post-mix-consolidation")])],
    ["postmix-consolidation", ctx([f("post-mix-consolidation")])],
    ["dust", ctx([f("dust-attack")])],
    ["entity-output", ctx([f("entity-known-output")])],
    ["cioh", ctx([f("h3-cioh", { scoreImpact: -5, params: { inputCount: 4 } })])],
    ["peel-chain", ctx([f("peel-chain"), f("h2-change-detected")])],
    ["change-compound", ctx([f("h2-change-detected", { params: { corroboratorCount: 3 } })])],
    ["exchange-withdrawal", ctx([f("exchange-withdrawal-pattern")])],
    ["change-single", ctx([f("h2-change-detected", { params: { corroboratorCount: 1 } })])],
    ["low-entropy", ctx([f("h5-low-entropy", { scoreImpact: -3 })])],
    ["round-amount", ctx([f("h1-round-amount")])],
    ["a-plus-cj", ctx([cjFinding()], "A+")],
    ["a-plus", ctx([], "A+")],
    ["b-grade", ctx([], "B")],
    ["fallback", ctx([], "C")],
  ];

  it.each(scenarios)("%s has id, urgency, headlineKey, detailKey, guideLink", (_name, c) => {
    const [primary] = selectRecommendations(c);
    expect(primary.id).toBeTruthy();
    expect(["immediate", "soon", "when-convenient"]).toContain(primary.urgency);
    expect(primary.headlineKey).toBeTruthy();
    expect(primary.headlineDefault).toBeTruthy();
    expect(primary.detailKey).toBeTruthy();
    expect(primary.detailDefault).toBeTruthy();
    expect(primary.guideLink).toBeTruthy();
  });
});
