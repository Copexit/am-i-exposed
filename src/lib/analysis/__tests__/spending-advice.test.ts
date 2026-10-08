import { describe, it, expect } from "vitest";
import { adviseCoinSelection, buildCoinInputs, evaluateSelection, outpointOf, type CoinSelectionAdvice, type CoinSelectionInput, type CoinSelectionPlan } from "../coin-selection";
import { recipientHistory, roundChange, roundChangeCap, spendingAlerts, validRecipient, walletAddressType } from "../spending-advice";
import { History, ext, recv } from "./fixtures/wallet-history";
import { isRoundAmount } from "../heuristics/round-amount";

let seq = 0;
function coin(value: number, opts: Partial<Omit<CoinSelectionInput, "utxo">> & { txid?: string } = {}): CoinSelectionInput {
  const { txid, ...rest } = opts;
  seq++;
  return { utxo: { txid: txid ?? `sp${seq}`, vout: 0, value, status: { confirmed: true } }, address: `bc1qspend${seq}`, ...rest };
}
const plans = (a: CoinSelectionAdvice) => { if (a.kind !== "plans") throw new Error(a.kind); return a.plans; };
const values = (p: CoinSelectionPlan) => p.selected.map(s => s.utxo.value).sort((a, b) => b - a);
const NO_ABSORB = 0;

/** The recipient (ext(77)) paid the wallet 133,000; another payer sent 104,000; the wallet once paid ext(78), keeping change. */
function recipientWallet() {
  const h = new History();
  const known = h.tx([{ address: ext(77), value: 140_000 }], [{ address: recv(0), value: 133_000 }], 100)[0]!;
  h.receive(recv(1), 104_000, 101);
  const r = h.receive(recv(2), 500_000, 102);
  h.tx([r], [{ address: ext(78), value: 200_000 }, { address: recv(3), value: 299_000 }], 103);
  const infos = h.infos([0, 1, 2, 3].map(i => ({ address: recv(i), isChange: false, index: i })));
  return { infos, coins: buildCoinInputs(infos), known };
}

