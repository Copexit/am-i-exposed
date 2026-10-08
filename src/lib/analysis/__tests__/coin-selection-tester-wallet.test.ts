/**
 * Regression: the tester's signet wallet (11 UTXOs, mostly wallet change, one
 * CoinJoin change coin on 1/146), replayed as a history in two shapes. Paying
 * 600,000 sats at 5 sat/vB used to pick the 15,240,920-sat CoinJoin coin (the
 * smallest coin that covers), leaving 14.64M of change tied to the payment.
 * The tester expected 591,429 + 134,361; both that pair and the best single
 * coin must be shown, each with its trade-off.
 */
import { describe, it, expect } from "vitest";
import { testerHistory, testerPeelHistory, TESTER_KEPT as KEPT, TESTER_CJ_CHANGE as CJ_CHANGE } from "./fixtures/wallet-history";
import { adviseCoinSelection, buildCoinInputs, type CoinSelectionPlan } from "../coin-selection";
import { auditWallet } from "../wallet-audit";

const advise = (infos: Parameters<typeof buildCoinInputs>[0]) => {
  const a = adviseCoinSelection(buildCoinInputs(infos), 600_000, 5);
  if (a.kind !== "plans") throw new Error(a.kind);
  return a.plans;
};
const values = (p: CoinSelectionPlan) => p.selected.map((c) => c.utxo.value).sort((x, y) => y - x);
const pin = (p: CoinSelectionPlan) => [p.strategy, p.reason, values(p), p.fee, p.change, p.origins, p.groups, Math.round(p.cost * 100) / 100];

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

  it("600,000 sats at 5 sat/vB: the probably-linked pair first, the 164x single coin second, no CoinJoin coin", () => {
    const plans = advise(infos);
    // Pair: half a link (inferred) + change = 10. Single 99M: change + 3x + one link per tenfold past 10x (164x) = 27.58.
    // The CoinJoin coin alone costs 27.65 (bad change, 24x), just behind the 99M coin, so it is not the single-coin plan.
    expect(plans.map(pin)).toEqual([
      ["probably-linked", "inferred-links", [591_429, 134_361], 1_040, 124_750, 2, 1, 10],
      ["single-coin", "big-change", [99_000_000], 700, 98_399_300, 1, 1, 27.58],
    ]);
    expect(plans.flatMap((p) => p.selected).some((c) => c.utxo.value === CJ_CHANGE)).toBe(false);
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

  it("600,000 sats at 5 sat/vB: the pair still first (one new link beats a 164x change), the single coin shown with its cost", () => {
    const plans = advise(infos);
    expect(plans.map(pin)).toEqual([
      ["multi-coin", "links", [591_429, 134_361], 1_040, 124_750, 2, 2, 16],
      ["single-coin", "big-change", [99_000_000], 700, 98_399_300, 1, 1, 27.58],
    ]);
  });
});
