import { describe, it, expect, beforeEach } from "vitest";
import { analyzeFees } from "../fee-analysis";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";
import type { TxContext } from "../types";

beforeEach(() => resetAddrCounter());

/** Helper to build a parent tx with given fee, weight, outputs, and optional RBF. */
function makeParentTx(opts: {
  fee: number;
  weight: number;
  outputs: number[];
  rbf?: boolean;
  blockHeight?: number;
}) {
  return makeTx({
    txid: "p".repeat(64),
    fee: opts.fee,
    weight: opts.weight,
    vin: [makeVin({ sequence: opts.rbf ? 0xfffffffd : 0xfffffffe })],
    vout: opts.outputs.map((v) => makeVout({ value: v })),
    status: { confirmed: true, block_height: opts.blockHeight ?? 800000, block_time: 1700000000 },
  });
}

describe("CPFP detection (h6-cpfp-detected)", () => {
  it("detects CPFP: same block, 3x fee rate, spends non-largest output", () => {
    // Parent: weight=400 -> vsize=100, fee=200 -> 2 sat/vB
    // Child: weight=400 -> vsize=100, fee=800 -> 8 sat/vB (4x parent)
    const parentTx = makeParentTx({
      fee: 200,
      weight: 400,
      outputs: [500_000, 100_000], // output 0 is largest (payment), output 1 is change
    });

    const childTx = makeTx({
      weight: 400,
      fee: 800,
      vin: [makeVin({ txid: parentTx.txid, vout: 1, sequence: 0xfffffffe })], // spends output 1 (change)
      status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
    });

    const ctx: TxContext = { parentTx };
    const { findings } = analyzeFees(childTx, undefined, ctx);
    const f = findings.find((f) => f.id === "h6-cpfp-detected");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(0);
    expect(f!.severity).toBe("low");
    expect(f!.params?.spentOutputIndex).toBe(1);
    expect(f!.params?.parentHadRbf).toBe(0);
  });

  it("does not fire for multi-input child", () => {
    const parentTx = makeParentTx({
      fee: 200,
      weight: 400,
      outputs: [500_000, 100_000],
    });

    const childTx = makeTx({
      weight: 400,
      fee: 800,
      vin: [
        makeVin({ txid: parentTx.txid, vout: 1 }),
        makeVin(), // second input
      ],
      status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
    });

    const ctx: TxContext = { parentTx };
    const { findings } = analyzeFees(childTx, undefined, ctx);
    expect(findings.find((f) => f.id === "h6-cpfp-detected")).toBeUndefined();
  });

  it("does not fire when no parentTx in context", () => {
    const childTx = makeTx({
      weight: 400,
      fee: 800,
      vin: [makeVin({ vout: 1 })],
      status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
    });

    const { findings } = analyzeFees(childTx, undefined, {});
    expect(findings.find((f) => f.id === "h6-cpfp-detected")).toBeUndefined();
  });

  it("does not fire when blocks differ by > 1", () => {
    const parentTx = makeParentTx({
      fee: 200,
      weight: 400,
      outputs: [500_000, 100_000],
      blockHeight: 800000,
    });

    const childTx = makeTx({
      weight: 400,
      fee: 800,
      vin: [makeVin({ txid: parentTx.txid, vout: 1 })],
      status: { confirmed: true, block_height: 800002, block_time: 1700001200 },
    });

    const ctx: TxContext = { parentTx };
    const { findings } = analyzeFees(childTx, undefined, ctx);
    expect(findings.find((f) => f.id === "h6-cpfp-detected")).toBeUndefined();
  });

  it("does not fire when child fee rate < 2x parent", () => {
    // Parent: 2 sat/vB, Child: 3 sat/vB (1.5x, below threshold)
    const parentTx = makeParentTx({
      fee: 200,
      weight: 400,
      outputs: [500_000, 100_000],
    });

    const childTx = makeTx({
      weight: 400,
      fee: 300,
      vin: [makeVin({ txid: parentTx.txid, vout: 1 })],
      status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
    });

    const ctx: TxContext = { parentTx };
    const { findings } = analyzeFees(childTx, undefined, ctx);
    expect(findings.find((f) => f.id === "h6-cpfp-detected")).toBeUndefined();
  });

  it("does not fire when spending largest output (payment, not change)", () => {
    const parentTx = makeParentTx({
      fee: 200,
      weight: 400,
      outputs: [500_000, 100_000], // output 0 is largest
    });

    const childTx = makeTx({
      weight: 400,
      fee: 800,
      vin: [makeVin({ txid: parentTx.txid, vout: 0 })], // spends output 0 (largest = payment)
      status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
    });

    const ctx: TxContext = { parentTx };
    const { findings } = analyzeFees(childTx, undefined, ctx);
    expect(findings.find((f) => f.id === "h6-cpfp-detected")).toBeUndefined();
  });

  it("notes parent RBF signal in params", () => {
    const parentTx = makeParentTx({
      fee: 200,
      weight: 400,
      outputs: [500_000, 100_000],
      rbf: true,
    });

    const childTx = makeTx({
      weight: 400,
      fee: 800,
      vin: [makeVin({ txid: parentTx.txid, vout: 1 })],
      status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
    });

    const ctx: TxContext = { parentTx };
    const { findings } = analyzeFees(childTx, undefined, ctx);
    const f = findings.find((f) => f.id === "h6-cpfp-detected");
    expect(f).toBeDefined();
    expect(f!.params?.parentHadRbf).toBe(1);
    expect(f!.description).toContain("RBF signaled but CPFP was used instead");
  });

  it("works for adjacent blocks (child = parent + 1)", () => {
    const parentTx = makeParentTx({
      fee: 200,
      weight: 400,
      outputs: [500_000, 100_000],
      blockHeight: 800000,
    });

    const childTx = makeTx({
      weight: 400,
      fee: 800,
      vin: [makeVin({ txid: parentTx.txid, vout: 1 })],
      status: { confirmed: true, block_height: 800001, block_time: 1700000600 },
    });

    const ctx: TxContext = { parentTx };
    const { findings } = analyzeFees(childTx, undefined, ctx);
    const f = findings.find((f) => f.id === "h6-cpfp-detected");
    expect(f).toBeDefined();
    expect(f!.params?.parentTxid).toBe("p".repeat(64));
  });
});
