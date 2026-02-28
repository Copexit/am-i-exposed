import { describe, it, expect, beforeEach } from "vitest";
import { analyzeEntropy } from "../entropy";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, makeOpReturnVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeEntropy", () => {
  it("detects 1-in-1-out as zero entropy, impact -5", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest1", value: 50_000 } })],
      vout: [makeVout({ value: 49_000 })],
    });
    const { findings } = analyzeEntropy(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h5-zero-entropy");
    expect(findings[0].scoreImpact).toBe(-5);
    expect(findings[0].severity).toBe("low");
  });

  it("detects near-zero entropy (all mappings deterministic), impact -3", () => {
    // 2 inputs with different values, 2 outputs that force deterministic assignment
    // Input: [100, 200], Outputs: [200, 50] - only one valid mapping
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qaddr1", value: 100 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qaddr2", value: 200 } }),
      ],
      vout: [
        makeVout({ value: 200 }),
        makeVout({ value: 50 }),
      ],
    });
    const { findings } = analyzeEntropy(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h5-low-entropy");
    expect(findings[0].scoreImpact).toBe(-3);
    expect(findings[0].severity).toBe("medium");
  });

  it("detects positive entropy with Boltzmann path (2 equal outputs)", () => {
    // 2 equal inputs, 2 equal outputs -> Boltzmann: n=2, count=3, entropy=log2(3)~1.58
    // impact = floor(1.58*2) = 3
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa1", value: 100_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa2", value: 100_000 } }),
      ],
      vout: [
        makeVout({ value: 50_000 }),
        makeVout({ value: 50_000 }),
      ],
    });
    const { findings } = analyzeEntropy(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h5-entropy");
    expect(findings[0].scoreImpact).toBe(3);
    expect(findings[0].params?.entropy).toBeCloseTo(1.58, 1);
  });

  it("detects high entropy (5 equal outputs), impact capped at 15", () => {
    // 5 equal inputs, 5 equal outputs -> Boltzmann: n=5, count=1496, entropy=log2(1496)~10.55
    // impact = min(floor(10.55*2), 15) = 15
    const tx = makeTx({
      vin: Array.from({ length: 5 }, () =>
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q" + Math.random().toString(16).slice(2, 40).padEnd(38, "0"), value: 100_000 } }),
      ),
      vout: Array.from({ length: 5 }, () => makeVout({ value: 50_000 })),
    });
    const { findings } = analyzeEntropy(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h5-entropy");
    expect(findings[0].scoreImpact).toBe(15);
    expect(findings[0].severity).toBe("good");
  });

  it("ignores OP_RETURN outputs in entropy calculation", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest1", value: 50_000 } })],
      vout: [makeVout({ value: 49_000 }), makeOpReturnVout("cafe")],
    });
    const { findings } = analyzeEntropy(tx);
    // 1 input, 1 spendable output (OP_RETURN excluded) -> zero entropy
    expect(findings[0].id).toBe("h5-zero-entropy");
  });

  it("returns empty for coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 625_000_000 })],
    });
    const { findings } = analyzeEntropy(tx);
    expect(findings).toHaveLength(0);
  });
});
