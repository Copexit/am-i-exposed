/**
 * The guide and the coin selector say the same thing: one test per rule of
 * the guide's "Labeling recommendations" and "Spending checklist", named
 * after the rule, asserting that Privacy first (or the alerts) obeys it.
 */
import { describe, it, expect } from "vitest";
import { adviseCoinSelection, evaluateSelection, outpointOf, type CoinSelectionInput, type CoinSelectionPlan } from "../coin-selection";
import { roundChange, spendingAlerts } from "../spending-advice";
import { isRoundAmount } from "../heuristics/round-amount";
import { matchLabels, withLabels } from "@/lib/wallet/labels";
import { buildCoinInputs } from "../coin-selection";
import { History, ext, recv } from "./fixtures/wallet-history";

let seq = 0;
function coin(value: number, opts: Partial<Omit<CoinSelectionInput, "utxo">> & { txid?: string } = {}): CoinSelectionInput {
  const { txid, ...rest } = opts;
  seq++;
  return { utxo: { txid: txid ?? `guide${seq}`, vout: 0, value, status: { confirmed: true } }, address: `bc1qguide${seq}`, ...rest };
}
const plans = (coins: CoinSelectionInput[], amount: number, feeRate = 1, maxAbsorb = 0, known?: ReadonlySet<string>) => {
  const a = adviseCoinSelection(coins, amount, feeRate, maxAbsorb, known ? { known } : {});
  if (a.kind !== "plans") throw new Error(a.kind);
  return a.plans;
};
const values = (p: CoinSelectionPlan) => p.selected.map(s => s.utxo.value).sort((a, b) => b - a);
const top = (ps: CoinSelectionPlan[]) => values(ps[0]!);

describe("guide: labeling recommendations", () => {
  it("rule 1, never merge KYC with no-KYC: such a merge ranks below one coin with big change", () => {
    const ps = plans([coin(400_000), coin(60_000, { labelTags: ["kyc"] }), coin(40_200, { labelTags: ["nokyc"] })], 100_000);
    expect(top(ps)).toEqual([400_000]);
    expect(ps.find(p => p.selected.length === 2)!.facts.violations).toEqual(["kyc"]);
  });

  it("rule 2, spend CoinJoin coins one by one: a [CJ] coin merged with another coin is a violation", () => {
    const ps = plans([coin(250_000), coin(60_000, { labelTags: ["cj"] }), coin(40_200)], 100_000);
    expect(top(ps)).toEqual([250_000]);
    const merge = ps.find(p => p.selected.length === 2);
    if (merge) expect(merge.facts.violations).toContain("coinjoin");
  });

  it("rule 3, prefer one origin: two labeled origins warn; already linked on-chain, no new link", () => {
    const a = coin(60_000, { labelTags: ["kyc"], labelOrigins: ["kyc:bitstamp"], cluster: "c1" });
    const b = coin(40_200, { labelTags: ["kyc"], labelOrigins: ["kyc:kraken"], cluster: "c2" });
    const apart = plans([a, b], 100_000)[0]!;
    expect(apart.warnings.map(w => w.id)).toContain("label-origins");
    expect(apart.facts.links).toBe(1);
    const linked = plans([a, { ...b, cluster: "c1" }], 100_000)[0]!;
    expect(linked.facts.links).toBe(0);
  });

  it("rule 4, change inherits its parent's origin: merging [KYC] change with a [noKYC] coin breaks rule 1 too", () => {
    const h = new History();
    const r = h.receive(recv(0), 300_000, 100);
    h.tx([r], [{ address: ext(1), value: 100_000 }, { address: recv(1), value: 199_000 }], 101);
    const n = h.receive(recv(2), 50_000, 102);
    const infos = h.infos([0, 1, 2].map(i => ({ address: recv(i), isChange: false, index: i })));
    const labels = matchLabels([
      { type: "tx", ref: r.txid, label: "[KYC] Bitstamp" },
      { type: "tx", ref: n.txid, label: "[noKYC] Juan" },
    ], infos);
    const coins = withLabels(buildCoinInputs(infos), labels);
    const change = coins.find(c => c.utxo.value === 199_000)!;
    expect(change.labelTags).toContain("kyc");
    const e = evaluateSelection(coins, new Set(coins.map(outpointOf)), 220_000, 1);
    if (e.kind !== "plan") throw new Error(e.kind);
    expect(e.plan.facts.violations).toEqual(["kyc", "change-merge"]);
  });

  it("rule 5, never merge toxic coins: a [toxic] coin merged is a violation", () => {
    const ps = plans([coin(300_000), coin(60_000, { labelTags: ["toxic"] }), coin(40_200)], 100_000);
    expect(top(ps)).toEqual([300_000]);
    const merge = ps.find(p => p.selected.length === 2);
    if (merge) expect(merge.facts.violations).toContain("toxic");
  });

  it("rule 6, spend change on its own: change alone first; a merge with change only when nothing else pays, with its warning", () => {
    const ps = plans([coin(250_000, { origin: "change" }), coin(60_000, { origin: "received" }), coin(40_200, { origin: "change" })], 100_000);
    expect(top(ps)).toEqual([250_000]);
    const merge = ps.find(p => p.selected.length === 2)!;
    expect(merge.facts.violations).toEqual(["change-merge"]);
    expect(merge.warnings[0]).toMatchObject({ id: "change-merge", severity: "high" });
    // Nothing else pays: shown, with the warning
    const only = plans([coin(60_000, { origin: "change" }), coin(50_000, { origin: "received" })], 100_000);
    expect(only[0]!.facts.violations).toEqual(["change-merge"]);
  });
});

