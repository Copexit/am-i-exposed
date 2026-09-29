import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { MempoolTransaction } from "@/lib/api/types";
import { analyzeEntropy } from "../entropy";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, makeOpReturnVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeEntropy", () => {
  it("detects 1-in-1-out as zero entropy, impact 0 (normal sweep)", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest1", value: 50_000 } })],
      vout: [makeVout({ value: 49_000 })],
    });
    const { findings } = analyzeEntropy(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe("h5-zero-entropy");
    expect(findings[0]!.scoreImpact).toBe(0);
    expect(findings[0]!.severity).toBe("low");
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
    expect(findings[0]!.id).toBe("h5-low-entropy");
    expect(findings[0]!.scoreImpact).toBe(-3);
    expect(findings[0]!.severity).toBe("medium");
  });

  it("detects positive entropy with Boltzmann path (2 equal outputs)", () => {
    // 2 equal inputs, 2 equal outputs -> Boltzmann: n=2, count=3, entropy=log2(3)~1.58
    // impact = 2 (capped: entropy < 2 bits -> fixed +2)
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
    expect(findings[0]!.id).toBe("h5-entropy");
    expect(findings[0]!.scoreImpact).toBe(2);
    expect(findings[0]!.params?.entropy).toBeCloseTo(1.58, 1);
    expect(findings[0]!.params?.entropyPerUtxo).toBeCloseTo(0.396, 2);
    expect(findings[0]!.params?.nUtxos).toBe(4);
  });

  it("detects high entropy (5 equal outputs), impact capped at 15", () => {
    // 5 equal inputs, 5 equal outputs -> Boltzmann: n=5, count=1496, entropy=log2(1496)~10.55
    // impact = min(floor(10.55*2), 15) = 15
    const tx = makeTx({
      vin: Array.from({ length: 5 }, (_, i) =>
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: `bc1q${"abcde"[i]}${"0".repeat(37)}`, value: 100_000 } }),
      ),
      vout: Array.from({ length: 5 }, () => makeVout({ value: 50_000 })),
    });
    const { findings } = analyzeEntropy(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe("h5-entropy");
    expect(findings[0]!.scoreImpact).toBe(15);
    expect(findings[0]!.severity).toBe("good");
  });

  it("ignores OP_RETURN outputs in entropy calculation", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest1", value: 50_000 } })],
      vout: [makeVout({ value: 49_000 }), makeOpReturnVout("cafe")],
    });
    const { findings } = analyzeEntropy(tx);
    // 1 input, 1 spendable output (OP_RETURN excluded) -> zero entropy
    expect(findings[0]!.id).toBe("h5-zero-entropy");
  });

  it("detects N-in-1-out sweep as zero entropy with sweep label, impact -3", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qaddr1", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qaddr2", value: 30_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qaddr3", value: 20_000 } }),
      ],
      vout: [makeVout({ value: 99_500 })],
    });
    const { findings } = analyzeEntropy(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe("h5-zero-entropy-sweep");
    expect(findings[0]!.scoreImpact).toBe(-3);
    expect(findings[0]!.title).toContain("sweep");
    expect(findings[0]!.params?.inputCount).toBe(3);
    expect(findings[0]!.remediation).toBeDefined();
  });

  it("computes Boltzmann entropy when only a subset of inputs can fund equal outputs (k < n)", () => {
    // 5 equal outputs of 100k sats, but only 3 of 5 inputs can fund them
    // (2 inputs are too small). Previously this returned null and fell
    // through to mixed-value enumeration, underestimating entropy.
    //
    // With the fix: k=3 fundable inputs, n=5 equal outputs
    // boltzmannEqualOutputs(3) = 16, log2(16) = 4.0 bits
    // C(5,3) = 10, log2(10) ~ 3.32 bits
    // Total entropy ~ 7.32 bits
    // impact = min(floor(7.32*2), 15) = 14
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa1", value: 200_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa2", value: 200_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa3", value: 200_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa4", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa5", value: 50_000 } }),
      ],
      vout: Array.from({ length: 5 }, () => makeVout({ value: 100_000 })),
    });
    const { findings } = analyzeEntropy(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe("h5-entropy");
    // boltzmannEqualOutputs(3) = 16 -> log2(16) = 4.0
    // C(5,3) = 10 -> log2(10) ~ 3.3219
    // total ~ 7.32 bits
    expect(findings[0]!.params?.entropy).toBeCloseTo(7.32, 1);
    expect(findings[0]!.params?.method).toBe("Boltzmann partition");
    expect(findings[0]!.scoreImpact).toBe(14);
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

describe("analyzeEntropy - UTXOs sharing an address are one party (Boltzmann MERGE_INPUTS/MERGE_OUTPUTS)", () => {
  const vinAt = (address: string, value: number) =>
    makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: address, value } });

  it("scores the same as the tx with those UTXOs already merged", () => {
    const split = makeTx({
      vin: [vinAt("bc1qa", 30_000), vinAt("bc1qa", 30_000), vinAt("bc1qb", 60_000)],
      vout: [
        makeVout({ value: 25_000, scriptpubkey_address: "bc1qx" }),
        makeVout({ value: 30_000, scriptpubkey_address: "bc1qx" }),
        makeVout({ value: 55_000, scriptpubkey_address: "bc1qy" }),
      ],
    });
    const merged = makeTx({
      vin: [vinAt("bc1qa", 60_000), vinAt("bc1qb", 60_000)],
      vout: [
        makeVout({ value: 55_000, scriptpubkey_address: "bc1qx" }),
        makeVout({ value: 55_000, scriptpubkey_address: "bc1qy" }),
      ],
    });
    const expected = analyzeEntropy(merged).findings;
    expect(expected[0]!.id).toBe("h5-entropy");
    expect(analyzeEntropy(split).findings).toEqual(expected);
  });

  it("ebe3d1ad (single-address self-transfer) has zero entropy, not +15", () => {
    const { tx } = JSON.parse(readFileSync(
      join(__dirname, "fixtures/api-responses/corpus/ebe3d1ad3798ec45d9be5dcff476fe54ff36ddc0c9ac8ff9d5acb08d485d340e.json"),
      "utf-8",
    )) as { tx: MempoolTransaction };
    const { findings } = analyzeEntropy(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe("h5-zero-entropy");
    expect(findings[0]!.scoreImpact).toBe(0);
    expect(findings[0]!.params?._variant).toBe("merged");
  });

  it("65551b77 (1 input, 563 equal dust outputs) has zero entropy, no positive credit", () => {
    const tx = JSON.parse(readFileSync(
      join(__dirname, "fixtures/api-responses/dust-attack-564.json"),
      "utf-8",
    )) as MempoolTransaction;
    const { findings } = analyzeEntropy(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe("h5-low-entropy");
    expect(findings[0]!.params?.entropy).toBe(0);
    expect(findings[0]!.scoreImpact).toBeLessThanOrEqual(0);
  });

  it("1-in-N-out with equal outputs has zero entropy (every output is linked to the one input)", () => {
    for (const n of [2, 3, 12]) {
      const tx = makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsrc", value: 10_000_000 } })],
        vout: Array.from({ length: n }, () => makeVout({ value: 100_000 })),
      });
      const [f] = analyzeEntropy(tx).findings;
      expect(f!.id).toBe("h5-low-entropy");
      expect(f!.params?.entropy).toBe(0);
      // Exactly 0 by structure, not an estimate
      expect(f!.confidence).toBe("deterministic");
      expect(f!.params?._variant).toBe("single_input");
      expect(f!.params?.outputCount).toBe(n);
    }
  });

  it("multi-input zero entropy keeps the generic low-entropy text", () => {
    // 2 inputs, 2 outputs, no input can fund the big output alone
    const tx = makeTx({
      vin: [makeVin({ prevout: { ...makeVin().prevout!, value: 60_000 } }), makeVin({ prevout: { ...makeVin().prevout!, value: 60_000 } })],
      vout: [makeVout({ value: 100_000 }), makeVout({ value: 15_000 })],
    });
    const [f] = analyzeEntropy(tx).findings;
    expect(f!.id).toBe("h5-low-entropy");
    expect(f!.confidence).toBe("medium");
    expect(f!.params?._variant).toBeUndefined();
  });

  it("single-denomination path is an estimate using the input count", () => {
    // 2 inputs, 12 equal outputs + 1 change: at most 2 parties, not 12.
    // Same partial-coverage count as the all-equal path: B(2) * C(12, 2) = 3 * 66.
    // Not exact (the true count is 133) and not an upper bound: labelled an estimate.
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 1_000_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 1_000_000 } }),
      ],
      vout: [...Array.from({ length: 12 }, () => makeVout({ value: 100_000 })), makeVout({ value: 777_000 })],
    });
    const [f] = analyzeEntropy(tx).findings;
    expect(Number(f!.params?.entropy)).toBeCloseTo(Math.log2(3 * 66), 2);
    expect(f!.params?.method).toBe("Boltzmann estimate");
  });

  it("single-denomination path only counts inputs worth at least the denomination", () => {
    // The 50k input cannot fund a 100k output on its own: still 2 parties
    const vin = (address: string, value: number) =>
      makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: address, value } });
    const tx = makeTx({
      vin: [vin("bc1qa", 1_000_000), vin("bc1qb", 1_000_000), vin("bc1qc", 50_000)],
      vout: [...Array.from({ length: 12 }, () => makeVout({ value: 100_000 })), makeVout({ value: 777_000 })],
    });
    const [f] = analyzeEntropy(tx).findings;
    expect(Number(f!.params?.entropy)).toBeCloseTo(Math.log2(3 * 66), 2);
  });
});
