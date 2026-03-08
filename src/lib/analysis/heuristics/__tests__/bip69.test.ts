import { describe, it, expect, beforeEach } from "vitest";
import { analyzeBip69 } from "../bip69";
import { makeTx, makeVin, makeVout, makeCoinbaseVin, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeBip69", () => {
  it("detects BIP69 ordering when inputs sorted by txid and outputs by value", () => {
    const tx = makeTx({
      vin: [
        makeVin({ txid: "a".repeat(64), vout: 0 }),
        makeVin({ txid: "b".repeat(64), vout: 0 }),
        makeVin({ txid: "c".repeat(64), vout: 0 }),
      ],
      vout: [
        makeVout({ value: 10_000, scriptpubkey: "0014" + "a".repeat(40) }),
        makeVout({ value: 20_000, scriptpubkey: "0014" + "b".repeat(40) }),
        makeVout({ value: 50_000, scriptpubkey: "0014" + "c".repeat(40) }),
      ],
    });
    const { findings } = analyzeBip69(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("bip69-detected");
    expect(findings[0].scoreImpact).toBe(-2);
  });

  it("does not fire when inputs are not sorted", () => {
    const tx = makeTx({
      vin: [
        makeVin({ txid: "c".repeat(64), vout: 0 }),
        makeVin({ txid: "a".repeat(64), vout: 0 }),
      ],
      vout: [
        makeVout({ value: 10_000, scriptpubkey: "0014" + "a".repeat(40) }),
        makeVout({ value: 20_000, scriptpubkey: "0014" + "b".repeat(40) }),
      ],
    });
    const { findings } = analyzeBip69(tx);
    expect(findings).toHaveLength(0);
  });

  it("does not fire when outputs are not sorted by value", () => {
    const tx = makeTx({
      vin: [
        makeVin({ txid: "a".repeat(64), vout: 0 }),
        makeVin({ txid: "b".repeat(64), vout: 0 }),
      ],
      vout: [
        makeVout({ value: 50_000, scriptpubkey: "0014" + "a".repeat(40) }),
        makeVout({ value: 10_000, scriptpubkey: "0014" + "b".repeat(40) }),
      ],
    });
    const { findings } = analyzeBip69(tx);
    expect(findings).toHaveLength(0);
  });

  it("requires at least 2 inputs AND 2 outputs for detection", () => {
    // 1 input, 2 outputs: not enough
    const tx1 = makeTx({
      vin: [makeVin({ txid: "a".repeat(64) })],
      vout: [
        makeVout({ value: 10_000, scriptpubkey: "0014" + "a".repeat(40) }),
        makeVout({ value: 20_000, scriptpubkey: "0014" + "b".repeat(40) }),
      ],
    });
    const { findings: f1 } = analyzeBip69(tx1);
    expect(f1).toHaveLength(0);
  });

  it("ignores coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [
        makeVout({ value: 10_000, scriptpubkey: "0014" + "a".repeat(40) }),
        makeVout({ value: 20_000, scriptpubkey: "0014" + "b".repeat(40) }),
      ],
    });
    const { findings } = analyzeBip69(tx);
    expect(findings).toHaveLength(0);
  });

  it("handles equal values by checking scriptpubkey lexicographic order", () => {
    const tx = makeTx({
      vin: [
        makeVin({ txid: "a".repeat(64), vout: 0 }),
        makeVin({ txid: "b".repeat(64), vout: 0 }),
      ],
      vout: [
        makeVout({ value: 50_000, scriptpubkey: "0014" + "a".repeat(40) }),
        makeVout({ value: 50_000, scriptpubkey: "0014" + "b".repeat(40) }),
      ],
    });
    const { findings } = analyzeBip69(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("bip69-detected");
  });

  it("detects non-BIP69 when equal values have wrong scriptpubkey order", () => {
    const tx = makeTx({
      vin: [
        makeVin({ txid: "a".repeat(64), vout: 0 }),
        makeVin({ txid: "b".repeat(64), vout: 0 }),
      ],
      vout: [
        makeVout({ value: 50_000, scriptpubkey: "0014" + "f".repeat(40) }),
        makeVout({ value: 50_000, scriptpubkey: "0014" + "a".repeat(40) }),
      ],
    });
    const { findings } = analyzeBip69(tx);
    expect(findings).toHaveLength(0);
  });

  it("handles same txid sorted by vout", () => {
    const tx = makeTx({
      vin: [
        makeVin({ txid: "a".repeat(64), vout: 0 }),
        makeVin({ txid: "a".repeat(64), vout: 1 }),
      ],
      vout: [
        makeVout({ value: 10_000, scriptpubkey: "0014" + "a".repeat(40) }),
        makeVout({ value: 20_000, scriptpubkey: "0014" + "b".repeat(40) }),
      ],
    });
    const { findings } = analyzeBip69(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("bip69-detected");
  });
});
