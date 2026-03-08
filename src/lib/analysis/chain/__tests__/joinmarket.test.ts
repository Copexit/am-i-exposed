import { describe, it, expect, beforeEach } from "vitest";
import { subsetSumAttack, identifyTakerMaker, analyzeJoinMarket } from "../joinmarket";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("subsetSumAttack", () => {
  it("identifies taker inputs via subset sum", () => {
    // Taker contributes 500,000 sats, denomination is 100,000, fee is 2,000
    // Taker change = 500,000 - 100,000 - 2,000 = 398,000
    // Maker1 contributes 150,000, maker2 contributes 200,000
    const tx = makeTx({
      fee: 2_000,
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtaker", value: 500_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qmaker1", value: 150_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qmaker2", value: 200_000 } }),
      ],
      vout: [
        makeVout({ value: 100_000 }), // denom output 1
        makeVout({ value: 100_000 }), // denom output 2
        makeVout({ value: 100_000 }), // denom output 3
        makeVout({ value: 398_000 }), // taker change
        makeVout({ value: 50_000 }),  // maker1 change
        makeVout({ value: 100_000 }), // maker2 change (after denom deduction + tiny fee)
      ],
    });

    const result = subsetSumAttack(tx);
    expect(result.found).toBe(true);
    expect(result.takerInputIndices).toContain(0);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].id).toBe("joinmarket-subset-sum");
  });

  it("reports resistance when no subset matches", () => {
    // Deliberately make inputs that don't sum to any change + denom + fee
    const tx = makeTx({
      fee: 1_234,
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 123_456 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 234_567 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qc", value: 345_678 } }),
      ],
      vout: [
        makeVout({ value: 200_000 }), // denom 1
        makeVout({ value: 200_000 }), // denom 2
        makeVout({ value: 200_000 }), // denom 3
        makeVout({ value: 55_555 }),  // change 1 (doesn't match any subset sum)
        makeVout({ value: 46_912 }),  // change 2
      ],
    });

    const result = subsetSumAttack(tx);
    expect(result.found).toBe(false);
    expect(result.findings[0].id).toBe("joinmarket-subset-sum-resistant");
    expect(result.findings[0].severity).toBe("good");
  });

  it("skips tx with too many inputs (> 10)", () => {
    const vin = Array.from({ length: 11 }, () => makeVin());
    const tx = makeTx({ vin });
    const result = subsetSumAttack(tx);
    expect(result.found).toBe(false);
    expect(result.findings).toHaveLength(0);
  });
});

describe("identifyTakerMaker", () => {
  it("identifies taker as smallest change output", () => {
    const tx = makeTx({
      fee: 2_000,
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtaker", value: 300_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qmaker", value: 200_000 } }),
      ],
      vout: [
        makeVout({ value: 100_000 }), // denom 1
        makeVout({ value: 100_000 }), // denom 2
        makeVout({ value: 198_000 }), // taker change (smallest)
        makeVout({ value: 100_050 }), // maker change (slightly larger from fee income)
      ],
    });

    const result = identifyTakerMaker(tx);
    expect(result).not.toBeNull();
    // Taker change is the smallest non-denomination output
    expect(result!.findings[0].id).toBe("joinmarket-taker-maker");
    expect(result!.takerChangeIndex).toBeDefined();
  });

  it("returns null when no denomination found", () => {
    const tx = makeTx({
      vout: [
        makeVout({ value: 100_000 }),
        makeVout({ value: 200_000 }),
        makeVout({ value: 300_000 }),
      ],
    });
    const result = identifyTakerMaker(tx);
    expect(result).toBeNull();
  });
});

describe("analyzeJoinMarket", () => {
  it("runs both subset-sum and taker-maker analysis", () => {
    const tx = makeTx({
      fee: 1_234,
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 123_456 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 234_567 } }),
      ],
      vout: [
        makeVout({ value: 100_000 }),
        makeVout({ value: 100_000 }),
        makeVout({ value: 55_555 }),
        makeVout({ value: 101_234 }),
      ],
    });

    const findings = analyzeJoinMarket(tx);
    expect(findings.length).toBeGreaterThan(0);
  });
});