describe("guide: spending checklist", () => {
  it("rule 1, the recipient already knows a coin: spend it first, even with huge change", () => {
    const k = coin(2_000_000);
    expect(top(plans([k, coin(115_000)], 100_000, 1, 0, new Set([outpointOf(k)])))).toEqual([2_000_000]);
  });

  it("rule 2, one coin close to the amount, small change to miners: the closest coin first, its leftover absorbed", () => {
    const ps = plans([coin(103_000), coin(160_000), coin(300_000)], 100_000, 1, 5_000);
    expect(top(ps)).toEqual([103_000]);
    expect(ps[0]!.absorbsChange).toBe(true);
  });

  it("rule 3, handle change one coin at a time: at equal links no change goes first, and the advisor says what to do with change", () => {
    const ps = plans([coin(100_200), coin(150_000)], 100_000);
    expect(ps[0]!.change).toBe(0);
    expect(spendingAlerts({ amount: 100_000, recipient: null, walletType: null, history: null, apiReused: null, change: 50_000 }).map(a => a.id)).toEqual(["round", "change-tips"]);
  });

  it("rule 4, a merge links coins: one coin with big change first; between options linking the same coins, less change", () => {
    expect(top(plans([coin(450_000), coin(60_000), coin(40_200)], 100_000))).toEqual([450_000]);
    expect(top(plans([coin(160_000), coin(450_000)], 100_000))).toEqual([160_000]);
  });

  it("rule 5, merge coins of one observer, never two outputs of one transaction", () => {
    expect(top(plans([coin(70_000, { labelObserver: "Juan" }), coin(50_000, { labelObserver: "juan" }), coin(52_000, { labelObserver: "Ana" })], 100_000)))
      .toEqual([70_000, 50_000]);
    const sib = [coin(60_000, { txid: "self", origin: "self", cluster: "a", group: "s" }), { ...coin(50_000, { txid: "self", origin: "self", cluster: "b", group: "s" }), utxo: { txid: "self", vout: 1, value: 50_000, status: { confirmed: true } } }];
    const e = evaluateSelection(sib, new Set(sib.map(outpointOf)), 100_000, 1);
    if (e.kind !== "plan") throw new Error(e.kind);
    // One leak, counted once: the self-transfer revealed
    expect(e.plan.facts.violations).toEqual(["same-tx"]);
    expect([e.plan.facts.links, e.plan.facts.probable]).toEqual([0, 0]);
    expect(e.plan.warnings.map(w => w.id)).toContain("same-tx");
  });

  it("rule 6, never send to a used address: a strong alert", () => {
    expect(spendingAlerts({ amount: 1, recipient: null, walletType: null, history: null, apiReused: true, change: 0 })[0]).toMatchObject({ id: "reused-api", severity: "critical" });
  });

  it("rule 7, round amounts and another address type reveal the change: alerts, and a round change goes first", () => {
    const ids = spendingAlerts({ amount: 100_000, recipient: "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0", walletType: "p2wpkh", history: null, apiReused: null, change: 0 }).map(a => a.id);
    expect(ids).toEqual(["round", "type-mismatch"]);
    expect(top(plans([coin(135_000), coin(140_140)], 100_000))).toEqual([140_140]);
  });

  it("rule 8, raise the fee a little so the change is round too", () => {
    const p = plans([coin(133_000)], 100_000, 5)[0]!;
    const r = roundChange(p, 5_000)!;
    expect(isRoundAmount(r.change)).toBe(true);
    expect(r.extra).toBeLessThanOrEqual(5_000);
  });

  it("rule 9, CoinJoin outputs only is the least bad merge, never when one coin pays alone", () => {
    expect(top(plans([coin(60_000, { origin: "mixed" }), coin(40_500, { origin: "mixed" }), coin(55_000), coin(45_250)], 100_000))).toEqual([60_000, 40_500]);
    const withSingle = plans([coin(500_000), coin(60_000, { origin: "mixed" }), coin(40_500, { origin: "mixed" })], 100_000);
    expect(withSingle.some(p => p.selected.length > 1 && p.selected.every(c => c.origin === "mixed"))).toBe(false);
  });
});