describe("rule 1: coins the recipient already knows", () => {
  it("finds the coin the recipient sent, and the change of a payment to a past payee", () => {
    const { infos, coins, known } = recipientWallet();
    const h = recipientHistory(infos, coins, ext(77));
    expect(h).toMatchObject({ sent: 1, paid: 0 });
    expect([...h.known]).toEqual([[`${known.txid}:0`, "sent"]]);
    const payee = recipientHistory(infos, coins, ext(78));
    expect(payee.paid).toBe(1);
    expect([...payee.known.values()]).toEqual(["paid"]);
    expect(recipientHistory(infos, coins, ext(99)).known.size).toBe(0);
  });

  it("extends to coins already linked on-chain and coins whose label names the same observer", () => {
    const sent = coin(50_000, { txid: "s", cluster: "k" });
    const linked = coin(60_000, { cluster: "k" });
    const named = coin(70_000, { labelObserver: "Juan" });
    const other = coin(80_000, { labelObserver: "Ana" });
    const withLabel = { ...sent, labelObserver: "juan " };
    const h2 = new History();
    const c = h2.tx([{ address: ext(5), value: 51_000 }], [{ address: recv(0), value: 50_000 }], 100)[0]!;
    const infos2 = h2.infos([{ address: recv(0), isChange: false, index: 0 }]);
    const s2 = { ...withLabel, utxo: { ...withLabel.utxo, txid: c.txid } };
    const known = recipientHistory(infos2, [s2, linked, named, other], ext(5)).known;
    expect(Object.fromEntries(known)).toEqual({ [outpointOf(s2)]: "sent", [outpointOf(linked)]: "linked", [outpointOf(named)]: "observer" });
  });

  it("prefers the coin the recipient sent over a closer coin, with the reason and the decision path", () => {
    const { infos, coins, known } = recipientWallet();
    const without = plans(adviseCoinSelection(coins, 100_000, 5));
    expect(values(without[0]!)).toEqual([104_000]);
    const k = recipientHistory(infos, coins, ext(77)).known;
    const top = plans(adviseCoinSelection(coins, 100_000, 5, undefined, { known: new Set(k.keys()) }))[0]!;
    expect(values(top)).toEqual([133_000]);
    expect(top.selected[0]!.utxo.txid).toBe(known.txid);
    expect(top.reason).toBe("recipient-knows");
    expect(top.path[0]).toEqual({ rule: 1, id: "known-used", ok: true, n: 1 });
    // The other plans say the known coin is not used
    const other = plans(adviseCoinSelection(coins, 100_000, 5, undefined, { known: new Set(k.keys()) })).find(p => values(p)[0] === 104_000)!;
    expect(other.path[0]).toEqual({ rule: 1, id: "known-unused", ok: false, n: 1 });
  });

  it("a known coin with change 20x the payment beats an unknown coin with ordinary change (no big-change cost when known)", () => {
    const big = coin(2_000_000);
    const p = plans(adviseCoinSelection([big, coin(115_000)], 100_000, 1, NO_ABSORB, { known: new Set([outpointOf(big)]) }));
    expect(values(p[0]!)).toEqual([2_000_000]);
    expect(p[0]!.cost).toBe(4 - 12);
    expect(p[0]!.reason).toBe("recipient-knows");
  });

  it("does not count a mixed output of a CoinJoin the recipient took part in", () => {
    const h = new History();
    const outs = h.tx(
      [{ address: ext(77), value: 1_010_000 }, { address: ext(80), value: 1_010_000 }],
      [{ address: recv(0), value: 1_000_000 }, { address: ext(81), value: 1_000_000 }],
      100,
    );
    const infos = h.infos([{ address: recv(0), isChange: false, index: 0 }]);
    const coins = buildCoinInputs(infos).map(c => ({ ...c, origin: "mixed" as const }));
    const r = recipientHistory(infos, coins, ext(77));
    expect(r.sent).toBe(1);
    expect(r.known.size).toBe(0);
    expect(outs).toHaveLength(2);
  });

  it("knows no coin when the recipient is the wallet's own address", () => {
    const { infos, coins } = recipientWallet();
    expect(recipientHistory(infos, coins, recv(2)).known.size).toBe(0);
  });

  it("evaluates a manual selection with the same bonus", () => {
    const { infos, coins, known } = recipientWallet();
    const k = new Set(recipientHistory(infos, coins, ext(77)).known.keys());
    const op = new Set([`${known.txid}:0`]);
    const a = evaluateSelection(coins, op, 100_000, 5, { known: k });
    const b = evaluateSelection(coins, op, 100_000, 5);
    if (a.kind !== "plan" || b.kind !== "plan") throw new Error("plan");
    expect(a.plan.cost).toBe(b.plan.cost - 12);
    expect(a.plan.reason).toBe("recipient-knows");
  });
});

describe("rule 2: close single coin", () => {
  it("marks a single coin within 10% as close, and a merge says whether one existed", () => {
    const p = plans(adviseCoinSelection([coin(105_000), coin(400_000)], 100_000, 1, NO_ABSORB));
    const close = p.find(x => values(x)[0] === 105_000)!;
    expect(close.path[0]).toEqual({ rule: 2, id: "close-single", ok: true, amount: close.change });
    const far = p.find(x => values(x)[0] === 400_000);
    if (far) expect(far.path[0]).toMatchObject({ rule: 2, id: "far-single", ok: false });
    const merge = plans(adviseCoinSelection([coin(70_000), coin(50_000)], 100_000, 1, NO_ABSORB))[0]!;
    expect(merge.path[0]).toEqual({ rule: 2, id: "no-close-single", ok: true });
  });

  it("an absorbed leftover counts toward the 10%", () => {
    const p = plans(adviseCoinSelection([coin(103_000)], 100_000, 1))[0]!;
    expect(p.absorbsChange).toBe(true);
    expect(p.path).toEqual([
      { rule: 2, id: "close-single", ok: true, amount: p.absorbed },
      { rule: 3, id: "no-change", ok: true },
    ]);
  });
});

