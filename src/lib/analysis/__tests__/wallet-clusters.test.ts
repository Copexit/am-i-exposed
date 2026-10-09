import { describe, it, expect } from "vitest";
import { History, coinJoin, recv, chg, ext, walletAddrs } from "./fixtures/wallet-history";
import { buildWalletGraph } from "../wallet-behavior";
import { buildClusters } from "../wallet-clusters";
import { checkMerges } from "../wallet-heuristics";
import { buildCoinInputs, evaluateSelection, outpointOf } from "../coin-selection";

const clusters = (h: History, n = 8) => {
  const g = buildWalletGraph(h.infos(walletAddrs(n)));
  return { g, c: buildClusters(g) };
};

describe("buildClusters", () => {
  it("certain: address and single-output descent; inferred: sibling wallet outputs and their descendants", () => {
    const h = new History();
    const r0 = h.receive(recv(0), 1_000_000, 100);
    const r0b = h.receive(recv(0), 50_000, 101); // same address as r0
    const r1 = h.receive(recv(1), 400_000, 102); // unrelated receipt
    // r0 pays someone, keeping change c0 and a self output s0 (same funding tx)
    const [, c0, s0] = h.tx([r0], [{ address: ext(1), value: 100_007 }, { address: chg(0), value: 500_000 }, { address: recv(2), value: 398_000 }], 103);
    // s0 pays a round amount: its change c1 (identifiable by the round-amount rule) descends from r0 too
    const [, c1] = h.tx([s0!], [{ address: ext(2), value: 100_000 }, { address: chg(1), value: 297_009 }], 104);
    const { c } = clusters(h);
    const id = (x: { txid: string; vout: number }) => c.of(x.txid, x.vout);
    const inf = (x: { txid: string; vout: number }) => c.inferredOf(x.txid, x.vout);
    expect(id(r0b)).toBe(id(r0));
    // 2 wallet outputs: c0 and s0 are only inferred to be linked, to each other and to r0
    expect(id(c0!)).not.toBe(id(r0));
    expect(id(s0!)).not.toBe(id(c0!));
    expect([inf(c0!), inf(s0!)]).toEqual([inf(r0), inf(r0)]);
    // 1 wallet output, identifiable change: c1 is certainly s0's
    expect(id(c1!)).toBe(id(s0!));
    expect(inf(c1!)).toBe(inf(c0!));
    expect(inf(r1)).not.toBe(inf(r0));
    expect(c.linking.size).toBe(0);
  });

  it("links a CoinJoin's change to the wallet's inputs, never its mixed output, nor a received batch", () => {
    const h = new History();
    const r = h.receive(recv(0), 2_000_000, 100);
    const cj = coinJoin(h, r, 1_000_000, recv(1), chg(0), 101);
    const batch = h.tx([{ address: ext(50), value: 900_000 }], [{ address: recv(2), value: 300_000 }, { address: recv(3), value: 300_000 }], 102);
    const { c } = clusters(h);
    expect(c.of(cj[5]!.txid, 5)).toBe(c.of(r.txid, r.vout));
    const ids = [c.of(r.txid, r.vout), c.of(cj[0]!.txid, 0), c.of(batch[0]!.txid, 0), c.of(batch[1]!.txid, 1)];
    expect(new Set(ids).size).toBe(4);
  });

  it("does not link CoinJoin change to wallet inputs that span more than one cluster", () => {
    const h = new History();
    const a = h.receive(recv(0), 1_000_000, 100);
    const b = h.receive(recv(1), 1_000_000, 101);
    const others = [1, 2, 3, 4].map((i) => ({ address: ext(500 + i), value: 1_050_000 }));
    const out = h.tx([a, b, ...others], [...[0, 1, 2, 3, 4].map((i) => ({ address: ext(600 + i), value: 1_000_000 })), { address: chg(0), value: 990_000 }], 102);
    const { c } = clusters(h);
    const change = c.of(out[5]!.txid, 5);
    expect([c.of(a.txid, a.vout), c.of(b.txid, b.vout)]).not.toContain(change);
    expect([c.inferredOf(a.txid, a.vout), c.inferredOf(b.txid, b.vout)]).not.toContain(c.inferredOf(out[5]!.txid, 5));
  });

  it("records the clusters a spend linked, as they were before it", () => {
    const h = new History();
    const a = h.receive(recv(0), 100_000, 100);
    const b = h.receive(recv(1), 100_000, 101);
    const m = h.tx([a, b], [{ address: ext(1), value: 150_000 }, { address: chg(0), value: 49_000 }], 102);
    const { c } = clusters(h);
    const before = c.linking.get(m[0]!.txid)!.certain;
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
  it("counts change merged with a coin from a sibling output's line, a notch lower (inferred link)", () => {
    const h = new History();
    const r = h.receive(recv(0), 1_000_000, 100);
    const [, c0, s0] = h.tx([r], [{ address: ext(1), value: 100_007 }, { address: chg(0), value: 300_000 }, { address: recv(1), value: 598_000 }], 101);
    const [, c1] = h.tx([s0!], [{ address: ext(2), value: 100_009 }, { address: chg(1), value: 497_000 }], 102);
    h.tx([c0!, c1!], [{ address: ext(3), value: 796_000 }], 103);
    const { g, c } = clusters(h);
    const [f] = checkMerges(g, [...g.txs.values()].filter((t) => t.vin.every((v) => g.own.has(v.prevout!.scriptpubkey_address!))), c).findings;
    expect([f!.id, f!.severity, f!.scoreImpact, f!.params?.inferredCount]).toEqual(["wallet-change-merge", "low", -2, 1]);
  });

  it("does not count identifiable change merged with a coin it is certainly linked to (single-output descent)", () => {
    const h = new History();
    const r = h.receive(recv(0), 1_000_000, 100);
    const [, c0] = h.tx([r], [{ address: ext(1), value: 100_000 }, { address: chg(0), value: 898_007 }], 101);
    const r2 = h.receive(recv(0), 20_000, 102); // same address as r: certain
    h.tx([c0!, r2], [{ address: ext(3), value: 916_000 }], 103);
    const { g, c } = clusters(h);
    const spends = [...g.txs.values()].filter((t) => t.vin.every((v) => g.own.has(v.prevout!.scriptpubkey_address!)));
    expect(checkMerges(g, spends, c).findings).toEqual([]);
  });

  it("ambiguous change joins its payment's inputs only in the inferred tier: merging it with a coin on the input's address is a probable link and W2's lower notch", () => {
    const h = new History();
    const r = h.receive(recv(0), 1_000_000, 100);
    // 100,007 and 898,000 from one input: no change-detection rule tells which is change
    const [, c0] = h.tx([r], [{ address: ext(1), value: 100_007 }, { address: chg(0), value: 898_000 }], 101);
    const r2 = h.receive(recv(0), 20_000, 102); // same address as r: certainly linked to r
    const { c } = clusters(h);
    expect(c.of(c0!.txid, c0!.vout)).not.toBe(c.of(r2.txid, r2.vout));
    expect(c.inferredOf(c0!.txid, c0!.vout)).toBe(c.inferredOf(r2.txid, r2.vout));
    // The selector: no hard violation, a probable link, no new certain link
    const coins = buildCoinInputs(h.infos([{ address: recv(0), isChange: false, index: 0 }, { address: chg(0), isChange: true, index: 0 }]));
    const e = evaluateSelection(coins, new Set(coins.map(outpointOf)), 900_000, 1);
    if (e.kind !== "plan") throw new Error(e.kind);
    expect(e.plan.facts).toMatchObject({ violations: [], links: 0 });
    expect(e.plan.facts.probable).toBeGreaterThan(0);
    // W2, after the merge: the lower notch
    h.tx([c0!, r2], [{ address: ext(3), value: 916_000 }], 103);
    const after = clusters(h);
    const spends = [...after.g.txs.values()].filter((t) => t.vin.every((v) => after.g.own.has(v.prevout!.scriptpubkey_address!)));
    expect(checkMerges(after.g, spends, after.c).findings.map((f) => [f.id, f.severity, f.scoreImpact])).toEqual([["wallet-change-merge", "low", -2]]);
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

  it("scores W2 by its certain merges: 1 certain + 1 inferred is medium -4, counted as 2", () => {
    const h = new History();
    const r = h.receive(recv(0), 1_000_000, 100);
    const out = h.tx([r], [{ address: ext(1), value: 100_007 }, { address: chg(0), value: 400_000 }, { address: chg(1), value: 498_000 }], 101);
    const [, c2] = h.tx([out[1]!, out[2]!], [{ address: ext(2), value: 600_000 }, { address: chg(2), value: 297_000 }], 102); // inferred only
    h.tx([c2!, h.receive(recv(1), 50_000, 103)], [{ address: ext(3), value: 346_000 }], 104); // certain
    const { g, c } = clusters(h);
    const spends = [...g.txs.values()].filter((t) => t.vin.every((v) => g.own.has(v.prevout!.scriptpubkey_address!)));
    const [f] = checkMerges(g, spends, c).findings;
    expect([f!.severity, f!.scoreImpact, f!.params?.count, f!.params?.inferredCount]).toEqual(["medium", -4, 2, 1]);
  });
});
