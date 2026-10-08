import { describe, it, expect } from "vitest";
import {
  adviseCoinSelection, comparePrivacy, buildCoinInputs, evaluateSelection, outpointOf, rankPlans, MAX_PLANS, PLAN_CRITERIA,
  type CoinSelectionInput, type CoinSelectionAdvice, type CoinSelectionPlan,
} from "../coin-selection";
import type { WalletAddressInfo } from "../wallet-audit";

let seq = 0;
function coin(value: number, opts: Partial<Omit<CoinSelectionInput, "utxo">> & { txid?: string } = {}): CoinSelectionInput {
  const { txid, ...rest } = opts;
  seq++;
  return {
    utxo: { txid: txid ?? `tx${seq}`, vout: 0, value, status: { confirmed: true } },
    address: `bc1qaddr${seq}`,
    ...rest,
  };
}

function plans(advice: CoinSelectionAdvice) {
  if (advice.kind !== "plans") throw new Error(`expected plans, got ${advice.kind}`);
  return advice;
}
/** Without no-change variants: these tests pin the searches and the cost model, not the absorb option. */
const NO_ABSORB = 0;
const values = (p: { selected: CoinSelectionInput[] }) => p.selected.map(s => s.utxo.value).sort((a, b) => b - a);

describe("adviseCoinSelection", () => {
  it("single coin: prefers spendable change over the smallest coin leaving toxic change", () => {
    const a = plans(adviseCoinSelection([coin(100_000), coin(50_000), coin(25_000)], 20_000, 5, NO_ABSORB));
    // The 25k coin stays an option (least change), ranked second
    expect(a.plans.map(x => values(x))).toEqual([[50_000], [25_000]]);
    const [p] = a.plans;
    expect(p!.strategy).toBe("single-coin");
    // 25k would leave 4,300 sats of toxic change; 50k leaves 29,300
    expect(values(p!)).toEqual([50_000]);
    // 1-in 2-out P2WPKH at 5 sat/vB: (68 + 10 + 62) * 5 = 700
    expect(p!.fee).toBe(700);
    expect(p!.change).toBe(29_300);
    expect(p!.warnings).toEqual([]);
    expect(a.stonewall).toBeNull();
  });

  it("single coin: still the smallest coin when every option leaves toxic change", () => {
    const p = plans(adviseCoinSelection([coin(28_000), coin(25_000)], 20_000, 5, NO_ABSORB)).plans[0]!;
    expect(values(p)).toEqual([25_000]);
    expect(p.warnings.map(w => w.id)).toEqual(["toxic-change"]);
  });

  it("single coin: a small leftover goes to the fee (changeless)", () => {
    const p = plans(adviseCoinSelection([coin(20_900)], 20_000, 5)).plans[0]!;
    expect(p.change).toBe(0);
    expect(p.fee).toBe(900);
  });

  it("no single coin pays but the wallet does: fewest coins, never insufficient", () => {
    const a = plans(adviseCoinSelection([coin(35_000), coin(30_000), coin(20_000), coin(5_000)], 60_000, 5, NO_ABSORB));
    const p = rankPlans(a.plans, "fewest-coins")[0]!;
    expect(p.strategy).toBe("multi-coin");
    expect(p.selected).toHaveLength(2);
    expect(p.warnings.map(w => w.id)).toContain("merges-origins");
  });

  it("fewest coins prefers a changeless set of the same size", () => {
    // 40k+30k leaves change; 40k+21k lands within the changeless tolerance.
    const a = plans(adviseCoinSelection([coin(40_000), coin(30_000), coin(21_000)], 60_000, 1));
    const p = a.plans[0]!;
    expect(values(p)).toEqual([40_000, 21_000]);
    expect(p.change).toBe(0);
  });

  it("fewest coins breaks ties by fewer distinct origins", () => {
    // Same value pairs; 30k+30k from one tx are one origin.
    const a = plans(adviseCoinSelection([
      coin(30_000, { txid: "solo" }),
      coin(30_000, { txid: "shared", cluster: "shared" }),
      coin(30_000, { txid: "shared", cluster: "shared" }),
    ], 50_000, 1));
    // The solo + shared pair is no better on any count: pruned
    expect(a.plans.map(p => p.strategy)).toEqual(["same-origin"]);
    const p = a.plans[0]!;
    expect(p.selected.every(s => s.utxo.txid === "shared")).toBe(true);
    expect(p.origins).toBe(1);
    expect(p.warnings.map(w => w.id)).not.toContain("merges-origins");
    expect(p.selected[0]!.hints).toContainEqual({ kind: "same-tx", with: 2 });
  });

  it("multi-coin: prefers non-toxic change over the least change", () => {
    // 40k+22.5k leaves 2,292 sats (toxic); 40k+35k leaves 14,792
    const p = plans(adviseCoinSelection([coin(40_000), coin(35_000), coin(22_500)], 60_000, 1, NO_ABSORB)).plans[0]!;
    expect(values(p)).toEqual([40_000, 35_000]);
    expect(p.warnings.map(w => w.id)).not.toContain("toxic-change");
  });

  it("outputs of a batch payout received from someone else are not one origin", () => {
    const a = plans(adviseCoinSelection([
      coin(30_000, { txid: "batch" }),
      coin(30_000, { txid: "batch" }),
    ], 50_000, 1));
    expect(a.plans).toHaveLength(1);
    expect(a.plans[0]!.origins).toBe(2);
    expect(a.plans[0]!.selected[0]!.hints).toContainEqual({ kind: "same-tx", with: 2 });
  });

  it("outputs of a tx the wallet created itself are one origin", () => {
    const p = plans(adviseCoinSelection([
      coin(30_000, { txid: "self", cluster: "self" }),
      coin(30_000, { txid: "self", cluster: "self" }),
    ], 50_000, 1)).plans[0]!;
    expect(p.origins).toBe(1);
  });

  it("leaves out coins worth less than their own input fee", () => {
    // At 50 sat/vB a P2WPKH input costs 3,400 sats: the 1,000-sat coins only add fee
    const a = plans(adviseCoinSelection([coin(100_000), ...Array.from({ length: 20 }, () => coin(1_000))], 50_000, 50));
    expect(a.uneconomical).toBe(20);
    expect(values(a.plans[0]!)).toEqual([100_000]);
  });

  it("rejects a non-positive or non-finite amount or fee rate", () => {
    for (const [amount, rate] of [[0, 5], [-1, 5], [Number.NaN, 5], [1.5, 5], [1000, 0], [1000, Number.POSITIVE_INFINITY]] as const) {
      expect(adviseCoinSelection([coin(50_000)], amount, rate)).toEqual({ kind: "invalid" });
    }
  });

  it("offers a same-origin set first when the fewest set merges origins", () => {
    const addr = "bc1qsharedaddr";
    const a = plans(adviseCoinSelection([
      coin(60_000),
      coin(50_000),
      coin(30_000, { address: addr }),
      coin(25_000, { address: addr }),
      coin(20_000, { address: addr }),
    ], 70_000, 1, NO_ABSORB));
    // Links nothing new (tier c): first; the multi-coin sets with fewer inputs follow
    expect(a.plans[0]!.strategy).toBe("same-origin");
    const same = a.plans[0]!;
    expect(same.selected.every(s => s.address === addr)).toBe(true);
    expect(same.selected).toHaveLength(3);
    expect(same.origins).toBe(1);
    expect(same.selected[1]!.hints).toContainEqual({ kind: "same-address", with: 1 });
  });

  it("outputs of one CoinJoin are not treated as the same origin", () => {
    const a = plans(adviseCoinSelection([
      coin(50_000, { txid: "cj", origin: "mixed" }),
      coin(50_000, { txid: "cj", origin: "mixed" }),
    ], 80_000, 1));
    const p = a.plans[0]!;
    expect(p.origins).toBe(2);
    expect(p.selected[0]!.hints[0]).toEqual({ kind: "coinjoin" });
  });

  it("warns when CoinJoin outputs are mixed with other coins", () => {
    const p = plans(adviseCoinSelection([coin(50_000, { origin: "mixed" }), coin(40_000)], 80_000, 1)).plans[0]!;
    expect(p.warnings[0]).toMatchObject({ id: "coinjoin-mix", severity: "high" });
  });

  it("warns when outputs of different CoinJoins are merged", () => {
    const p = plans(adviseCoinSelection([coin(50_000, { origin: "mixed" }), coin(50_000, { origin: "mixed" })], 80_000, 1)).plans[0]!;
    expect(p.warnings[0]).toMatchObject({ id: "coinjoin-merge" });
  });

  it("flags reused addresses and mixed script types", () => {
    const p = plans(adviseCoinSelection([
      coin(50_000, { reusedAddress: true }),
      coin(50_000, { address: "3Pxyz" }),
    ], 80_000, 1)).plans[0]!;
    expect(p.selected.find(s => s.reusedAddress)!.hints).toContainEqual({ kind: "reused-address" });
    expect(p.warnings.map(w => w.id)).toContain("mixed-scripts");
  });

  it("insufficient only when the whole wallet cannot pay, with the shortfall", () => {
    const a = adviseCoinSelection([coin(30_000), coin(20_000)], 60_000, 1);
    expect(a.kind).toBe("insufficient");
    if (a.kind !== "insufficient") return;
    // 2-in 1-out P2WPKH at 1 sat/vB: 68*2 + 41 = 177
    expect(a.spendable).toBe(50_000);
    expect(a.shortfall).toBe(10_177);
  });

  it("never selects dust and reports how many were left out", () => {
    const a = plans(adviseCoinSelection([coin(500), coin(30_000)], 20_000, 1));
    expect(a.dustExcluded).toBe(1);
    expect(values(a.plans[0]!)).toEqual([30_000]);
  });

  it("reports Stonewall feasibility in the multi-coin case", () => {
    expect(plans(adviseCoinSelection([coin(40_000), coin(40_000), coin(40_000), coin(40_000)], 60_000, 1)).stonewall).toBe(true);
    expect(plans(adviseCoinSelection([coin(40_000), coin(40_000)], 60_000, 1)).stonewall).toBe(false);
  });

  it("stays fast with thousands of coins in same-tx groups", () => {
    const many = Array.from({ length: 3_000 }, (_, i) => coin(10_000 + (i % 150) * 13, { txid: `grp${i % 20}`, cluster: `grp${i % 20}` }));
    const start = performance.now();
    const a = plans(adviseCoinSelection(many, 400_000, 2, NO_ABSORB));
    expect(performance.now() - start).toBeLessThan(1_500);
    // Tier c before d: the one-cluster set (no new link) first, though it leaves toxic change
    expect(a.plans[0]!.strategy).toBe("same-origin");
    expect(a.plans[0]!.facts.links).toBe(0);
  });

  it("stays fast on large wallets", () => {
    const many = Array.from({ length: 400 }, (_, i) => coin(1_000 + i * 37));
    const start = performance.now();
    const a = plans(adviseCoinSelection(many, 150_000, 2));
    expect(performance.now() - start).toBeLessThan(2_000);
    expect(a.plans.at(-1)!.inputTotal).toBeGreaterThanOrEqual(150_000);
  });
});

