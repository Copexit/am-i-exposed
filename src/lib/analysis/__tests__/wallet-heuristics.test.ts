import { describe, it, expect } from "vitest";
import { History, coinJoin, recv, chg, ext, extTaproot, walletAddrs, type Coin } from "./fixtures/wallet-history";
import { buildWalletGraph, simplePayments, soloSpends } from "../wallet-behavior";
import { checkMerges, checkChangeExposure, checkPeelChains, checkNoMerge, txRefs, MAX_TX_REFS } from "../wallet-heuristics";

const run = (h: History, n = 8) => {
  const g = buildWalletGraph(h.infos(walletAddrs(n)));
  const spends = soloSpends(g);
  return { g, spends, payments: simplePayments(g, spends) };
};

/** A payment from `coin` paying `value` out, change to `changeTo`. */
const pay = (h: History, coin: Coin, value: number, changeTo: string, height: number, to = ext(height)) =>
  h.tx([coin], [{ address: to, value }, { address: changeTo, value: coin.value - value - 1_000 }], height);

describe("txRefs", () => {
  it("caps the list and counts the rest", () => {
    const ids = Array.from({ length: 13 }, (_, i) => String(i));
    expect(JSON.parse(txRefs(ids)._txids)).toHaveLength(MAX_TX_REFS);
    expect(txRefs(ids).more).toBe(3);
    expect(txRefs(["a"]).more).toBe(0);
  });
});

describe("checkMerges", () => {
  it("W1 unmixed: a mixed output spent with change is critical -15, and not also a change merge", () => {
    const h = new History();
    const r = h.receive(recv(0), 2_000_000, 100);
    const cj = coinJoin(h, r, 1_000_000, recv(1), chg(0), 101);
    const [, change] = pay(h, h.receive(recv(2), 500_000, 102), 100_001, chg(1), 103);
    const m = h.tx([cj[0]!, change!], [{ address: ext(1), value: 1_300_000 }], 104);
    const { findings, merged } = checkMerges(run(h).g, run(h).spends);
    expect(findings.map((f) => [f.id, f.severity, f.scoreImpact])).toEqual([["wallet-postmix-merge", "critical", -15]]);
    expect(findings[0]!.params).toMatchObject({ _variant: "unmixed", unmixedCount: 1, mixedOnlyCount: 0, count: 1 });
    expect(JSON.parse(String(findings[0]!.params!._txids))).toEqual([m[0]!.txid]);
    expect([...merged]).toEqual([m[0]!.txid]);
  });

  it("W1 mixed-only: two outputs of the same CoinJoin merged is high -8; two such spends -12", () => {
    const h = new History();
    const r = h.receive(recv(0), 3_000_000, 100);
    const others = [1, 2, 3].map((i) => ({ address: ext(70 + i), value: 1_050_000 }));
    const cj = h.tx([r, ...others], [recv(1), recv(2), ext(80), ext(81), ext(82)].map((address) => ({ address, value: 1_000_000 })), 101);
    h.tx([cj[0]!, cj[1]!], [{ address: ext(1), value: 1_990_000 }], 102);
    let f = checkMerges(run(h).g, run(h).spends).findings;
    expect(f.map((x) => [x.id, x.severity, x.scoreImpact, x.params?._variant])).toEqual([["wallet-postmix-merge", "high", -8, "mixed"]]);

    const r2 = h.receive(recv(3), 3_000_000, 103);
    const cj2 = h.tx([r2, ...others], [recv(4), recv(5), ext(83), ext(84), ext(85)].map((address) => ({ address, value: 1_000_000 })), 104);
    h.tx([cj2[0]!, cj2[1]!], [{ address: ext(2), value: 1_990_000 }], 105);
    f = checkMerges(run(h).g, run(h).spends).findings;
    expect(f[0]!.scoreImpact).toBe(-12);
  });

  it("W1: an unknown-origin input does not make the merge 'unmixed'", () => {
    const h = new History();
    const r = h.receive(recv(0), 2_000_000, 100);
    const cj = coinJoin(h, r, 1_000_000, recv(1), chg(0), 101);
    // recv(2) holds a coin whose funding tx is outside the scanned history
    h.tx([cj[0]!, { txid: "e".repeat(64), vout: 0, address: recv(2), value: 50_000 }], [{ address: ext(1), value: 1_040_000 }], 102);
    const f = checkMerges(run(h).g, run(h).spends).findings;
    expect(f[0]!.params?._variant).toBe("mixed");
  });

  it("W2: change merged with a receipt is medium -4; 2 spends high -7; 5 spends high -10", () => {
    const h = new History();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const [, change] = pay(h, h.receive(recv(i * 2), 1_000_000, 100 + i * 10), 200_007, chg(i), 101 + i * 10);
      const other = h.receive(recv(i * 2 + 1), 300_000, 102 + i * 10);
      ids.push(h.tx([change!, other], [{ address: ext(200 + i), value: 1_090_000 }], 103 + i * 10)[0]!.txid);
      const f = checkMerges(run(h, 12).g, run(h, 12).spends).findings;
      expect(f).toHaveLength(1);
      expect(f[0]!.id).toBe("wallet-change-merge");
      expect([f[0]!.severity, f[0]!.scoreImpact]).toEqual(i === 0 ? ["medium", -4] : i < 4 ? ["high", -7] : ["high", -10]);
    }
    expect(JSON.parse(String(checkMerges(run(h, 12).g, run(h, 12).spends).findings[0]!.params!._txids))).toEqual(ids);
  });

  it("W2 ignores merges of outputs of one tx and receipts-only merges", () => {
    const h = new History();
    const r = h.receive(recv(0), 1_000_000, 100);
    const out = h.tx([r], [{ address: ext(1), value: 100_007 }, { address: chg(0), value: 400_000 }, { address: chg(1), value: 498_000 }], 101);
    h.tx([out[1]!, out[2]!], [{ address: ext(2), value: 897_000 }], 102);
    h.tx([h.receive(recv(1), 100_000, 103), h.receive(recv(2), 100_000, 104)], [{ address: ext(3), value: 199_000 }], 105);
    const { findings, merged } = checkMerges(run(h).g, run(h).spends);
    expect(findings).toEqual([]);
    expect(merged.size).toBe(0);
  });
});

