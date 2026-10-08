/**
 * Regression: the tester's signet wallet (11 UTXOs, mostly wallet change, one
 * CoinJoin change coin on 1/146), replayed as a history. Paying 600,000 sats at
 * 5 sat/vB used to pick the 15,240,920-sat CoinJoin coin (the smallest coin
 * that covers), leaving 14.64M of change tied to the payment.
 */
import { describe, it, expect } from "vitest";
import { testerHistory, TESTER_KEPT as KEPT, TESTER_CJ_CHANGE as CJ_CHANGE } from "./fixtures/wallet-history";
import { adviseCoinSelection, buildCoinInputs } from "../coin-selection";
import { auditWallet } from "../wallet-audit";

function testerWallet() {
  const { h, addresses } = testerHistory();
  return h.infos(addresses);
}

describe("tester wallet replay", () => {
  const infos = testerWallet();
  const coins = buildCoinInputs(infos);

  it("has the tester's 11 UTXOs, the 15,240,920 coin as CoinJoin change (not mixed)", () => {
    expect(coins.map((c) => c.utxo.value).sort((a, b) => b - a)).toEqual([...KEPT.slice(0, 8), CJ_CHANGE, ...KEPT.slice(8)]);
    const cj = coins.find((c) => c.utxo.value === CJ_CHANGE)!;
    expect(cj.origin).toBe("coinjoin-change");
    // Every coin descends from the one faucet receipt through the wallet's own spends
    expect(new Set(coins.map((c) => c.cluster)).size).toBe(1);
    // The origins bar counts each coin once, in the same class
    const o = auditWallet(infos).utxoOrigins;
    expect(Object.values(o).reduce((s, x) => s + x.count, 0)).toBe(11);
    expect(o["coinjoin-change"].count).toBe(1);
    expect(o.change.count).toBe(10);
  });

  it("600,000 sats at 5 sat/vB: 591,429 + 134,361 first, the CoinJoin coin never first", () => {
    const a = adviseCoinSelection(coins, 600_000, 5);
    if (a.kind !== "plans") throw new Error(a.kind);
    const [first] = a.plans;
    // No changeless set exists: the closest pairs miss the window (591,429 + 99M, etc.)
    expect(a.plans.some((p) => p.change === 0)).toBe(false);
    expect(first!.selected.map((c) => c.utxo.value).sort((x, y) => y - x)).toEqual([591_429, 134_361]);
    // 2 P2WPKH inputs, 2 outputs: (136 + 10 + 62) * 5 = 1,040 sats fee
    expect([first!.fee, first!.change, first!.origins, first!.reason]).toEqual([1_040, 124_750, 1, "small-change"]);
    // CoinJoin change leaving 14.6M of change ranks below every alternative shown
    expect(a.plans.flatMap((p) => p.selected).some((c) => c.utxo.value === CJ_CHANGE)).toBe(false);
  });

  it("when the two small coins were unrelated, the single coin wins on links (ruling)", () => {
    const unrelated = coins.map((c) => (c.utxo.value === 134_361 ? { ...c, cluster: "elsewhere" } : c));
    const a = adviseCoinSelection(unrelated, 600_000, 5);
    if (a.kind !== "plans") throw new Error(a.kind);
    expect(a.plans[0]!.selected.map((c) => c.utxo.value)).toEqual([99_000_000]);
    expect(a.plans[0]!.reason).toBe("big-change");
    expect(a.plans.map((p) => p.reason)).toContain("links");
  });
});