describe("adviseCoinSelection: no-change plan", () => {
  const strategies = (a: CoinSelectionAdvice) => plans(a).plans.map(p => p.strategy);

  it("tester case 1: 60k cannot pay 60k plus fee alone, so 35k + 26k pay it with no change", () => {
    const a = plans(adviseCoinSelection([coin(60_000), coin(35_000), coin(26_000)], 60_000, 1));
    expect(a.plans.map(p => p.strategy)).toEqual(["no-change"]);
    expect(values(a.plans[0]!)).toEqual([35_000, 26_000]);
    expect(a.plans[0]!.change).toBe(0);
  });

  it("tester case 2: one big coin pays with big change; the changeless pair of unrelated coins follows (tier c before d)", () => {
    const a = plans(adviseCoinSelection([coin(500_000), coin(41_000), coin(20_000)], 60_000, 1));
    expect(a.plans.map(p => p.strategy)).toEqual(["single-coin", "no-change"]);
    const [single, noChange] = a.plans;
    expect(values(noChange!)).toEqual([41_000, 20_000]);
    expect(noChange!.change).toBe(0);
    expect(noChange!.fee).toBe(1_000);
    expect(noChange!.absorbed).toBe(823); // 1,000 minus the 177-sat fee of a 1-output tx
    expect(single!.change).toBeGreaterThan(400_000);
  });

  it("finds an exact match within the window and ignores sums past it", () => {
    // Window at 1 sat/vB for 2 P2WPKH inputs: sum in [100,177, ~101,208]
    expect(values(plans(adviseCoinSelection([coin(1_000_000), coin(60_000), coin(40_177)], 100_000, 1, NO_ABSORB)).plans.find(p => p.strategy === "no-change")!)).toEqual([60_000, 40_177]);
    // 60k + 41.3k leaves 1,092 sats of change after the 2-output fee: not changeless
    expect(strategies(adviseCoinSelection([coin(1_000_000), coin(60_000), coin(41_300)], 100_000, 1, NO_ABSORB))).toEqual(["single-coin", "multi-coin"]);
    // Below the target: cannot pay
    expect(strategies(adviseCoinSelection([coin(1_000_000), coin(60_000), coin(40_100)], 100_000, 1, NO_ABSORB))).toEqual(["single-coin"]);
  });

  it("uses up to 3 inputs and never 4", () => {
    const three = plans(adviseCoinSelection([coin(1_000_000), coin(40_000), coin(35_000), coin(25_300)], 100_000, 1)).plans;
    expect(three.find(p => p.strategy === "no-change")!.selected).toHaveLength(3);
    expect(strategies(adviseCoinSelection([coin(1_000_000), coin(25_000), coin(25_000), coin(25_000), coin(25_300)], 100_000, 1))).toEqual(["single-coin"]);
  });

  it("prefers fewer inputs, then the least fee", () => {
    const p = plans(adviseCoinSelection([coin(1_000_000), coin(60_000), coin(40_900), coin(40_200), coin(30_000), coin(20_000), coin(10_300)], 100_000, 1))
      .plans.find(x => x.strategy === "no-change")!;
    expect(values(p)).toEqual([60_000, 40_200]);
  });

  it("prefers a same-origin set even with more inputs", () => {
    const addr = "bc1qsameorigin";
    const p = plans(adviseCoinSelection([
      coin(1_000_000), coin(60_000), coin(40_200),
      coin(50_000, { address: addr }), coin(30_000, { address: addr }), coin(20_300, { address: addr }),
    ], 100_000, 1));
    // Links nothing new and leaves no change: first; the single coin is only cheaper by under 1,000 sats
    expect(p.plans[0]!.strategy).toBe("no-change");
    expect(p.plans[0]!.selected.every(s => s.address === addr)).toBe(true);
    expect(p.plans[0]!.origins).toBe(1);
  });

  it("a same-address set with no change (no new link) ranks above one coin with change", () => {
    expect(strategies(adviseCoinSelection([coin(150_000), coin(60_000, { address: "bc1qx" }), coin(40_200, { address: "bc1qx" })], 100_000, 1))[0])
      .toBe("no-change");
  });

  it("tier c before d: one coin, even with toxic, big or huge change, ranks above a changeless merge of unrelated coins", () => {
    for (const big of [105_000, 210_000, 450_000, 1_000_000]) {
      expect(strategies(adviseCoinSelection([coin(big), coin(60_000), coin(40_200)], 100_000, 1, NO_ABSORB))).toEqual(["single-coin", "no-change"]);
    }
  });

  it("never merges CoinJoin outputs when one coin pays alone, even two of the same CoinJoin", () => {
    const a = plans(adviseCoinSelection([
      coin(500_000),
      coin(41_000, { txid: "cj", origin: "mixed" }),
      coin(20_000, { txid: "cj", origin: "mixed" }),
    ], 60_000, 1));
    // A high-severity plan is shown only when nothing else pays
    expect(a.plans.map(p => p.strategy)).toEqual(["single-coin"]);
    // Mixed with a plain coin
    expect(strategies(adviseCoinSelection([coin(450_000), coin(60_000, { origin: "mixed" }), coin(40_200)], 100_000, 1)))
      .toEqual(["single-coin"]);
    // Rule 9: with no single coin, merging only CoinJoin outputs is allowed (not a fallback), still with its high warning
    const only = plans(adviseCoinSelection([coin(41_000, { txid: "cj", origin: "mixed" }), coin(20_000, { txid: "cj", origin: "mixed" })], 60_000, 1)).plans;
    expect(only.map(p => [p.strategy, p.fallback, p.facts.softLinks])).toEqual([["no-change", false, true]]);
    expect(only[0]!.warnings[0]).toMatchObject({ id: "coinjoin-merge", severity: "high", count: 2 });
  });

  it("window edges at 1 sat/vB: upper edge included, 1 sat past excluded, 1 sat short of the lower edge excluded", () => {
    // 2 P2WPKH inputs paying 100k: pays from 100,177, changeless up to 101,208
    const pair = (x: number) => plans(adviseCoinSelection([coin(1_000_000), coin(60_000), coin(x)], 100_000, 1, NO_ABSORB)).plans.find(p => p.strategy === "no-change");
    expect(pair(41_208)).toMatchObject({ change: 0, fee: 1_208, absorbed: 1_031 });
    expect(pair(41_209)).toBeUndefined();
    expect(pair(40_177)).toMatchObject({ change: 0, fee: 177, absorbed: 0 });
    expect(pair(40_176)).toBeUndefined();
  });

  it("a changeless single coin comes first; a changeless pair only cheaper by under 1,000 sats is not listed", () => {
    expect(strategies(adviseCoinSelection([coin(100_500), coin(60_000), coin(40_200)], 100_000, 1))).toEqual(["single-coin"]);
  });

  it("stays fast with 3,000 coins and no changeless set", () => {
    // Even values: every pair and triple misses an odd window
    const many = Array.from({ length: 3_000 }, (_, i) => coin(2_000 + i * 2));
    const start = performance.now();
    const a = plans(adviseCoinSelection([coin(10_000_000), ...many], 9_990_000, 3));
    expect(performance.now() - start).toBeLessThan(1_500);
    expect(a.plans[0]!.strategy).toBe("single-coin");
  });

  it("stays fast with 3,000 coins and finds a changeless triple", () => {
    const many = Array.from({ length: 3_000 }, (_, i) => coin(5_000 + i * 7));
    const start = performance.now();
    const a = plans(adviseCoinSelection([coin(5_000_000), ...many], 40_000, 2));
    expect(performance.now() - start).toBeLessThan(1_500);
    expect(a.plans.some(p => p.strategy === "no-change" && p.change === 0)).toBe(true);
  });
});

