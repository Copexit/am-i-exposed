import { describe, it, expect } from "vitest";
import { History, coinJoin, recv, chg, ext, walletAddrs } from "./fixtures/wallet-history";
import { buildWalletGraph } from "../wallet-behavior";
import { buildClusters } from "../wallet-clusters";
import { checkMerges } from "../wallet-heuristics";

const clusters = (h: History, n = 8) => {
  const g = buildWalletGraph(h.infos(walletAddrs(n)));
  return { g, c: buildClusters(g) };
};

describe("buildClusters", () => {
  it("links coins by address, by solo-spend co-spending and by wallet-owned ancestry", () => {
    const h = new History();
    const r0 = h.receive(recv(0), 1_000_000, 100);
    const r0b = h.receive(recv(0), 50_000, 101); // same address as r0
    const r1 = h.receive(recv(1), 400_000, 102); // unrelated receipt
    // r0 pays someone, keeping change c0 and a self output s0 (same funding tx)
    const [, c0, s0] = h.tx([r0], [{ address: ext(1), value: 100_007 }, { address: chg(0), value: 500_000 }, { address: recv(2), value: 398_000 }], 103);
    // s0 pays again: its change c1 descends from r0 too
    const [, c1] = h.tx([s0!], [{ address: ext(2), value: 100_009 }, { address: chg(1), value: 297_000 }], 104);
    const { c } = clusters(h);
    const id = (x: { txid: string; vout: number }) => c.of(x.txid, x.vout);
    expect(id(r0b)).toBe(id(r0));
    expect(id(c0!)).toBe(id(r0));
    expect(id(c1!)).toBe(id(c0!));
    expect(id(r1)).not.toBe(id(r0));
    expect(c.linking.size).toBe(0);
  });

  it("never links CoinJoin outputs to the wallet's inputs or to each other, nor a received batch", () => {
    const h = new History();
    const r = h.receive(recv(0), 2_000_000, 100);
    const cj = coinJoin(h, r, 1_000_000, recv(1), chg(0), 101);
    const batch = h.tx([{ address: ext(50), value: 900_000 }], [{ address: recv(2), value: 300_000 }, { address: recv(3), value: 300_000 }], 102);
    const { c } = clusters(h);
    const ids = [c.of(r.txid, r.vout), c.of(cj[0]!.txid, 0), c.of(cj[5]!.txid, 5), c.of(batch[0]!.txid, 0), c.of(batch[1]!.txid, 1)];
    expect(new Set(ids).size).toBe(5);
  });

  it("records the clusters a spend linked, as they were before it", () => {
    const h = new History();
    const a = h.receive(recv(0), 100_000, 100);
    const b = h.receive(recv(1), 100_000, 101);
    const m = h.tx([a, b], [{ address: ext(1), value: 150_000 }, { address: chg(0), value: 49_000 }], 102);
    const { c } = clusters(h);
    const before = c.linking.get(m[0]!.txid)!;
    expect(before).toHaveLength(2);
    expect(before[0]).not.toBe(before[1]);
    expect(c.of(a.txid, a.vout)).toBe(c.of(b.txid, b.vout));
  });

  it("handles a peel chain thousands of payments long", () => {
    const h = new History();
    let coin = h.receive(recv(0), 1e9, 1);
    for (let i = 0; i < 3_000; i++) coin = h.tx([coin], [{ address: ext(i), value: 10_007 }, { address: chg(i % 4), value: coin.value - 20_000 }], 2 + i)[1]!;
    const { c } = clusters(h, 4);
    expect(c.of(coin.txid, coin.vout)).toBe(c.of(h.txs[0]!.txid, 0));
  });
});

describe("W2 with linkage clusters", () => {
  it("does not count change merged with a coin that descends from the same wallet coins", () => {
    const h = new History();
    const r = h.receive(recv(0), 1_000_000, 100);
    const [, c0, s0] = h.tx([r], [{ address: ext(1), value: 100_007 }, { address: chg(0), value: 300_000 }, { address: recv(1), value: 598_000 }], 101);
    const [, c1] = h.tx([s0!], [{ address: ext(2), value: 100_009 }, { address: chg(1), value: 497_000 }], 102);
    h.tx([c0!, c1!], [{ address: ext(3), value: 796_000 }], 103);
    const { g, c } = clusters(h);
    expect(checkMerges(g, [...g.txs.values()].filter((t) => t.vin.every((v) => g.own.has(v.prevout!.scriptpubkey_address!))), c).findings).toEqual([]);
  });

  it("still counts change merged with an unrelated receipt", () => {
    const h = new History();
    const r = h.receive(recv(0), 1_000_000, 100);
    const [, c0] = h.tx([r], [{ address: ext(1), value: 100_007 }, { address: chg(0), value: 898_000 }], 101);
    const other = h.receive(recv(1), 50_000, 102);
    h.tx([c0!, other], [{ address: ext(3), value: 940_000 }], 103);
    const { g, c } = clusters(h);
    const spends = [...g.txs.values()].filter((t) => t.vin.every((v) => g.own.has(v.prevout!.scriptpubkey_address!)));
    expect(checkMerges(g, spends, c).findings.map((f) => f.id)).toEqual(["wallet-change-merge"]);
  });
});
