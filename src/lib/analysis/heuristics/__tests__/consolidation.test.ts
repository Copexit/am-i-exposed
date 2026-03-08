import { describe, it, expect, beforeEach } from "vitest";
import { analyzeConsolidation } from "../consolidation";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeConsolidation", () => {
  // ── Fan-in (consolidation) ────────────────────────────────────────

  it("detects 3-input consolidation to 1 output as medium", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin(), makeVin()],
      vout: [makeVout({ value: 290_000 })],
    });
    const { findings } = analyzeConsolidation(tx);
    const f = findings.find((f) => f.id === "consolidation-fan-in");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
    expect(f!.scoreImpact).toBe(-3);
    expect(f!.params?.inputCount).toBe(3);
  });

  it("detects 7-input consolidation as high", () => {
    const vins = Array.from({ length: 7 }, () => makeVin());
    const tx = makeTx({
      vin: vins,
      vout: [makeVout({ value: 690_000 })],
    });
    const { findings } = analyzeConsolidation(tx);
    const f = findings.find((f) => f.id === "consolidation-fan-in");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("high");
    expect(f!.scoreImpact).toBe(-5);
  });

  it("detects 15-input consolidation as critical", () => {
    const vins = Array.from({ length: 15 }, () => makeVin());
    const tx = makeTx({
      vin: vins,
      vout: [makeVout({ value: 1_490_000 })],
    });
    const { findings } = analyzeConsolidation(tx);
    const f = findings.find((f) => f.id === "consolidation-fan-in");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("critical");
    expect(f!.scoreImpact).toBe(-8);
  });

  it("does NOT flag 2-input-1-output as consolidation", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin()],
      vout: [makeVout({ value: 190_000 })],
    });
    const { findings } = analyzeConsolidation(tx);
    expect(findings.find((f) => f.id === "consolidation-fan-in")).toBeUndefined();
  });

  it("does NOT flag consolidation for 3-input-2-output tx", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin(), makeVin()],
      vout: [makeVout(), makeVout()],
    });
    const { findings } = analyzeConsolidation(tx);
    expect(findings.find((f) => f.id === "consolidation-fan-in")).toBeUndefined();
  });

  // ── Cross-type consolidation ──────────────────────────────────────

  it("flags cross-type consolidation when inputs have mixed script types", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q" + "a".repeat(38), value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "p2pkh", scriptpubkey_address: "1" + "B".repeat(33), value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q" + "c".repeat(38), value: 50_000 } }),
      ],
      vout: [makeVout({ value: 148_000 })],
    });
    const { findings } = analyzeConsolidation(tx);
    const crossType = findings.find((f) => f.id === "consolidation-cross-type");
    expect(crossType).toBeDefined();
    expect(crossType!.severity).toBe("high");
    expect(crossType!.scoreImpact).toBe(-5);
    expect(crossType!.params?.typeCount).toBe(2);
  });

  it("does NOT flag cross-type when all inputs share script type", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin(), makeVin()], // all default v0_p2wpkh
      vout: [makeVout({ value: 290_000 })],
    });
    const { findings } = analyzeConsolidation(tx);
    expect(findings.find((f) => f.id === "consolidation-cross-type")).toBeUndefined();
  });

  // ── Fan-out (batching) ────────────────────────────────────────────

  it("detects 1-input-5-output batch as low severity", () => {
    const outputs = Array.from({ length: 5 }, (_, i) => makeVout({ value: 10_000 + i }));
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q" + "a".repeat(38), value: 100_000 } })],
      vout: outputs,
    });
    const { findings } = analyzeConsolidation(tx);
    const f = findings.find((f) => f.id === "consolidation-fan-out");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("low");
    expect(f!.scoreImpact).toBe(-3);
    expect(f!.params?.outputCount).toBe(5);
  });

  it("does NOT flag 1-input-4-output as batching", () => {
    const outputs = Array.from({ length: 4 }, () => makeVout());
    const tx = makeTx({
      vin: [makeVin()],
      vout: outputs,
    });
    const { findings } = analyzeConsolidation(tx);
    expect(findings.find((f) => f.id === "consolidation-fan-out")).toBeUndefined();
  });

  it("does NOT flag 2-input-5-output as batching", () => {
    const outputs = Array.from({ length: 5 }, () => makeVout());
    const tx = makeTx({
      vin: [makeVin(), makeVin()],
      vout: outputs,
    });
    const { findings } = analyzeConsolidation(tx);
    expect(findings.find((f) => f.id === "consolidation-fan-out")).toBeUndefined();
  });

  // ── I/O ratio anomaly ──────────────────────────────────────────────

  it("flags 5-input-2-output as I/O ratio anomaly (medium)", () => {
    const tx = makeTx({
      vin: Array.from({ length: 5 }, () => makeVin()),
      vout: [makeVout(), makeVout()],
    });
    const { findings } = analyzeConsolidation(tx);
    const f = findings.find((f) => f.id === "consolidation-ratio-anomaly");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
    expect(f!.scoreImpact).toBe(-3);
    expect(f!.params?.ratio).toBe(2.5);
  });

  it("flags 12-input-2-output as I/O ratio anomaly (high)", () => {
    const tx = makeTx({
      vin: Array.from({ length: 12 }, () => makeVin()),
      vout: [makeVout(), makeVout()],
    });
    const { findings } = analyzeConsolidation(tx);
    const f = findings.find((f) => f.id === "consolidation-ratio-anomaly");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("high");
    expect(f!.scoreImpact).toBe(-5);
  });

  it("does NOT flag 4-input-2-output (normal payment)", () => {
    const tx = makeTx({
      vin: Array.from({ length: 4 }, () => makeVin()),
      vout: [makeVout(), makeVout()],
    });
    const { findings } = analyzeConsolidation(tx);
    expect(findings.find((f) => f.id === "consolidation-ratio-anomaly")).toBeUndefined();
  });

  it("does NOT flag 5-input-3-output (not payment shape)", () => {
    const tx = makeTx({
      vin: Array.from({ length: 5 }, () => makeVin()),
      vout: [makeVout(), makeVout(), makeVout()],
    });
    const { findings } = analyzeConsolidation(tx);
    expect(findings.find((f) => f.id === "consolidation-ratio-anomaly")).toBeUndefined();
  });

  // ── Edge cases ────────────────────────────────────────────────────

  it("skips coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout()],
    });
    const { findings } = analyzeConsolidation(tx);
    expect(findings).toHaveLength(0);
  });

  it("ignores OP_RETURN outputs when counting spendable outputs", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin(), makeVin()],
      vout: [
        makeVout({ value: 290_000 }),
        { scriptpubkey: "6adeadbeef", scriptpubkey_asm: "OP_RETURN", scriptpubkey_type: "op_return", value: 0 },
      ],
    });
    const { findings } = analyzeConsolidation(tx);
    // 3 inputs, 1 spendable output (OP_RETURN ignored) = consolidation
    expect(findings.find((f) => f.id === "consolidation-fan-in")).toBeDefined();
  });
});