describe("buildCoinInputs", () => {
  it("marks CoinJoin funding txs and reused addresses", () => {
    const cjTx = {
      txid: "cjtx",
      vin: Array.from({ length: 5 }, (_, i) => ({ txid: `in${i}`, vout: 0, prevout: { value: 100_100, scriptpubkey_address: `bc1qin${i}`, scriptpubkey_type: "v0_p2wpkh" } })),
      vout: Array.from({ length: 5 }, (_, i) => ({ value: 100_000, scriptpubkey_address: `bc1qout${i}`, scriptpubkey_type: "v0_p2wpkh" })),
      status: { confirmed: true },
    };
    const infos = [{
      derived: { address: "bc1qout0" },
      addressData: { chain_stats: { funded_txo_count: 2 }, mempool_stats: { funded_txo_count: 0 } },
      txs: [cjTx],
      utxos: [{ txid: "cjtx", vout: 0, value: 100_000, status: { confirmed: true } }],
    }] as unknown as WalletAddressInfo[];
    const [c] = buildCoinInputs(infos);
    expect(c).toMatchObject({ address: "bc1qout0", origin: "mixed", reusedAddress: true });
  });

  it("links outputs of a tx the wallet funded to its inputs (one cluster) and classes them as change", () => {
    const selfTx = {
      txid: "selftx",
      vin: [{ txid: "prev", vout: 0, prevout: { value: 90_000, scriptpubkey_address: "bc1qmine", scriptpubkey_type: "v0_p2wpkh" } }],
      vout: [{ value: 50_000, scriptpubkey_address: "bc1qmerchant" }, { value: 39_000, scriptpubkey_address: "bc1qchange" }],
      status: { confirmed: true },
    };
    const infos = [
      { derived: { address: "bc1qmine" }, addressData: null, txs: [selfTx], utxos: [] },
      { derived: { address: "bc1qchange" }, addressData: null, txs: [selfTx], utxos: [{ txid: "selftx", vout: 1, value: 39_000, status: { confirmed: true } }] },
      { derived: { address: "bc1qmine2" }, addressData: null, txs: [], utxos: [{ txid: "other", vout: 0, value: 5_000, status: { confirmed: true } }] },
    ] as unknown as WalletAddressInfo[];
    const [change, other] = buildCoinInputs(infos);
    expect(change).toMatchObject({ origin: "change", reusedAddress: false });
    expect(other!.origin).toBe("unknown");
    expect(change!.cluster).not.toBe(other!.cluster);
  });
});

