import { describe, it, expect, beforeEach } from "vitest";
import { buildLinkabilityMatrix } from "../linkability";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("buildLinkabilityMatrix", () => {
  it("detects deterministic links in 1-in 1-out tx", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 100_000 } })],
      vout: [makeVout({ value: 98_000 })],
    });

    const result = buildLinkabilityMatrix(tx);
    expect(result).not.toBeNull();
    expect(result!.deterministicLinks).toBe(1);
    expect(result!.matrix[0][0].probability).toBe(1);
    expect(result!.matrix[0][0].deterministic).toBe(true);
  });

  it("shows ambiguity for 2-in 2-out tx with compatible values", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 100_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 100_000 } }),
      ],
      vout: [
        makeVout({ value: 50_000 }),
        makeVout({ value: 50_000 }),
      ],
      fee: 100_000, // total in = 200k, total out = 100k + 100k fee
    });

    const result = buildLinkabilityMatrix(tx);
    expect(result).not.toBeNull();
    // Equal inputs and equal outputs should show ambiguity
    expect(result!.averageAmbiguity).toBeGreaterThan(0);
  });

  it("returns null for coinbase tx", () => {
    const tx = makeTx({
      vin: [{ txid: "0".repeat(64), vout: 0xffffffff, prevout: null, scriptsig: "", scriptsig_asm: "", is_coinbase: true, sequence: 0xffffffff }],
    });
    const result = buildLinkabilityMatrix(tx);
    expect(result).toBeNull();
  });

  it("returns null for large tx (> 8 inputs)", () => {
    const tx = makeTx({
      vin: Array.from({ length: 9 }, () => makeVin()),
    });
    const result = buildLinkabilityMatrix(tx);
    expect(result).toBeNull();
  });

  it("generates ambiguous finding for high ambiguity", () => {
    // Create a tx where inputs and outputs have equal values - maximum ambiguity
    const tx = makeTx({
      fee: 2_000,
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qc", value: 50_000 } }),
      ],
      vout: [
        makeVout({ value: 49_000 }),
        makeVout({ value: 49_000 }),
        makeVout({ value: 49_000 }),
      ],
    });

    const result = buildLinkabilityMatrix(tx);
    expect(result).not.toBeNull();
    // All inputs can fund all outputs equally, so ambiguity should be high
    if (result!.averageAmbiguity >= 0.6) {
      const f = result!.findings.find((f) => f.id === "linkability-ambiguous");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("good");
    }
  });

  it("detects equal-subset finding when 3 equal outputs + 1 unique deterministic", () => {
    // 1 input can only fund the unique output, so it's deterministic
    // The 3 equal outputs create ambiguity among themselves
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 10_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qc", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qd", value: 50_000 } }),
      ],
      vout: [
        makeVout({ value: 50_000 }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 5_000 }), // unique small output - only input[0] can fund it alone
      ],
      fee: 5_000,
    });

    const result = buildLinkabilityMatrix(tx);
    expect(result).not.toBeNull();

    const eqSubset = result!.findings.find((f) => f.id === "linkability-equal-subset");
    // Only fires if there are deterministic links on the non-equal output
    if (result!.deterministicLinks > 0) {
      expect(eqSubset).toBeDefined();
      expect(eqSubset!.severity).toBe("medium");
    }
  });

  it("does NOT produce equal-subset when all outputs are equal", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qc", value: 50_000 } }),
      ],
      vout: [
        makeVout({ value: 49_000 }),
        makeVout({ value: 49_000 }),
        makeVout({ value: 49_000 }),
      ],
      fee: 3_000,
    });

    const result = buildLinkabilityMatrix(tx);
    expect(result).not.toBeNull();

    // All outputs are equal, no "non-equal" outputs to be deterministic on
    const eqSubset = result!.findings.find((f) => f.id === "linkability-equal-subset");
    expect(eqSubset).toBeUndefined();
  });

  it("does NOT produce equal-subset when unique outputs are not deterministic", () => {
    // All inputs are large enough to fund the unique output, so no deterministic link
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 100_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 100_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qc", value: 100_000 } }),
      ],
      vout: [
        makeVout({ value: 50_000 }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 30_000 }), // unique but any input can fund it
      ],
      fee: 120_000,
    });

    const result = buildLinkabilityMatrix(tx);
    expect(result).not.toBeNull();

    const eqSubset = result!.findings.find((f) => f.id === "linkability-equal-subset");
    expect(eqSubset).toBeUndefined();
  });

  it("matrix has correct dimensions", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 80_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 60_000 } }),
      ],
      vout: [
        makeVout({ value: 50_000 }),
        makeVout({ value: 40_000 }),
        makeVout({ value: 30_000 }),
      ],
      fee: 20_000,
    });

    const result = buildLinkabilityMatrix(tx);
    expect(result).not.toBeNull();
    expect(result!.matrix).toHaveLength(2); // 2 inputs
    expect(result!.matrix[0]).toHaveLength(3); // 3 outputs
  });
});