describe("checkChangeExposure", () => {
  it("counts only rules that point at the real change, by ratio", () => {
    const h = new History();
    // type: payment to Taproot, change P2WPKH like the input
    pay(h, h.receive(recv(0), 1_000_000, 100), 123_457, chg(0), 101, extTaproot(1));
    // round payment, non-round change
    pay(h, h.receive(recv(1), 1_000_000, 102), 200_000, chg(1), 103);
    // optimal: change 48,000 below both inputs, payment above
    h.tx([h.receive(recv(2), 500_000, 104), h.receive(recv(3), 600_000, 105)], [{ address: ext(2), value: 1_051_003 }, { address: chg(2), value: 48_000 }], 106);
    // not exposed: same types, non-round, single input
    pay(h, h.receive(recv(4), 1_000_000, 107), 123_457, chg(3), 108);
    // a rule that would point at the payment does not count: round change, non-round payment
    pay(h, h.receive(recv(5), 1_001_000, 109), 123_457, chg(4), 110);
    const { payments } = run(h);
    expect(payments).toHaveLength(5);
    const [f] = checkChangeExposure(payments);
    expect(f!.params).toMatchObject({ exposed: 3, payments: 5, ratio: 60, byType: 1, byRound: 1, byOptimal: 1 });
    expect([f!.severity, f!.scoreImpact]).toEqual(["high", -6]);
  });

  it("does not count a payment whose rules contradict each other", () => {
    const h = new History();
    // type points at the change (Taproot payment), round points at the payment (round change 500,000)
    pay(h, h.receive(recv(0), 623_457 + 1_000, 100), 123_457, chg(0), 101, extTaproot(1));
    // optimal points at the change, round points at the payment (round change)
    h.tx([h.receive(recv(1), 300_000, 102), h.receive(recv(2), 400_000, 103)], [{ address: ext(2), value: 599_003 }, { address: chg(1), value: 100_000 }], 104);
    // only type: counted
    pay(h, h.receive(recv(3), 1_000_000, 105), 123_457, chg(2), 106, extTaproot(2));
    const [f] = checkChangeExposure(run(h).payments);
    expect(f!.params).toMatchObject({ exposed: 1, payments: 3, byType: 1, byRound: 0, byOptimal: 0 });
  });

  it("medium above 20%, low otherwise, nothing when none exposed", () => {
    const h = new History();
    pay(h, h.receive(recv(0), 1_000_000, 100), 200_000, chg(0), 101); // exposed (round)
    for (let i = 1; i < 5; i++) pay(h, h.receive(recv(i), 1_000_000, 100 + i * 2), 123_457, chg(i), 101 + i * 2);
    expect(checkChangeExposure(run(h).payments)[0]!.scoreImpact).toBe(-2); // 1 of 5 = 20%, not above
    pay(h, h.receive(recv(6), 1_000_000, 120), 300_000, chg(6), 121);
    expect(checkChangeExposure(run(h).payments)[0]!.scoreImpact).toBe(-4); // 2 of 6
    expect(checkChangeExposure([])).toEqual([]);
  });
});