describe("adviseCoinSelection: Privacy first tiers", () => {
  it("mixed outputs: spent whole when they match, never for a small payment with large change unless nothing else pays", () => {
    // A mixed coin that matches the payment is the best plan
    const exact = plans(adviseCoinSelection([coin(500_000), coin(100_200, { origin: "mixed" })], 100_000, 1)).plans;
    expect(exact.map(p => [p.strategy, p.fallback, p.facts.change])).toEqual([["single-coin", false, "none"]]);
    expect(exact[0]!.selected[0]!.origin).toBe("mixed");
    // Small payment: the mixed coin would leave change larger than the payment
    const small = plans(adviseCoinSelection([coin(1_000_000, { origin: "mixed" }), coin(300_000), coin(30_000)], 50_000, 1)).plans;
    expect(small.every(p => p.selected.every(c => c.origin !== "mixed"))).toBe(true);
    // Nothing else pays: shown, with a warning
    const only = plans(adviseCoinSelection([coin(1_000_000, { origin: "mixed" }), coin(30_000)], 50_000, 1)).plans;
    expect(only.map(p => p.fallback)).toEqual([true]);
    expect(only[0]!.warnings[0]).toMatchObject({ id: "mixed-change", severity: "high" });
  });

  it("CoinJoin change is not mixed: flagged, its change is toxic, and it loses to a clean coin", () => {
    const a = plans(adviseCoinSelection([coin(400_000, { origin: "coinjoin-change" }), coin(450_000)], 100_000, 1));
    expect(values(a.plans[0]!)).toEqual([450_000]);
    const cj = plans(adviseCoinSelection([coin(400_000, { origin: "coinjoin-change" })], 100_000, 1)).plans[0]!;
    expect(cj.facts.change).toBe("toxic");
    expect(cj.warnings.map(w => w.id)).toContain("coinjoin-change");
    expect(cj.selected[0]!.hints).toEqual([{ kind: "coinjoin-change" }]);
  });

  it("evaluates multi-coin sets even when one coin covers, and merging within a cluster is free", () => {
    const a = plans(adviseCoinSelection([
      coin(5_000_000, { cluster: "k" }),
      coin(75_000, { cluster: "k" }),
      coin(40_000, { cluster: "k" }),
    ], 100_000, 1));
    expect(a.plans[0]!.strategy).toBe("same-origin");
    expect(values(a.plans[0]!)).toEqual([75_000, 40_000]);
    expect(a.plans[0]!.origins).toBe(1);
    expect(a.plans[0]!.selected[1]!.hints).toContainEqual({ kind: "linked", with: 1 });
    // The 5M coin needs fewer inputs (tier g), so it stays an option
    expect(a.plans.map(p => p.strategy)).toContain("single-coin");
  });

  it("returns a few plans, one per strategy, each with its facts and decision path", () => {
    const a = plans(adviseCoinSelection([
      coin(5_000_000), coin(70_000, { cluster: "k" }), coin(40_000, { cluster: "k" }), coin(60_000), coin(40_250),
    ], 100_000, 1));
    expect(a.plans.length).toBeLessThanOrEqual(3);
    expect(new Set(a.plans.map(p => p.strategy)).size).toBe(a.plans.length);
    for (const p of a.plans) expect(p.path[0]!.tier).toBe("a");
  });

  it("an inferred link (descendants of one payment's outputs) is a probable link, not a new one", () => {
    const a = plans(adviseCoinSelection([
      coin(5_000_000), coin(75_000, { cluster: "a", group: "k" }), coin(40_000, { cluster: "b", group: "k" }),
    ], 100_000, 1));
    const p = a.plans.find(x => x.strategy === "probably-linked")!;
    expect([p.origins, p.groups, p.facts.links, p.facts.probable]).toEqual([2, 1, 0, 1]);
    expect(p.selected[1]!.hints).toContainEqual({ kind: "probably-linked", with: 1 });
    expect(p.warnings.map(w => w.id)).not.toContain("merges-origins");
    expect(p.path).toContainEqual({ tier: "f", id: "probable", ok: null, n: 1 });
  });

  it("change classes: big over the payment, huge from 10x, toxic under 10,000 sats or from a CoinJoin coin", () => {
    const cls = (big: number) => plans(adviseCoinSelection([coin(big)], 100_000, 1)).plans[0]!.facts.change;
    expect(cls(150_000)).toBe("small");
    expect(cls(500_000)).toBe("big");
    expect(cls(1_090_000)).toBe("big");
    expect(cls(1_110_000)).toBe("huge");
    expect(cls(106_000)).toBe("toxic");
  });

  it("never prefers merging 3 unrelated receipts over one big coin", () => {
    const a = plans(adviseCoinSelection([coin(100_000_000), coin(40_000), coin(40_000), coin(40_000)], 100_000, 1));
    expect(values(a.plans[0]!)).toEqual([100_000_000]);
    const five = plans(adviseCoinSelection([coin(1_000_000_000), ...Array.from({ length: 5 }, () => coin(30_000))], 140_000, 1));
    expect(values(five.plans[0]!)).toEqual([1_000_000_000]);
  });

  it("stays fast with about 1,000 coins across clusters and origins", () => {
    const origins = ["change", "received", "self", "mixed", "coinjoin-change", "unknown"] as const;
    const many = Array.from({ length: 1_000 }, (_, i) =>
      coin(20_000 + ((i * 7_919) % 5_000_000), { cluster: `k${i % 37}`, origin: origins[i % origins.length] }));
    for (const amount of [50_000, 600_000, 3_000_000, 40_000_000, 600_000_000]) {
      const start = performance.now();
      const a = adviseCoinSelection(many, amount, 5);
      expect(performance.now() - start).toBeLessThan(1_000);
      expect(a.kind).not.toBe("invalid");
    }
  });
});

