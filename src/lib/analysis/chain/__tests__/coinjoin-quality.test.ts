import { describe, it, expect, beforeEach } from "vitest";
import { evaluateCoinJoinQuality } from "../coinjoin-quality";
import { makeTx, makeVin, makeVout, makeOutspend, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";

beforeEach(() => resetAddrCounter());

describe("evaluateCoinJoinQuality", () => {
  it("returns empty result when no CoinJoin inputs", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout()],
    });

    const result = evaluateCoinJoinQuality(tx, [], null, new Map(), new Map());

    expect(result.findings).toHaveLength(0);
    expect(result.qualityScore).toBe(0);
  });

  it("rewards single CoinJoin UTXO spend with good timing", () => {
    const cjTxid = "c".repeat(64);
    const tx = makeTx({
      vin: [makeVin({ txid: cjTxid, vout: 0 })],
      vout: [makeVout({ value: 95000 })],
      status: { confirmed: true, block_height: 800_010, block_hash: "h", block_time: 0 },
    });

    const parentTx = makeTx({
      txid: cjTxid,
      status: { confirmed: true, block_height: 800_000, block_hash: "h", block_time: 0 },
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, parentTx]]);

    const result = evaluateCoinJoinQuality(
      tx,
      [0],
      null,
      new Map(),
      parentTxs,
    );

    expect(result.qualityScore).toBeGreaterThan(0);
    expect(result.goodBehaviors.length).toBeGreaterThan(0);
    expect(result.badBehaviors).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("good");
    expect(result.findings[0].scoreImpact).toBeGreaterThanOrEqual(15);
  });

  it("penalizes consolidation of CoinJoin outputs from same parent", () => {
    const cjTxid = "c".repeat(64);
    const tx = makeTx({
      vin: [
        makeVin({ txid: cjTxid, vout: 0 }),
        makeVin({ txid: cjTxid, vout: 1 }),
      ],
      vout: [makeVout()],
      status: { confirmed: true, block_height: 800_010, block_hash: "h", block_time: 0 },
    });

    const parentTx = makeTx({
      txid: cjTxid,
      status: { confirmed: true, block_height: 800_000, block_hash: "h", block_time: 0 },
    });

    const parentTxs = new Map<number, MempoolTransaction>([
      [0, parentTx],
      [1, parentTx],
    ]);

    const result = evaluateCoinJoinQuality(
      tx,
      [0, 1],
      null,
      new Map(),
      parentTxs,
    );

    expect(result.qualityScore).toBeLessThan(0);
    expect(result.badBehaviors.length).toBeGreaterThan(0);
    expect(result.findings[0].severity).toBe("high");
  });

  it("penalizes mixing CoinJoin with non-CoinJoin inputs", () => {
    const cjTxid = "c".repeat(64);
    const otherTxid = "d".repeat(64);
    const tx = makeTx({
      vin: [
        makeVin({ txid: cjTxid, vout: 0 }),
        makeVin({ txid: otherTxid, vout: 0 }),
      ],
      vout: [makeVout()],
      status: { confirmed: true, block_height: 800_010, block_hash: "h", block_time: 0 },
    });

    const parentTx = makeTx({
      txid: cjTxid,
      status: { confirmed: true, block_height: 800_000, block_hash: "h", block_time: 0 },
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, parentTx]]);

    const result = evaluateCoinJoinQuality(
      tx,
      [0], // only index 0 is from CoinJoin
      null,
      new Map(),
      parentTxs,
    );

    expect(result.badBehaviors.some((b) => b.includes("mixed with non-CoinJoin"))).toBe(true);
  });

  it("penalizes immediate spending after CoinJoin (< 6 blocks)", () => {
    const cjTxid = "c".repeat(64);
    const tx = makeTx({
      vin: [makeVin({ txid: cjTxid, vout: 0 })],
      vout: [makeVout()],
      status: { confirmed: true, block_height: 800_002, block_hash: "h", block_time: 0 },
    });

    const parentTx = makeTx({
      txid: cjTxid,
      status: { confirmed: true, block_height: 800_000, block_hash: "h", block_time: 0 },
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, parentTx]]);

    const result = evaluateCoinJoinQuality(
      tx,
      [0],
      null,
      new Map(),
      parentTxs,
    );

    expect(result.badBehaviors.some((b) => b.includes("blocks since CoinJoin"))).toBe(true);
  });

  it("detects toxic merge in forward spending", () => {
    const txid = "a".repeat(64);
    const otherTxid = "d".repeat(64);

    const tx = makeTx({
      txid,
      vin: [makeVin({ txid: "c".repeat(64), vout: 0 })],
      vout: [makeVout(), makeVout()],
      status: { confirmed: true, block_height: 800_010, block_hash: "h", block_time: 0 },
    });

    // Child tx merges this tx's output with another input
    const childTx = makeTx({
      vin: [
        makeVin({ txid, vout: 0 }),
        makeVin({ txid: otherTxid, vout: 0 }),
      ],
      vout: [makeVout()],
    });

    const outspends: MempoolOutspend[] = [
      makeOutspend({ spent: true, txid: childTx.txid }),
      makeOutspend(),
    ];

    const parentTx = makeTx({
      txid: "c".repeat(64),
      status: { confirmed: true, block_height: 800_000, block_hash: "h", block_time: 0 },
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, parentTx]]);
    const childTxs = new Map<number, MempoolTransaction>([[0, childTx]]);

    const result = evaluateCoinJoinQuality(
      tx,
      [0],
      outspends,
      childTxs,
      parentTxs,
    );

    expect(result.badBehaviors.some((b) => b.includes("spent alongside inputs from other transactions"))).toBe(true);
  });
});
