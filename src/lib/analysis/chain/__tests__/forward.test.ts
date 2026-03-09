import { describe, it, expect, beforeEach } from "vitest";
import { analyzeForward, getOutputAge } from "../forward";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";
import type { MempoolOutspend } from "@/lib/api/types";

beforeEach(() => resetAddrCounter());

function makeOutspend(overrides: Partial<MempoolOutspend> = {}): MempoolOutspend {
  return { spent: false, txid: undefined, vin: undefined, status: undefined, ...overrides };
}

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

describe("getOutputAge", () => {
  it("calculates block age for confirmed tx", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout()],
      status: { confirmed: true, block_height: 800_000, block_hash: "h", block_time: 0 },
    });

    expect(getOutputAge(tx, 800_100)).toBe(100);
  });

  it("returns null for unconfirmed tx", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout()],
      status: { confirmed: false },
    });

    expect(getOutputAge(tx, 800_100)).toBeNull();
  });
});