describe("adviseCoinSelection: options", () => {
  // Two payment-sized coins, a cluster of small ones, plain small ones, a CoinJoin change coin
  const wallet = () => [
    coin(900_000), coin(260_000), coin(130_000, { origin: "coinjoin-change" }),
    coin(70_000, { cluster: "k", txid: "k1" }), coin(45_000, { cluster: "k", txid: "k2" }), coin(30_000, { cluster: "k", txid: "k3" }),
    coin(61_000), coin(40_500), coin(25_000), coin(12_000),
  ];
  const ORDER = { none: 0, small: 1, big: 2, huge: 3, toxic: 4 } as const;
  /** The facts Pareto compares, with the raw fee (a plan dominated with the raw fee is dominated with the tolerance too) */
  const dims = (p: CoinSelectionPlan) => {
    const f = p.facts;
    return [f.violations.length, Number(!f.known), f.links, Number(!f.softLinks), ORDER[f.change], f.detectable.length, f.probable, f.inputs, p.fee, p.change];
  };

  it("returns more than one plan per strategy, distinct, none dominated by another", () => {
    const a = plans(adviseCoinSelection(wallet(), 100_000, 2));
    expect(a.plans.length).toBeGreaterThan(3);
    expect(a.plans.length).toBeLessThanOrEqual(MAX_PLANS);
    const ids = a.plans.map(p => p.selected.map(outpointOf).sort().join() + (p.absorbsChange ? "+absorb" : ""));
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of a.plans) {
      for (const o of a.plans) {
        if (o === p) continue;
        const [dp, d] = [dims(p), dims(o)];
        const dominates = d.every((v, k) => v <= dp[k]!) && d.some((v, k) => v < dp[k]!);
        expect(dominates).toBe(false);
      }
    }
    // Privacy first: the advisor's own order
    expect(rankPlans(a.plans, "privacy")).toEqual(a.plans);
  });

  it("prunes a plan another beats on cost, fee, change and links", () => {
    // 50k + 50k (one tx, own cluster) leaves the same change as 50k + 50k of two origins, with fewer links: the latter goes
    const a = plans(adviseCoinSelection([
      coin(50_000, { txid: "own", cluster: "own" }), { ...coin(50_000, { txid: "own", cluster: "own" }), utxo: { txid: "own", vout: 1, value: 50_000, status: { confirmed: true } } },
      coin(50_000), coin(50_000),
    ], 60_000, 1));
    expect(a.plans.map(p => [p.strategy, p.origins])).toEqual([["same-origin", 1]]);
  });

  it("keeps each criterion's best plan and orders by each criterion", () => {
    // 61,000 + 40,500 pays 100,800 at 2 sat/vB with no change
    const a = plans(adviseCoinSelection(wallet(), 100_800, 2));
    for (const c of PLAN_CRITERIA) {
      const ranked = rankPlans(a.plans, c);
      expect(ranked).toHaveLength(a.plans.length);
      if (c === "privacy") {
        for (let i = 1; i < ranked.length; i++) expect(comparePrivacy(ranked[i - 1]!, ranked[i]!)).toBeLessThanOrEqual(0);
        continue;
      }
      const key = (p: CoinSelectionPlan) =>
        c === "least-change" ? p.change : c === "no-change" ? Number(p.change > 0) : c === "fewest-coins" ? p.selected.length : p.fee;
      expect(ranked.map(key)).toEqual(ranked.map(key).sort((x, y) => x - y));
    }
    // A changeless plan exists, so No change if possible and Least change start with one
    expect(rankPlans(a.plans, "no-change")[0]!.change).toBe(0);
    expect(rankPlans(a.plans, "least-change")[0]!.change).toBe(0);
    expect(rankPlans(a.plans, "fewest-coins")[0]!.selected).toHaveLength(Math.min(...a.plans.map(p => p.selected.length)));
  });

  it("evaluates a manual selection exactly as the advisor builds the same set", () => {
    const w = wallet();
    for (const [amount, rate] of [[100_000, 2], [60_000, 1], [150_000, 5]] as const) {
      for (const p of plans(adviseCoinSelection(w, amount, rate)).plans) {
        const e = evaluateSelection(w, new Set(p.selected.map(outpointOf)), amount, rate, { absorb: p.absorbsChange });
        expect(e).toEqual({ kind: "plan", plan: p });
      }
    }
  });

  it("evaluates any manual set, warns on CoinJoin merges, and reports a shortfall", () => {
    const w = [coin(50_000, { origin: "mixed" }), coin(40_000, { origin: "mixed" }), coin(30_000)];
    const merge = evaluateSelection(w, new Set(w.map(outpointOf)), 100_000, 1);
    if (merge.kind !== "plan") throw new Error(merge.kind);
    expect(merge.plan.warnings[0]).toMatchObject({ id: "coinjoin-mix", severity: "high" });
    expect(merge.plan.fallback).toBe(false);
    expect(merge.plan.facts.violations).toContain("coinjoin");
    expect(evaluateSelection(w, new Set([outpointOf(w[2]!)]), 100_000, 1)).toEqual({ kind: "insufficient", total: 30_000, shortfall: 70_109 });
    expect(evaluateSelection(w, new Set(), 100_000, 1)).toEqual({ kind: "invalid" });
    expect(evaluateSelection(w, new Set([outpointOf(w[0]!)]), 0, 1)).toEqual({ kind: "invalid" });
  });

  it("stays well under a second with 1,000 coins", () => {
    const many = Array.from({ length: 1_000 }, (_, i) =>
      coin(3_000 + ((i * 7919) % 400_000), i % 3 === 0 ? { cluster: `c${i % 40}`, txid: `c${i}` } : {}));
    const start = performance.now();
    const a = plans(adviseCoinSelection(many, 250_000, 3));
    const ms = performance.now() - start;
    expect(ms).toBeLessThan(800);
    expect(a.plans.length).toBeGreaterThan(0);
    const e = evaluateSelection(many, new Set(many.slice(0, 50).map(outpointOf)), 250_000, 3);
    expect(e.kind).toBe("plan");
  });
});

