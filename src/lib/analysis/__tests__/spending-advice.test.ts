import { describe, it, expect } from "vitest";
import { buildCoinInputs, outpointOf, type CoinSelectionInput, type CoinSelectionPlan } from "../coin-selection";
import { recipientHistory, roundChange, roundChangeCap, spendingAlerts, validRecipient, walletAddressType } from "../spending-advice";
import { History, ext, recv } from "./fixtures/wallet-history";
import { isRoundAmount } from "../heuristics/round-amount";

let seq = 0;
function coin(value: number, opts: Partial<Omit<CoinSelectionInput, "utxo">> & { txid?: string } = {}): CoinSelectionInput {
  const { txid, ...rest } = opts;
  seq++;
  return { utxo: { txid: txid ?? `sp${seq}`, vout: 0, value, status: { confirmed: true } }, address: `bc1qspend${seq}`, ...rest };
}

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
  it("spend change on its own: the coins that are not change cannot pay", () => {
    expect(spendingAlerts({ ...base, changeOnly: { plainTotal: 2_502_357, compliant: true } }))
      .toEqual([{ id: "change-alone", severity: "medium", amount: 2_502_357 }]);
    expect(spendingAlerts({ ...base, changeOnly: { plainTotal: 0, compliant: false } }))
      .toEqual([{ id: "change-merge-needed", severity: "high", amount: 0 }]);
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
