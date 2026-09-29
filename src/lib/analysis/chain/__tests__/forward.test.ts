import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import { analyzeForward } from "../forward";
import { makeTx, makeVin, makeVout, makeOutspend, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";
beforeEach(() => resetAddrCounter());

describe("analyzeForward", () => {
  it("detects post-CoinJoin consolidation", () => {
    const txid = "a".repeat(64);
    const denom = 100_000; // 0.001 BTC Samourai

    // Parent is a CoinJoin (5 equal outputs)
    const coinJoinTx = makeTx({
      txid,
      vin: Array.from({ length: 5 }, () => makeVin()),
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });

    // Child tx consolidates 2 CoinJoin outputs
    const childTx = makeTx({
      vin: [
        makeVin({ txid, vout: 0 }),
        makeVin({ txid, vout: 1 }),
      ],
      vout: [makeVout()],
    });

    const outspends = Array.from({ length: 5 }, (_, i) =>
      makeOutspend({ spent: i < 2, txid: childTx.txid, vin: i }),
    );

    const childTxs = new Map([[0, childTx]]);
    const { findings, consolidatedCoinJoinOutputs } = analyzeForward(coinJoinTx, outspends, childTxs);

    expect(consolidatedCoinJoinOutputs.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.id === "chain-post-coinjoin-consolidation")).toBe(true);
    const f = findings.find((f) => f.id === "chain-post-coinjoin-consolidation")!;
    expect(f.severity).toBe("critical");
    expect(f.scoreImpact).toBe(-15);
  });

  it("suppresses consolidation when child tx is a CoinJoin (remix)", () => {
    const txid = "a".repeat(64);
    const denom = 100_000; // 0.001 BTC Samourai

    // Parent is a CoinJoin (5 equal outputs)
    const coinJoinTx = makeTx({
      txid,
      vin: Array.from({ length: 5 }, () => makeVin()),
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });

    // Child tx is ALSO a CoinJoin (Whirlpool remix: 5 equal outputs at same denom)
    const childTx = makeTx({
      vin: [
        makeVin({ txid, vout: 0 }),
        makeVin({ txid, vout: 1 }),
        makeVin(),
        makeVin(),
        makeVin(),
      ],
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });

    const outspends = Array.from({ length: 5 }, (_, i) =>
      makeOutspend({ spent: i < 2, txid: childTx.txid, vin: i }),
    );

    const childTxs = new Map([[0, childTx]]);
    const { findings, consolidatedCoinJoinOutputs } = analyzeForward(coinJoinTx, outspends, childTxs);

    expect(consolidatedCoinJoinOutputs).toHaveLength(0);
    expect(findings.some((f) => f.id === "chain-post-coinjoin-consolidation")).toBe(false);
  });

  it("suppresses consolidation when child has 5+ distinct input sources and 5+ outputs (likely remix)", () => {
    const txid = "a".repeat(64);
    const denom = 100_000; // 0.001 BTC Samourai

    const coinJoinTx = makeTx({
      txid,
      vin: Array.from({ length: 5 }, () => makeVin()),
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });

    // Child tx has 5 distinct parent txids and 5 outputs (atypical CoinJoin)
    const childTx = makeTx({
      vin: [
        makeVin({ txid, vout: 0 }),
        makeVin({ txid, vout: 1 }),
        makeVin({ txid: "c".repeat(64) }),
        makeVin({ txid: "d".repeat(64) }),
        makeVin({ txid: "e".repeat(64) }),
        makeVin({ txid: "f".repeat(64) }),
      ],
      vout: Array.from({ length: 5 }, () => makeVout({ value: 3000 })),
    });

    const outspends = Array.from({ length: 5 }, (_, i) =>
      makeOutspend({ spent: i < 2, txid: childTx.txid, vin: i }),
    );

    const childTxs = new Map([[0, childTx]]);
    const { findings, consolidatedCoinJoinOutputs } = analyzeForward(coinJoinTx, outspends, childTxs);

    expect(consolidatedCoinJoinOutputs).toHaveLength(0);
    expect(findings.some((f) => f.id === "chain-post-coinjoin-consolidation")).toBe(false);
  });

  it("suppresses consolidation when child has 3+ distinct sources and equal-value outputs (small remix)", () => {
    const txid = "a".repeat(64);
    const denom = 100_000; // 0.001 BTC Samourai

    const coinJoinTx = makeTx({
      txid,
      vin: Array.from({ length: 5 }, () => makeVin()),
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });

    // Child tx has 3 distinct parent txids and equal-value output pair
    const childTx = makeTx({
      vin: [
        makeVin({ txid, vout: 0 }),
        makeVin({ txid, vout: 1 }),
        makeVin({ txid: "c".repeat(64) }),
        makeVin({ txid: "d".repeat(64) }),
      ],
      vout: [
        makeVout({ value: 5000 }),
        makeVout({ value: 5000 }),
        makeVout({ value: 2000 }),
      ],
    });

    const outspends = Array.from({ length: 5 }, (_, i) =>
      makeOutspend({ spent: i < 2, txid: childTx.txid, vin: i }),
    );

    const childTxs = new Map([[0, childTx]]);
    const { findings, consolidatedCoinJoinOutputs } = analyzeForward(coinJoinTx, outspends, childTxs);

    expect(consolidatedCoinJoinOutputs).toHaveLength(0);
    expect(findings.some((f) => f.id === "chain-post-coinjoin-consolidation")).toBe(false);
  });

  it("still detects consolidation for simple 2-input spend from same parent", () => {
    const txid = "a".repeat(64);
    const denom = 100_000; // 0.001 BTC Samourai

    const coinJoinTx = makeTx({
      txid,
      vin: Array.from({ length: 5 }, () => makeVin()),
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });

    // Simple consolidation: 2 inputs from same CoinJoin, 1 output, no other parties
    const childTx = makeTx({
      vin: [
        makeVin({ txid, vout: 0 }),
        makeVin({ txid, vout: 1 }),
      ],
      vout: [makeVout({ value: denom * 2 - 1000 })],
    });

    const outspends = Array.from({ length: 5 }, (_, i) =>
      makeOutspend({ spent: i < 2, txid: childTx.txid, vin: i }),
    );

    const childTxs = new Map([[0, childTx]]);
    const { findings, consolidatedCoinJoinOutputs } = analyzeForward(coinJoinTx, outspends, childTxs);

    expect(consolidatedCoinJoinOutputs.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.id === "chain-post-coinjoin-consolidation")).toBe(true);
  });

  describe("forward peel chain (2+ consecutive peel hops after this tx)", () => {
    const txid = "b".repeat(64);
    const tx = makeTx({
      txid,
      vin: [makeVin()],
      vout: [makeVout({ value: 90_000 }), makeVout({ value: 10_000 })],
    });
    // Hop 1: 1 in, 2 out, asymmetric; its larger output (80k, vout 0) is the change
    const child = makeTx({
      vin: [makeVin({ txid, vout: 0 })],
      vout: [makeVout({ value: 80_000 }), makeVout({ value: 9_000 })],
    });
    const outspends = [makeOutspend({ spent: true, txid: child.txid }), makeOutspend({ spent: false })];
    const hop2 = (vout: number) => makeTx({
      vin: [makeVin({ txid: child.txid, vout })],
      vout: [makeVout({ value: vout === 0 ? 70_000 : 7_000 }), makeVout({ value: 1_000 })],
    });
    const layers = (g: ReturnType<typeof makeTx>) => [
      { depth: 1, txs: new Map([[child.txid, child]]) },
      { depth: 2, txs: new Map([[g.txid, g]]) },
    ];

    it("flags a chain that keeps peeling the change", () => {
      const { findings, peelChainOutputs } = analyzeForward(tx, outspends, new Map([[0, child]]), layers(hop2(0)));
      expect(peelChainOutputs).toContain(0);
      expect(findings.some((f) => f.id === "chain-forward-peel")).toBe(true);
    });

    it("does not flag a single downstream 1-in-2-out payment", () => {
      const { findings } = analyzeForward(tx, outspends, new Map([[0, child]]));
      expect(findings.some((f) => f.id === "chain-forward-peel")).toBe(false);
    });

    it("does not flag when the next hop spends the payment, not the change", () => {
      const { findings } = analyzeForward(tx, outspends, new Map([[0, child]]), layers(hop2(1)));
      expect(findings.some((f) => f.id === "chain-forward-peel")).toBe(false);
    });

    const real = (name: string) => {
      const dir = join(__dirname, "../../heuristics/__tests__/fixtures/api-responses");
      const parent = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as MempoolTransaction;
      const fwd = JSON.parse(readFileSync(join(dir, "forward", `${name}.json`), "utf8")) as {
        outspends: MempoolOutspend[]; children: MempoolTransaction[]; grandchildren: MempoolTransaction[];
      };
      const byId = new Map(fwd.children.map((c) => [c.txid, c]));
      const childTxs = new Map<number, MempoolTransaction>();
      for (const [i, os] of fwd.outspends.entries()) {
        const c = os.txid ? byId.get(os.txid) : undefined;
        if (c) childTxs.set(i, c);
      }
      return analyzeForward(parent, fwd.outspends, childTxs, [
        { depth: 1, txs: byId },
        { depth: 2, txs: new Map(fwd.grandchildren.map((g) => [g.txid, g])) },
      ]).findings.some((f) => f.id === "chain-forward-peel");
    };

    it("sweep 8cbe3322: one 1-in-2-out child, whose change is then merged (no chain)", () => {
      expect(real("sweep-1in1out")).toBe(false);
    });

    it("batch aefda8a7: children with one peel-shaped hop each (no chain)", () => {
      expect(real("batch-payment")).toBe(false);
    });

    it("consolidation 40b88e16: output peeled by 3c32cc3c, whose change is peeled again by 3a87bb2f (real chain)", () => {
      expect(real("consolidation-5in1out")).toBe(true);
    });
  });

  it("returns empty for unspent outputs", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout(), makeVout()],
    });

    const outspends = [makeOutspend(), makeOutspend()];
    const { findings } = analyzeForward(tx, outspends, new Map());

    expect(findings).toHaveLength(0);
  });
});