describe("adviseCoinSelection: small change paid to miners (no-change variant)", () => {
  /**
   * Synthetic replica of a tester's signet wallet (fake txids and addresses):
   * one big change coin, two siblings of one payment, two small receipts.
   */
  const replica = () => [
    coin(165_519_188, { origin: "change" }),
    coin(3_296_321, { txid: "pay", origin: "change", cluster: "p1", group: "pay" }),
    { ...coin(2_399_400, { txid: "pay", origin: "change", cluster: "p2", group: "pay" }), utxo: { txid: "pay", vout: 1, value: 2_399_400, status: { confirmed: true } } },
    coin(64_332, { origin: "received" }),
    coin(38_625, { origin: "received" }),
  ];

  it("tester case at 100,000: the smallest change coin alone first (no merge, tier a and c; least change last); the receipts' no-change pair follows", () => {
    const w = replica();
    const a = plans(adviseCoinSelection(w, 100_000, 5));
    expect(values(a.plans[0]!)).toEqual([2_399_400]);
    expect(a.plans[0]!.facts).toMatchObject({ violations: [], links: 0, change: "huge" });
    const pair = a.plans.find(p => values(p).join() === "64332,38625")!;
    expect([pair.absorbsChange, pair.change, pair.fee, pair.absorbed]).toEqual([true, 0, 2_957, 2_072]);
    expect(pair.facts).toMatchObject({ violations: [], links: 1, change: "none" });
    expect(pair.warnings.map(w => w.id)).toEqual(["merges-origins"]);
    // The siblings of one payment merged: change merge and same-tx violations, never first
    const sib = a.plans.find(p => values(p).join() === "3296321,2399400");
    if (sib) expect(sib.facts.violations).toEqual(["change-merge", "same-tx"]);
    // The same pair with its 1,917 sats of toxic change is not listed next to its no-change twin
    expect(a.plans.some(p => values(p).join() === "64332,38625" && !p.absorbsChange)).toBe(false);
    const first = pair;
    // Manual: the same coins, absorb asked, give the same plan
    const e = evaluateSelection(w, new Set(first!.selected.map(outpointOf)), 100_000, 5, { absorb: true });
    expect(e).toEqual({ kind: "plan", plan: first });
  });

  it("manual selection: the small-change plan as picked, the variant when asked and within the max extra fee", () => {
    const w = replica();
    const pair = new Set([outpointOf(w[3]!), outpointOf(w[4]!)]);
    const plain = evaluateSelection(w, pair, 100_000, 5);
    if (plain.kind !== "plan") throw new Error(plain.kind);
    expect([plain.plan.change, plain.plan.fee]).toEqual([1_917, 1_040]);
    expect(plain.plan.warnings.map(x => x.id)).toContain("toxic-change");
    // Above the max extra fee: no variant, no pointer
    const strict = evaluateSelection(w, pair, 100_000, 5, { maxAbsorb: 1_000, absorb: true });
    if (strict.kind !== "plan") throw new Error(strict.kind);
    expect([strict.plan.absorbsChange, strict.plan.change]).toEqual([false, 1_917]);
  });

  it("notes an extra fee above 10% of the payment but keeps the variant; max 0 turns variants off", () => {
    const a = plans(adviseCoinSelection([coin(25_000)], 20_000, 5));
    const v = a.plans.find(p => p.absorbsChange)!;
    expect(v.warnings.find(w => w.id === "extra-fee")).toMatchObject({ severity: "low", count: 22 });
    expect(plans(adviseCoinSelection([coin(25_000)], 20_000, 5, 0)).plans.some(p => p.absorbsChange)).toBe(false);
  });
});

