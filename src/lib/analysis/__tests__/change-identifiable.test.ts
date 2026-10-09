import { describe, it, expect } from "vitest";
import { History, chg, ext, extTaproot, recv, walletAddrs } from "./fixtures/wallet-history";
import { buildWalletGraph } from "../wallet-behavior";
import { changeIdentifiable } from "../change-identifiable";
import { analyzeChangeDetection } from "../heuristics/change-detection";

const graph = (h: History, n = 8) => buildWalletGraph(h.infos(walletAddrs(n)));

describe("changeIdentifiable", () => {
  it("missing data reads as unknown (taken as identifiable), never as ambiguous", () => {
    const h = new History();
    const r = h.receive(recv(0), 1_000_000, 100);
    const [, c] = h.tx([r, { txid: "f".repeat(64), vout: 0, address: "", value: 10_000 }], [{ address: ext(1), value: 100_007 }, { address: chg(0), value: 908_000 }], 101);
    const g = graph(h);
    expect(changeIdentifiable(g, "e".repeat(64), 0)).toBe("unknown");
    // An input with no prevout address
    expect(changeIdentifiable(g, c!.txid, c!.vout)).toBe("unknown");
  });

  it("W2 asks as of the merge: an address spend after it does not make the change identifiable", () => {
    const h = new History();
    const [, c0] = h.tx([h.receive(recv(0), 1_000_000, 100)], [{ address: ext(1), value: 100_007 }, { address: chg(0), value: 898_000 }], 101);
    const merge = h.tx([c0!, h.receive(recv(1), 20_000, 102)], [{ address: ext(3), value: 916_000 }], 103);
    // Later, another coin on chg(0) is spent
    const later = h.receive(chg(0), 30_000, 104);
    h.tx([later], [{ address: ext(4), value: 29_000 }], 105);
    const g = graph(h);
    expect(changeIdentifiable(g, c0!.txid, c0!.vout, g.txs.get(merge[0]!.txid))).toBeNull();
    expect(changeIdentifiable(g, c0!.txid, c0!.vout)).toBe("spent-address");
  });

  it("parity with H2: change the engine's change detection picks is never ambiguous", () => {
    let seed = 11;
    const rnd = (n: number) => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed % n; };
    let picked = 0;
    for (let k = 0; k < 300; k++) {
      const h = new History();
      const inputs = Array.from({ length: 1 + rnd(3) }, (_, i) => h.receive(recv(i), 50_000 + rnd(2_000_000), 100 + i));
      const total = inputs.reduce((s, c) => s + c.value, 0);
      const pay = rnd(2) ? (1 + rnd(Math.max(1, Math.floor(total / 20_000)))) * 10_000 : 1_000 + rnd(total - 5_000);
      if (pay >= total - 2_000) continue;
      const payTo = rnd(3) === 0 ? extTaproot(k) : ext(k);
      const outs = [{ address: payTo, value: pay }, { address: chg(0), value: total - pay - 1_000 }];
      if (rnd(2)) outs.reverse();
      const tx = h.tx(inputs, outs, 110);
      const g = graph(h);
      const vout = tx.findIndex((o) => o.address === chg(0));
      const f = analyzeChangeDetection(g.txs.get(tx[0]!.txid)!).findings.find((x) => x.id === "h2-change-detected");
      if (f?.params?.changeIndex === vout) {
        picked++;
        expect(changeIdentifiable(g, tx[0]!.txid, vout)).not.toBeNull();
      }
    }
    expect(picked).toBeGreaterThan(20);
  });
});
