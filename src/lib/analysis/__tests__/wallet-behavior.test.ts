import { describe, it, expect } from "vitest";
import { History, coinJoin, recv, chg, ext, walletAddrs } from "./fixtures/wallet-history";
import { buildWalletGraph, coinClass, soloSpends, simplePayments, utxoOrigins } from "../wallet-behavior";
import { isCoinJoinTx } from "../heuristics/coinjoin";
import { detectTx0 } from "../heuristics/coinjoin-premix";

describe("coinClass", () => {
  it("classifies received, change, self, mixed, CoinJoin change and unknown", () => {
    const h = new History();
    const r = h.receive(recv(0), 1_000_000, 100);
    const [pay, change] = h.tx([r], [{ address: ext(1), value: 300_000 }, { address: chg(0), value: 699_000 }], 101);
    const [self] = h.tx([change!], [{ address: recv(1), value: 698_000 }], 102);
    const r2 = h.receive(recv(2), 2_000_000, 103);
    const cj = coinJoin(h, r2, 1_000_000, recv(3), chg(1), 104);
    const g = buildWalletGraph(h.infos(walletAddrs(4)));

    expect(isCoinJoinTx(g.txs.get(cj[0]!.txid)!)).toBe(true); // fixture guard
    expect(coinClass(g, r.txid, r.vout)).toBe("received");
    expect(coinClass(g, change!.txid, change!.vout)).toBe("change");
    expect(coinClass(g, pay!.txid, pay!.vout)).toBe("change"); // an output's class comes from its tx; only wallet outputs are ever asked
    expect(coinClass(g, self!.txid, self!.vout)).toBe("self");
    expect(coinClass(g, cj[0]!.txid, 0)).toBe("mixed");
    expect(coinClass(g, cj[5]!.txid, 5)).toBe("coinjoin-change");
    expect(coinClass(g, "f".repeat(64), 0)).toBe("unknown");
    expect(coinClass(g, r.txid, 9)).toBe("unknown");
  });

  it("classifies a Whirlpool tx0's toxic change as CoinJoin change", () => {
    const h = new History();
    const r = h.receive(recv(0), 300_000, 100);
    const out = h.tx([r], [
      { address: recv(1), value: 100_000 },
      { address: recv(2), value: 100_000 },
      { address: ext(1), value: 5_000 },
      { address: chg(0), value: 90_000 },
    ], 101);
    const g = buildWalletGraph(h.infos(walletAddrs(3)));
    expect(detectTx0(g.txs.get(out[0]!.txid)!)).not.toBeNull(); // fixture guard
    expect(coinClass(g, out[3]!.txid, 3)).toBe("coinjoin-change");
    expect(coinClass(g, out[0]!.txid, 0)).toBe("change");
  });
});

describe("soloSpends and simplePayments", () => {
  it("skips txs with an outside input and CoinJoins; payments need one change and one recipient", () => {
    const h = new History();
    const a = h.receive(recv(0), 500_000, 100);
    const b = h.receive(recv(1), 500_000, 101);
    const c = h.receive(recv(2), 2_000_000, 102);
    const d = h.receive(recv(3), 400_000, 103);
    const e = h.receive(recv(4), 400_000, 104);
    // payment: one recipient + change
    h.tx([a], [{ address: ext(1), value: 100_000 }, { address: chg(0), value: 399_000 }], 110);
    // batch: two recipients + change (solo spend, not a simple payment)
    h.tx([b], [{ address: ext(2), value: 100_000 }, { address: ext(3), value: 100_000 }, { address: chg(1), value: 299_000 }], 111);
    // collaborative: one outside input (skipped entirely, never labelled)
    h.tx([d, { address: ext(50), value: 300_000 }], [{ address: ext(4), value: 350_000 }, { address: chg(2), value: 349_000 }], 112);
    // CoinJoin the wallet joined
    coinJoin(h, c, 1_000_000, recv(5), chg(3), 113);
    // changeless and self-transfer (solo spends, not payments)
    h.tx([e], [{ address: ext(5), value: 399_000 }], 114);
    const g = buildWalletGraph(h.infos(walletAddrs(6)));

    const spends = soloSpends(g);
    expect(spends.map((t) => t.status.block_height)).toEqual([110, 111, 114]);
    expect(simplePayments(g, spends).map((p) => p.tx.status.block_height)).toEqual([110]);
    const [p] = simplePayments(g, spends);
    expect(p!.change.scriptpubkey_address).toBe(chg(0));
    expect(p!.payment.scriptpubkey_address).toBe(ext(1));
  });

  it("counts a tx listed under several wallet addresses once", () => {
    const h = new History();
    const a = h.receive(recv(0), 500_000, 100);
    h.tx([a], [{ address: ext(1), value: 100_000 }, { address: chg(0), value: 399_000 }], 101);
    const g = buildWalletGraph(h.infos(walletAddrs(1))); // the payment is in recv(0)'s and chg(0)'s lists
    expect(g.txs.size).toBe(2);
    expect(soloSpends(g)).toHaveLength(1);
  });
});

describe("utxoOrigins", () => {
  it("sums unspent coins by class", () => {
    const h = new History();
    h.receive(recv(0), 10_000, 100);
    const r = h.receive(recv(1), 1_000_000, 101);
    h.tx([r], [{ address: ext(1), value: 300_000 }, { address: chg(0), value: 699_000 }], 102);
    const infos = h.infos(walletAddrs(2));
    const o = utxoOrigins(buildWalletGraph(infos), infos);
    expect(o.received).toEqual({ count: 1, sats: 10_000 });
    expect(o.change).toEqual({ count: 1, sats: 699_000 });
    expect(o.mixed).toEqual({ count: 0, sats: 0 });
  });

  it("is all zeros for an empty wallet", () => {
    const o = utxoOrigins(buildWalletGraph([]), []);
    expect(Object.values(o).every((v) => v.count === 0 && v.sats === 0)).toBe(true);
  });
});