describe("checkPeelChains", () => {
  const chain = (h: History, start: Coin, n: number, changeBase: number, height: number) => {
    let coin = start;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const out = pay(h, coin, 10_007 + i, chg(changeBase + i), height + i);
      ids.push(out[0]!.txid);
      coin = out[1]!;
    }
    return ids;
  };

  it("no finding below 3 payments; medium -3 at 3; high -6 at 6; reports the longest chain in order", () => {
    const h = new History();
    chain(h, h.receive(recv(0), 5_000_000, 100), 2, 0, 101);
    expect(checkPeelChains(run(h, 20).payments)).toEqual([]);

    const ids3 = chain(h, h.receive(recv(1), 5_000_000, 110), 3, 2, 111);
    let [f] = checkPeelChains(run(h, 20).payments);
    expect([f!.severity, f!.scoreImpact, f!.params?.count, f!.params?.chains]).toEqual(["medium", -3, 3, 1]);
    expect(JSON.parse(String(f!.params!._txids))).toEqual(ids3);

    const ids6 = chain(h, h.receive(recv(2), 5_000_000, 120), 6, 5, 121);
    [f] = checkPeelChains(run(h, 20).payments);
    expect([f!.severity, f!.scoreImpact, f!.params?.count, f!.params?.chains]).toEqual(["high", -6, 6, 2]);
    expect(JSON.parse(String(f!.params!._txids))).toEqual(ids6);
  });

  it("a multi-input payment breaks the chain", () => {
    const h = new History();
    const [, c0] = pay(h, h.receive(recv(0), 5_000_000, 100), 10_007, chg(0), 101);
    const [, c1] = pay(h, c0!, 10_009, chg(1), 102);
    const [, c2] = h.tx([c1!, h.receive(recv(1), 50_000, 103)], [{ address: ext(1), value: 60_011 }, { address: chg(2), value: c1!.value - 11_000 }], 104);
    pay(h, c2!, 10_013, chg(3), 105);
    expect(checkPeelChains(run(h).payments)).toEqual([]);
  });
});

describe("checkNoMerge", () => {
  it("rewards 3+ spends without merges", () => {
    expect(checkNoMerge(3, false).map((f) => [f.id, f.severity, f.scoreImpact])).toEqual([["wallet-no-merge", "good", 3]]);
    expect(checkNoMerge(2, false)).toEqual([]);
    expect(checkNoMerge(5, true)).toEqual([]);
  });
});
