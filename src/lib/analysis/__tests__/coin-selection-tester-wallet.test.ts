/**
 * Regression: the tester's signet wallet (11 UTXOs, mostly wallet change, one
 * CoinJoin change coin on 1/146), replayed as a history in two shapes. Paying
 * 600,000 sats at 5 sat/vB used to pick the 15,240,920-sat CoinJoin coin (the
 * smallest coin that covers), leaving 14.64M of change tied to the payment.
 * The tester expected 591,429 + 134,361; both that pair and the best single
 * coin must be shown, each with its trade-off. Later the tester asked to see
 * the options instead of one verdict: the CoinJoin change coin is listed too,
 * with its warning. Under "spend change on its own" (every coin here is
 * change), the pair merges two change coins: it stays an option (least
 * change) but ranks below each change coin spent alone.
 */
import { describe, it, expect } from "vitest";
import { testerHistory, testerPeelHistory, TESTER_KEPT as KEPT, TESTER_CJ_CHANGE as CJ_CHANGE } from "./fixtures/wallet-history";
import { adviseCoinSelection, buildCoinInputs, rankPlans, type CoinSelectionPlan } from "../coin-selection";
import { auditWallet } from "../wallet-audit";

const advise = (infos: Parameters<typeof buildCoinInputs>[0]) => {
  const a = adviseCoinSelection(buildCoinInputs(infos), 600_000, 5);
  if (a.kind !== "plans") throw new Error(a.kind);
  return a.plans;
};
const values = (p: CoinSelectionPlan) => p.selected.map((c) => c.utxo.value).sort((x, y) => y - x);
const pin = (p: CoinSelectionPlan) => [p.strategy, values(p), p.fee, p.change, p.origins, p.groups, p.facts.violations, p.facts.change];

describe("tester wallet replay: payments with two wallet outputs (kept coin + rest)", () => {
  const { h, addresses } = testerHistory();
  const infos = h.infos(addresses);
  const coins = buildCoinInputs(infos);

  it("has the tester's 11 UTXOs, the 15,240,920 coin as CoinJoin change (not mixed)", () => {
    expect(coins.map((c) => c.utxo.value).sort((a, b) => b - a)).toEqual([...KEPT.slice(0, 8), CJ_CHANGE, ...KEPT.slice(8)]);
    expect(coins.find((c) => c.utxo.value === CJ_CHANGE)!.origin).toBe("coinjoin-change");
    // Siblings of each payment: every coin its own certain cluster, all one inferred cluster
    expect(new Set(coins.map((c) => c.cluster)).size).toBe(11);
    expect(new Set(coins.map((c) => c.group)).size).toBe(1);
    const o = auditWallet(infos).utxoOrigins;
    expect(Object.values(o).reduce((s, x) => s + x.count, 0)).toBe(11);
    expect([o["coinjoin-change"].count, o.change.count]).toEqual([1, 10]);
  });

  it("600,000 sats at 5 sat/vB: the 164x change coin alone first, the CoinJoin change coin (toxic change) second, the change pair last", () => {
    const plans = advise(infos);
    // Tier a: the pair merges change. Tier d among the singles: huge before toxic.
    expect(plans.map(pin)).toEqual([
      ["single-coin", [99_000_000], 700, 98_399_300, 1, 1, [], "huge"],
      ["single-coin", [CJ_CHANGE], 700, 14_640_220, 1, 1, [], "toxic"],
      ["probably-linked", [591_429, 134_361], 1_040, 124_750, 2, 1, ["change-merge"], "small"],
    ]);
    expect(plans[1]!.warnings.map((w) => w.id)).toContain("coinjoin-change");
    expect(plans[2]!.warnings[0]).toMatchObject({ id: "change-merge", severity: "high", count: 1 });
  });

  it("orders the same plans by each criterion, as the numbers say", () => {
    const plans = advise(infos);
    const order = (c: Parameters<typeof rankPlans>[1]) => rankPlans(plans, c).map((p) => values(p)[0]);
    // Least change: the pair (124,750) before the CoinJoin coin (14.6M) before the 99M coin
    expect(order("least-change")).toEqual([591_429, CJ_CHANGE, 99_000_000]);
    // Nothing is changeless: same as Privacy first
    expect(order("no-change")).toEqual([99_000_000, CJ_CHANGE, 591_429]);
    // One coin beats two; among single coins, Privacy first decides
    expect(order("fewest-coins")).toEqual([99_000_000, CJ_CHANGE, 591_429]);
    expect(order("lowest-fee")).toEqual([99_000_000, CJ_CHANGE, 591_429]);
  });
});

describe("tester wallet replay: peel shape, one wallet output per tx", () => {
  const { h, addresses } = testerPeelHistory();
  const infos = h.infos(addresses);

  it("links each coin certainly to its receipt only: 11 clusters, certain and inferred alike", () => {
    const coins = buildCoinInputs(infos);
    expect(coins).toHaveLength(11);
    expect(new Set(coins.map((c) => c.cluster)).size).toBe(11);
    expect(new Set(coins.map((c) => c.group)).size).toBe(11);
  });

  it("600,000 sats at 5 sat/vB: same order; the pair is a new certain link here", () => {
    const plans = advise(infos);
    expect(plans.map(pin)).toEqual([
      ["single-coin", [99_000_000], 700, 98_399_300, 1, 1, [], "huge"],
      ["single-coin", [CJ_CHANGE], 700, 14_640_220, 1, 1, [], "toxic"],
      ["multi-coin", [591_429, 134_361], 1_040, 124_750, 2, 2, ["change-merge"], "small"],
    ]);
  });
});