describe("rule 4: consolidation with small change vs one coin with big change (Privacy first)", () => {
  it("a 2-origin merge with change at most the payment beats one coin with change at least 10x", () => {
    const p = plans(adviseCoinSelection([coin(2_000_000), coin(70_000), coin(50_000)], 100_000, 1, NO_ABSORB));
    expect(values(p[0]!)).toEqual([70_000, 50_000]);
    expect(p[0]!.cost).toBe(12 + 4);
    expect(p[0]!.path).toContainEqual({ rule: 4, id: "merge-small-change", ok: true, amount: p[0]!.change });
    // Toxic small change does not pass the step
    const toxic = plans(adviseCoinSelection([coin(70_000), coin(35_000)], 100_000, 1, NO_ABSORB))[0]!;
    expect(toxic.path).toContainEqual({ rule: 4, id: "merge-small-change", ok: false, amount: toxic.change });
    const single = p.find(x => x.selected.length === 1)!;
    expect(single.cost).toBe(4 + 9 + 6);
    expect(single.path).toContainEqual({ rule: 4, id: "huge-change", ok: false, n: 19 });
  });

  it("not against one coin whose change is 3x-10x (big-change cap ruling unchanged)", () => {
    expect(values(plans(adviseCoinSelection([coin(900_000), coin(70_000), coin(50_000)], 100_000, 1, NO_ABSORB))[0]!)).toEqual([900_000]);
  });

  it("not when the merge links 3 unrelated origins", () => {
    expect(values(plans(adviseCoinSelection([coin(2_000_000), coin(40_000), coin(40_000), coin(40_000)], 100_000, 1, NO_ABSORB))[0]!)).toEqual([2_000_000]);
  });

  it("not when the merge breaks the KYC or CJ label rules", () => {
    const kyc = plans(adviseCoinSelection([coin(2_000_000), coin(70_000, { labelTags: ["kyc"] }), coin(50_000, { labelTags: ["nokyc"] })], 100_000, 1, NO_ABSORB));
    expect(values(kyc[0]!)).toEqual([2_000_000]);
    const cj = plans(adviseCoinSelection([coin(2_000_000), coin(70_000, { labelTags: ["cj"] }), coin(50_000)], 100_000, 1, NO_ABSORB));
    expect(values(cj[0]!)).toEqual([2_000_000]);
  });

  it("a changeless merge says so in its path; an absorbed one shows the extra fee", () => {
    const absorbed = plans(adviseCoinSelection([coin(70_000), coin(33_000)], 100_000, 1))[0]!;
    expect(absorbed.absorbsChange).toBe(true);
    expect(absorbed.path).toContainEqual({ rule: 4, id: "merge-absorbed", ok: true, amount: absorbed.absorbed });
  });
});

describe("rule 5: merge coins of one observer or platform", () => {
  it("a merge of coins one label observer knows costs half a link per new link", () => {
    const p = plans(adviseCoinSelection([
      coin(70_000, { labelObserver: "Juan" }), coin(50_000, { labelObserver: "juan" }), coin(55_000, { labelObserver: "Ana" }),
    ], 100_000, 1, NO_ABSORB));
    expect(values(p[0]!)).toEqual([70_000, 50_000]);
    expect(p[0]!.cost).toBe(6 + 4);
    expect(p[0]!.path).toContainEqual({ rule: 5, id: "same-observer", ok: true, name: "Juan" });
    const mixed = p.find(x => values(x).includes(55_000));
    if (mixed) expect(mixed.path).toContainEqual({ rule: 5, id: "new-links", ok: false, n: 2 });
  });

  it("the platform field counts too, and coins already linked say so", () => {
    const p = plans(adviseCoinSelection([coin(70_000, { labelPlatform: "RoboSats" }), coin(50_000, { labelPlatform: "RoboSats" })], 100_000, 1, NO_ABSORB))[0]!;
    expect(p.path).toContainEqual({ rule: 5, id: "same-observer", ok: true, name: "RoboSats" });
    const linked = plans(adviseCoinSelection([coin(70_000, { cluster: "a" }), coin(50_000, { cluster: "a" })], 100_000, 1, NO_ABSORB))[0]!;
    expect(linked.path).toContainEqual({ rule: 5, id: "already-linked", ok: true });
  });
});