describe("adviseCoinSelection: max extra fee counts the saved change output", () => {
  it("at 50 sat/vB, 3,000 sats of change is absorbable (4,550 extra), 4,000 is not (5,550 > 5,000)", () => {
    const v = plans(adviseCoinSelection([coin(110_000)], 100_000, 50)).plans;
    expect(v.find(p => p.absorbsChange)).toMatchObject({ absorbed: 4_550, fee: 10_000, change: 0 });
    // Its 3,000 sats of toxic change are not listed next to the twin
    expect(v.some(p => !p.absorbsChange)).toBe(false);
    const none = plans(adviseCoinSelection([coin(111_000)], 100_000, 50)).plans;
    expect(none.some(p => p.absorbsChange)).toBe(false);
    expect(none[0]!.change).toBe(4_000);
  });
});

describe("evaluateSelection: the advisor's coin set", () => {
  it("leaves frozen coins out of the origins, as the advisor does, unless included", () => {
    // A and B are linked only through the frozen coin F (A shares its address, B its cluster)
    const A = coin(60_000, { address: "bc1qshared" });
    const F = coin(10_000, { address: "bc1qshared", cluster: "c1", frozen: true });
    const B = coin(50_000, { cluster: "c1" });
    const pair = new Set([outpointOf(A), outpointOf(B)]);
    const advised = plans(adviseCoinSelection([A, B], 100_000, 1)).plans.find(p => p.selected.length === 2 && !p.absorbsChange)!;
    expect(advised.groups).toBe(2);
    expect(evaluateSelection([A, F, B], pair, 100_000, 1)).toEqual({ kind: "plan", plan: advised });
    const withFrozen = evaluateSelection([A, F, B], pair, 100_000, 1, { includeFrozen: true });
    if (withFrozen.kind !== "plan") throw new Error(withFrozen.kind);
    expect(withFrozen.plan.groups).toBe(1);
  });
});
