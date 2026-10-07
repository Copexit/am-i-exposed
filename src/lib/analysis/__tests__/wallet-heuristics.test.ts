import { describe, it, expect } from "vitest";
import { History, coinJoin, recv, chg, ext, walletAddrs, type Coin } from "./fixtures/wallet-history";
import { buildWalletGraph, simplePayments, soloSpends } from "../wallet-behavior";
import { checkMerges, txRefs, MAX_TX_REFS } from "../wallet-heuristics";

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
