import { describe, it, expect, beforeEach } from "vitest";
import { analyzeUnnecessaryInput } from "../unnecessary-input";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

function addr(i: number) {
  return `bc1q${String(i).padStart(38, "0")}`;
}

function vin(value: number, i: number) {
  return makeVin({
    prevout: {
      scriptpubkey: "", scriptpubkey_asm: "",
      scriptpubkey_type: "v0_p2wpkh",
      scriptpubkey_address: addr(i),
      value,
    },
  });
}

describe("analyzeUnnecessaryInput", () => {
  it("flags 1 excess input as low severity", () => {
    // 2 inputs: 200k + 50k = 250k. Outputs: 120k + 128.5k. Fee: 1500.
    // Both outputs coverable by the 200k input alone (max needed: 130k).
    // minInputsNeeded = 1 under both interpretations. Excess = 1.
    const tx = makeTx({
      vin: [vin(200_000, 0), vin(50_000, 1)],
      vout: [makeVout({ value: 120_000 }), makeVout({ value: 128_500 })],
      fee: 1500,
    });
    const { findings } = analyzeUnnecessaryInput(tx);
    const f = findings.find((f) => f.id === "unnecessary-input");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("low");
    expect(f!.scoreImpact).toBe(-2);
    expect(f!.params?.excessInputs).toBe(1);
    expect(f!.params?.minInputsNeeded).toBe(1);
  });

  it("flags 3 excess inputs as medium severity", () => {
    // 4 inputs: 500k + 100k*3 = 800k. Outputs: 350k + 448.5k. Fee: 1500.
    // Both outputs coverable by the 500k input (max needed: 450k).
    // minInputsNeeded = 1 under both interpretations. Excess = 3.
    const tx = makeTx({
      vin: [vin(500_000, 0), vin(100_000, 1), vin(100_000, 2), vin(100_000, 3)],
      vout: [makeVout({ value: 350_000 }), makeVout({ value: 448_500 })],
      fee: 1500,
    });
    const { findings } = analyzeUnnecessaryInput(tx);
    const f = findings.find((f) => f.id === "unnecessary-input");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
    expect(f!.params?.excessInputs).toBe(3);
  });

  it("flags 6 excess inputs as high severity with capped impact", () => {
    // 7 inputs: 1M + 100k*6 = 1.6M. Outputs: 800k + 798.5k. Fee: 1500.
    // Both outputs coverable by the 1M input (max needed: 801.5k <= 1M).
    // minInputsNeeded = 1 under both interpretations. Excess = 6.
    const tx = makeTx({
      vin: [
        vin(1_000_000, 0),
        ...Array.from({ length: 6 }, (_, i) => vin(100_000, i + 1)),
      ],
      vout: [makeVout({ value: 800_000 }), makeVout({ value: 798_500 })],
      fee: 1500,
    });
    const { findings } = analyzeUnnecessaryInput(tx);
    const f = findings.find((f) => f.id === "unnecessary-input");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("high");
    expect(f!.scoreImpact).toBe(-8); // capped at -8
    expect(f!.params?.excessInputs).toBe(6);
  });

  it("does NOT flag when all inputs are needed (under either interpretation)", () => {
    // 2 inputs: 50k + 60k = 110k. Outputs: 100k + 8.5k. Fee: 1500.
    // If 100k is payment: need >= 101.5k -> both inputs (110k). min = 2, excess = 0.
    // If 8.5k is payment: need >= 10k -> one input (60k). min = 1, excess = 1.
    // Conservative (max): minInputsNeeded = 2. Excess = 0.
    const tx = makeTx({
      vin: [vin(50_000, 0), vin(60_000, 1)],
      vout: [makeVout({ value: 100_000 }), makeVout({ value: 8_500 })],
      fee: 1500,
    });
    const { findings } = analyzeUnnecessaryInput(tx);
    expect(findings.find((f) => f.id === "unnecessary-input")).toBeUndefined();
  });

  it("does NOT flag single-input transactions", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout(), makeVout()],
    });
    const { findings } = analyzeUnnecessaryInput(tx);
    expect(findings).toHaveLength(0);
  });

  it("skips coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout()],
    });
    const { findings } = analyzeUnnecessaryInput(tx);
    expect(findings).toHaveLength(0);
  });

  it("skips when prevout data is missing", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: null }), makeVin()],
      vout: [makeVout()],
    });
    const { findings } = analyzeUnnecessaryInput(tx);
    expect(findings).toHaveLength(0);
  });

  it("skips 1-output transactions (consolidations/sweeps)", () => {
    const tx = makeTx({
      vin: Array.from({ length: 4 }, (_, i) => vin(100_000, i)),
      vout: [makeVout({ value: 398_500 })],
      fee: 1500,
    });
    const { findings } = analyzeUnnecessaryInput(tx);
    expect(findings.find((f) => f.id === "unnecessary-input")).toBeUndefined();
  });

  it("skips 3+ output transactions (batched sends)", () => {
    const tx = makeTx({
      vin: Array.from({ length: 3 }, (_, i) => vin(100_000, i)),
      vout: [makeVout({ value: 50_000 }), makeVout({ value: 100_000 }), makeVout({ value: 148_500 })],
      fee: 1500,
    });
    const { findings } = analyzeUnnecessaryInput(tx);
    expect(findings.find((f) => f.id === "unnecessary-input")).toBeUndefined();
  });
});
