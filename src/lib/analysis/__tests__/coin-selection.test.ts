import { describe, it, expect } from "vitest";
import { adviseCoinSelection, buildCoinInputs, type CoinSelectionInput, type CoinSelectionAdvice } from "../coin-selection";
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
const values = (p: { selected: CoinSelectionInput[] }) => p.selected.map(s => s.utxo.value).sort((a, b) => b - a);

describe("adviseCoinSelection", () => {
  it("single coin: prefers spendable change over the smallest coin leaving toxic change", () => {
    const a = plans(adviseCoinSelection([coin(100_000), coin(50_000), coin(25_000)], 20_000, 5));
    expect(a.plans).toHaveLength(1);
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
    const p = plans(adviseCoinSelection([coin(28_000), coin(25_000)], 20_000, 5)).plans[0]!;
    expect(values(p)).toEqual([25_000]);
    expect(p.warnings.map(w => w.id)).toEqual(["toxic-change"]);
  });

  it("single coin: a small leftover goes to the fee (changeless)", () => {
    const p = plans(adviseCoinSelection([coin(20_900)], 20_000, 5)).plans[0]!;
    expect(p.change).toBe(0);
    expect(p.fee).toBe(900);
  });

  it("no single coin pays but the wallet does: fewest coins, never insufficient", () => {
    const a = plans(adviseCoinSelection([coin(35_000), coin(30_000), coin(20_000), coin(5_000)], 60_000, 5));
    const p = a.plans.at(-1)!;
    expect(p.strategy).toBe("multi-coin");
    expect(p.selected).toHaveLength(2);
    expect(values(p)).toEqual([35_000, 30_000]);
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
    expect(a.plans.map(p => p.strategy)).toEqual(["same-origin", "multi-coin"]);
    const p = a.plans[0]!;
    expect(p.selected.every(s => s.utxo.txid === "shared")).toBe(true);
    expect(p.origins).toBe(1);
    expect(p.warnings.map(w => w.id)).not.toContain("merges-origins");
    expect(p.selected[0]!.hints).toContainEqual({ kind: "same-tx", with: 2 });
  });

  it("multi-coin: prefers non-toxic change over the least change", () => {
    // 40k+22.5k leaves 2,292 sats (toxic); 40k+35k leaves 14,792
    const p = plans(adviseCoinSelection([coin(40_000), coin(35_000), coin(22_500)], 60_000, 1)).plans.at(-1)!;
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
    ], 70_000, 1));
    expect(a.plans.map(p => p.strategy)).toEqual(["same-origin", "multi-coin"]);
    const same = a.plans[0]!;
    expect(same.selected.every(s => s.address === addr)).toBe(true);
    expect(same.selected).toHaveLength(3);
    expect(same.origins).toBe(1);
    expect(same.selected[1]!.hints).toContainEqual({ kind: "same-address", with: 1 });
    expect(a.plans[1]!.selected).toHaveLength(2);
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
    const a = plans(adviseCoinSelection(many, 400_000, 2));
    expect(performance.now() - start).toBeLessThan(1_500);
    expect(a.plans[0]!.strategy).toBe("same-origin");
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
    expect(a.plans.map(p => p.strategy)).toEqual(["no-change", "multi-coin"]);
    expect(values(a.plans[0]!)).toEqual([35_000, 26_000]);
    expect(a.plans[0]!.change).toBe(0);
  });

  it("tester case 2: one big coin pays with big change, a changeless pair is shown and recommended", () => {
    const a = plans(adviseCoinSelection([coin(500_000), coin(41_000), coin(20_000)], 60_000, 1));
    expect(a.plans.map(p => p.strategy)).toEqual(["no-change", "single-coin"]);
    const [noChange, single] = a.plans;
    expect(values(noChange!)).toEqual([41_000, 20_000]);
    expect(noChange!.change).toBe(0);
    expect(noChange!.fee).toBe(1_000);
    expect(noChange!.absorbed).toBe(823); // 1,000 minus the 177-sat fee of a 1-output tx
    expect(single!.change).toBeGreaterThan(400_000);
  });

  it("finds an exact match within the window and ignores sums past it", () => {
    // Window at 1 sat/vB for 2 P2WPKH inputs: sum in [100,177, ~101,208]
    expect(values(plans(adviseCoinSelection([coin(1_000_000), coin(60_000), coin(40_177)], 100_000, 1)).plans[0]!)).toEqual([60_000, 40_177]);
    // 60k + 41.3k leaves 1,092 sats of change after the 2-output fee: not changeless
    expect(strategies(adviseCoinSelection([coin(1_000_000), coin(60_000), coin(41_300)], 100_000, 1))).toEqual(["single-coin", "multi-coin"]);
    // Below the target: cannot pay
    expect(strategies(adviseCoinSelection([coin(1_000_000), coin(60_000), coin(40_100)], 100_000, 1))).toEqual(["single-coin"]);
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
    // Links nothing new and leaves no change: shown alone
    expect(p.plans.map(x => x.strategy)).toEqual(["no-change"]);
    expect(p.plans[0]!.selected.every(s => s.address === addr)).toBe(true);
    expect(p.plans[0]!.origins).toBe(1);
  });

  it("recommends (a) a same-origin set, even with moderate change", () => {
    expect(strategies(adviseCoinSelection([coin(150_000), coin(60_000, { address: "bc1qx" }), coin(40_200, { address: "bc1qx" })], 100_000, 1)))
      .toEqual(["no-change"]);
  });

  it("recommends (b) when the single coin's change would be toxic", () => {
    expect(strategies(adviseCoinSelection([coin(105_000), coin(60_000), coin(40_200)], 100_000, 1))).toEqual(["no-change", "single-coin"]);
  });

  it("recommends (c) 2 plain origins only when the change is at least 3x the payment", () => {
    // 450k leaves 349,860 (>= 300k): no change first
    expect(strategies(adviseCoinSelection([coin(450_000), coin(60_000), coin(40_200)], 100_000, 1))).toEqual(["no-change", "single-coin"]);
    // 400k leaves 299,860 (< 300k): single coin first
    expect(strategies(adviseCoinSelection([coin(400_000), coin(60_000), coin(40_200)], 100_000, 1))).toEqual(["single-coin", "no-change"]);
  });

  it("keeps the single coin first when change and payment are near-equal", () => {
    // 210k leaves 109,860 against a 100k payment
    expect(strategies(adviseCoinSelection([coin(210_000), coin(60_000), coin(40_200)], 100_000, 1))).toEqual(["single-coin", "no-change"]);
  });

  it("keeps the single coin first when No change merges 3 unrelated origins, even with huge change", () => {
    const a = plans(adviseCoinSelection([coin(1_000_000), coin(40_000), coin(35_000), coin(25_300)], 100_000, 1));
    expect(a.plans.map(p => p.strategy)).toEqual(["single-coin", "no-change"]);
    expect(a.plans[1]!.origins).toBe(3);
  });

  it("never recommends merging CoinJoin outputs, even two of the same CoinJoin", () => {
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
    const only = plans(adviseCoinSelection([coin(41_000, { txid: "cj", origin: "mixed" }), coin(20_000, { txid: "cj", origin: "mixed" })], 60_000, 1)).plans;
    expect(only.map(p => [p.strategy, p.reason])).toEqual([["no-change", "fallback"]]);
    expect(only[0]!.warnings[0]).toMatchObject({ id: "coinjoin-merge", severity: "high", count: 2 });
  });

  it("window edges at 1 sat/vB: upper edge included, 1 sat past excluded, 1 sat short of the lower edge excluded", () => {
    // 2 P2WPKH inputs paying 100k: pays from 100,177, changeless up to 101,208
    const pair = (x: number) => plans(adviseCoinSelection([coin(1_000_000), coin(60_000), coin(x)], 100_000, 1)).plans.find(p => p.strategy === "no-change");
    expect(pair(41_208)).toMatchObject({ change: 0, fee: 1_208, absorbed: 1_031 });
    expect(pair(41_209)).toBeUndefined();
    expect(pair(40_177)).toMatchObject({ change: 0, fee: 177, absorbed: 0 });
    expect(pair(40_176)).toBeUndefined();
  });

  it("no extra plan when the single coin is already changeless", () => {
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

describe("adviseCoinSelection: privacy cost ranking", () => {
  it("mixed outputs: spent whole when they match, never for a small payment with large change unless nothing else pays", () => {
    // A mixed coin that matches the payment is the best plan
    const exact = plans(adviseCoinSelection([coin(500_000), coin(100_200, { origin: "mixed" })], 100_000, 1)).plans;
    expect(exact.map(p => [p.strategy, p.reason])).toEqual([["single-coin", "clean"]]);
    expect(exact[0]!.selected[0]!.origin).toBe("mixed");
    // Small payment: the mixed coin would leave change larger than the payment
    const small = plans(adviseCoinSelection([coin(1_000_000, { origin: "mixed" }), coin(300_000), coin(30_000)], 50_000, 1)).plans;
    expect(small.every(p => p.selected.every(c => c.origin !== "mixed"))).toBe(true);
    // Nothing else pays: shown, with a warning
    const only = plans(adviseCoinSelection([coin(1_000_000, { origin: "mixed" }), coin(30_000)], 50_000, 1)).plans;
    expect(only.map(p => p.reason)).toEqual(["fallback"]);
    expect(only[0]!.warnings[0]).toMatchObject({ id: "mixed-change", severity: "high" });
  });

  it("CoinJoin change is not mixed: flagged, its change costs, and it loses to a clean coin", () => {
    const a = plans(adviseCoinSelection([coin(400_000, { origin: "coinjoin-change" }), coin(450_000)], 100_000, 1));
    expect(values(a.plans[0]!)).toEqual([450_000]);
    const cj = plans(adviseCoinSelection([coin(400_000, { origin: "coinjoin-change" })], 100_000, 1)).plans[0]!;
    expect(cj.reason).toBe("bad-change");
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
    expect(a.plans.map(p => p.strategy)).toContain("single-coin");
  });

  it("returns at most 3 plans, one per strategy, each with a reason", () => {
    const a = plans(adviseCoinSelection([
      coin(5_000_000), coin(70_000, { cluster: "k" }), coin(40_000, { cluster: "k" }), coin(60_000), coin(40_250),
    ], 100_000, 1));
    expect(a.plans.length).toBeLessThanOrEqual(3);
    expect(new Set(a.plans.map(p => p.strategy)).size).toBe(a.plans.length);
    for (const p of a.plans) expect(["links", "bad-change", "big-change", "clean", "small-change"]).toContain(p.reason);
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
