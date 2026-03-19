import { describe, it, expect, beforeEach } from "vitest";
import { analyzeForward } from "../forward";
import { makeTx, makeVin, makeVout, makeOutspend, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";

beforeEach(() => resetAddrCounter());

describe("analyzeForward", () => {
  it("detects post-CoinJoin consolidation", () => {
    const txid = "a".repeat(64);
    const denom = WHIRLPOOL_DENOMS[0];

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
    const denom = WHIRLPOOL_DENOMS[0];

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
    const denom = WHIRLPOOL_DENOMS[0];

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
    const denom = WHIRLPOOL_DENOMS[0];

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
    const denom = WHIRLPOOL_DENOMS[0];

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

  it("detects forward peel chain", () => {
    const txid = "b".repeat(64);
    const tx = makeTx({
      txid,
      vin: [makeVin()],
      vout: [makeVout({ value: 90_000 }), makeVout({ value: 10_000 })],
    });

    // Child tx continues the peel: 1 in, 2 out, asymmetric
    const childTx = makeTx({
      vin: [makeVin({ txid, vout: 0 })],
      vout: [makeVout({ value: 80_000 }), makeVout({ value: 9_000 })],
    });

    const outspends = [
      makeOutspend({ spent: true, txid: childTx.txid }),
      makeOutspend({ spent: false }),
    ];

    const childTxs = new Map([[0, childTx]]);
    const { findings, peelChainOutputs } = analyzeForward(tx, outspends, childTxs);

    expect(peelChainOutputs).toContain(0);
    expect(findings.some((f) => f.id === "chain-forward-peel")).toBe(true);
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
