import { describe, it, expect, beforeEach } from "vitest";
import { analyzePeelChain } from "../peel-chain";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";
import type { TxContext } from "../types";

beforeEach(() => resetAddrCounter());

/** Helper: create a peel-shaped tx (1-in, 2-out) with specific txid and parent link. */
function makePeelTx(txid: string, parentTxid: string, parentVout = 0) {
  return makeTx({
    txid,
    vin: [makeVin({ txid: parentTxid, vout: parentVout })],
    vout: [makeVout({ value: 10_000 }), makeVout({ value: 88_000 })],
  });
}

describe("analyzePeelChain", () => {
  it("returns no findings for non-peel-shaped tx (multiple inputs)", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin()],
      vout: [makeVout(), makeVout()],
    });
    const { findings } = analyzePeelChain(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings for non-peel-shaped tx (single output)", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout({ value: 98_000 })],
    });
    const { findings } = analyzePeelChain(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings for coinbase tx", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout(), makeVout()],
    });
    const { findings } = analyzePeelChain(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings for peel-shaped tx without context", () => {
    const tx = makePeelTx("a".repeat(64), "b".repeat(64));
    const { findings } = analyzePeelChain(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when parent exists but is not peel-shaped", () => {
    const parentTxid = "b".repeat(64);
    const tx = makePeelTx("a".repeat(64), parentTxid);
    const parentTx = makeTx({
      txid: parentTxid,
      vin: [makeVin(), makeVin()], // 2 inputs - not peel shape
      vout: [makeVout(), makeVout()],
    });
    const ctx: TxContext = { parentTx };
    const { findings } = analyzePeelChain(tx, undefined, ctx);
    expect(findings).toHaveLength(0);
  });

  it("detects 2-hop peel chain (parent + current), severity high", () => {
    const grandparentTxid = "c".repeat(64);
    const parentTxid = "b".repeat(64);
    const currentTxid = "a".repeat(64);

    const parentTx = makePeelTx(parentTxid, grandparentTxid);
    const tx = makePeelTx(currentTxid, parentTxid);

    const ctx: TxContext = { parentTx };
    const { findings } = analyzePeelChain(tx, undefined, ctx);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.id).toBe("peel-chain");
    expect(f.severity).toBe("high");
    expect(f.confidence).toBe("medium");
    expect(f.scoreImpact).toBe(-15);
    expect(f.params?.chainDepth).toBe(2);
    expect(f.params?.backwardHops).toBe(1);
    expect(f.params?.forwardHops).toBe(0);
  });

  it("detects 2-hop peel chain (current + child), severity high", () => {
    const parentTxid = "b".repeat(64);
    const currentTxid = "a".repeat(64);
    const childTxid = "d".repeat(64);

    const tx = makePeelTx(currentTxid, parentTxid);
    const childTx = makePeelTx(childTxid, currentTxid);

    const ctx: TxContext = { childTx };
    const { findings } = analyzePeelChain(tx, undefined, ctx);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.id).toBe("peel-chain");
    expect(f.severity).toBe("high");
    expect(f.scoreImpact).toBe(-15);
    expect(f.params?.forwardHops).toBe(1);
  });

  it("detects 3-hop peel chain (parent + current + child), severity critical", () => {
    const grandparentTxid = "c".repeat(64);
    const parentTxid = "b".repeat(64);
    const currentTxid = "a".repeat(64);
    const childTxid = "d".repeat(64);

    const parentTx = makePeelTx(parentTxid, grandparentTxid);
    const tx = makePeelTx(currentTxid, parentTxid);
    const childTx = makePeelTx(childTxid, currentTxid);

    const ctx: TxContext = { parentTx, childTx };
    const { findings } = analyzePeelChain(tx, undefined, ctx);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.id).toBe("peel-chain");
    expect(f.severity).toBe("critical");
    expect(f.confidence).toBe("high");
    expect(f.scoreImpact).toBe(-20);
    expect(f.params?.chainDepth).toBe(3);
  });

  it("ignores parent tx with wrong txid (not actually linked)", () => {
    const parentTxid = "b".repeat(64);
    const currentTxid = "a".repeat(64);
    const unrelatedTxid = "e".repeat(64);

    const tx = makePeelTx(currentTxid, parentTxid);
    // Parent tx has a different txid than what our input references
    const parentTx = makePeelTx(unrelatedTxid, "f".repeat(64));

    const ctx: TxContext = { parentTx };
    const { findings } = analyzePeelChain(tx, undefined, ctx);
    expect(findings).toHaveLength(0);
  });

  it("ignores child tx that does not reference our txid", () => {
    const parentTxid = "b".repeat(64);
    const currentTxid = "a".repeat(64);

    const tx = makePeelTx(currentTxid, parentTxid);
    // Child references a different parent
    const childTx = makePeelTx("d".repeat(64), "e".repeat(64));

    const ctx: TxContext = { childTx };
    const { findings } = analyzePeelChain(tx, undefined, ctx);
    expect(findings).toHaveLength(0);
  });

  it("ignores OP_RETURN outputs when checking peel shape", () => {
    const parentTxid = "b".repeat(64);
    const tx = makeTx({
      txid: "a".repeat(64),
      vin: [makeVin({ txid: parentTxid })],
      vout: [
        makeVout({ value: 10_000 }),
        makeVout({ value: 88_000 }),
        // OP_RETURN does not count as spendable
        {
          scriptpubkey: "6adeadbeef",
          scriptpubkey_asm: "OP_RETURN OP_PUSHBYTES_4 deadbeef",
          scriptpubkey_type: "op_return",
          value: 0,
        },
      ],
    });
    // Still peel-shaped (2 spendable outputs)
    const parentTx = makePeelTx(parentTxid, "c".repeat(64));
    const ctx: TxContext = { parentTx };
    const { findings } = analyzePeelChain(tx, undefined, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("peel-chain");
  });
});