describe("rule 9: merging only CoinJoin outputs (ruling)", () => {
  it("is the least-bad merge when one is needed: cheaper than a merge of coins with history, never good", () => {
    const p = plans(adviseCoinSelection([
      coin(60_000, { origin: "mixed" }), coin(40_500, { origin: "mixed" }), coin(55_000), coin(45_250),
    ], 100_000, 1, NO_ABSORB));
    expect(values(p[0]!)).toEqual([60_000, 40_500]);
    expect(p[0]!.cost).toBe(11);
    expect(p[0]!.warnings[0]).toMatchObject({ id: "coinjoin-merge", severity: "high" });
    expect(p[0]!.path).toContainEqual({ rule: 9, id: "coinjoin-only", ok: false, n: 2 });
    expect(p.find(x => values(x).join() === "55000,45250")!.cost).toBe(12);
    // Mixed with unmixed coins: never (severe)
    expect(p.some(x => x.selected.some(c => c.origin === "mixed") && x.selected.some(c => c.origin !== "mixed"))).toBe(false);
  });
});

describe("alerts (rules 3, 6, 7)", () => {
  const base = { amount: 123_456, recipient: null, walletType: "p2wpkh", history: null, apiReused: null, change: 0 };
  it("none for a non-round amount with no recipient and no change", () => {
    expect(spendingAlerts(base)).toEqual([]);
  });
  it("reused from history beats the API answer; the API answer alone is enough", () => {
    const history = { sent: 1, paid: 2, known: new Map() };
    expect(spendingAlerts({ ...base, history, apiReused: true })).toEqual([{ id: "reused-history", severity: "critical", sent: 1, paid: 2 }]);
    expect(spendingAlerts({ ...base, history: { sent: 0, paid: 0, known: new Map() }, apiReused: true })).toEqual([{ id: "reused-api", severity: "critical" }]);
    expect(spendingAlerts({ ...base, apiReused: false })).toEqual([]);
  });
  it("round amount, type mismatch and change tips", () => {
    const a = spendingAlerts({ ...base, amount: 100_000, recipient: "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0", change: 5 });
    expect(a.map(x => x.id)).toEqual(["round", "type-mismatch", "change-tips"]);
    expect(a[1]).toMatchObject({ to: "p2tr", from: "p2wpkh" });
    expect(spendingAlerts({ ...base, recipient: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" })).toEqual([]);
  });
  it("the wallet type is the most common among its coins", () => {
    expect(walletAddressType([coin(1), coin(1), { ...coin(1), address: "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0" }])).toBe("p2wpkh");
    expect(walletAddressType([])).toBeNull();
  });
});

describe("recipient validation", () => {
  it("checks the checksum and the network", () => {
    expect(validRecipient("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "mainnet")).toBe(true);
    expect(validRecipient("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5", "mainnet")).toBe(false);
    expect(validRecipient("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "signet")).toBe(false);
    expect(validRecipient("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", "testnet4")).toBe(true);
    expect(validRecipient("", "mainnet")).toBe(false);
  });
});

describe("rule 8: round change", () => {
  const plan = (paymentAmount: number, change: number, fee = 700) => ({ paymentAmount, change, fee }) as CoinSelectionPlan;
  it("nudges the fee down to the next multiple of 10,000 in change", () => {
    const r = roundChange(plan(100_000, 32_295), 5_000)!;
    expect(r).toEqual({ extra: 2_295, change: 30_000, fee: 2_995 });
    expect(isRoundAmount(r.change)).toBe(true);
  });
  it("caps the nudge at the max extra fee and 5% of the payment", () => {
    expect(roundChangeCap(100_000, 5_000)).toBe(5_000);
    expect(roundChangeCap(60_000, 5_000)).toBe(3_000);
    expect(roundChange(plan(100_000, 35_000), 5_000)).toEqual({ extra: 5_000, change: 30_000, fee: 5_700 });
    expect(roundChange(plan(100_000, 35_001), 5_000)).toBeNull();
    expect(roundChange(plan(60_000, 33_500), 5_000)).toBeNull();
    expect(roundChange(plan(100_000, 32_295), 0)).toBeNull();
  });
  it("nothing when the payment is not round, there is no change, or the change is already round or too small", () => {
    expect(roundChange(plan(100_001, 32_295), 5_000)).toBeNull();
    expect(roundChange(plan(100_000, 0), 5_000)).toBeNull();
    expect(roundChange(plan(100_000, 40_000), 5_000)).toBeNull();
    expect(roundChange(plan(100_000, 9_000), 5_000)).toBeNull();
  });
});
