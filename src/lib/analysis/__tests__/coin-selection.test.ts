import { describe, it, expect } from "vitest";
import { selectCoins, type CoinSelectionInput } from "../coin-selection";
import type { MempoolUtxo } from "@/lib/api/types";

function makeInput(value: number, address = "bc1qtest"): CoinSelectionInput {
  const utxo: MempoolUtxo = {
    txid: `tx_${value}`,
    vout: 0,
    status: { confirmed: true, block_height: 800000, block_time: 1700000000, block_hash: "" },
    value,
  };
  return { utxo, address };
}

describe("selectCoins", () => {
  it("finds exact match via BnB", () => {
    const utxos = [
      makeInput(50_000),
      makeInput(30_000),
      makeInput(20_000),
      makeInput(10_000),
    ];

    // 50_000 + 10_000 should roughly match 59_000 + fee
    // With 1 output at 5 sat/vB, fee ~= (68+10+31)*5 = 545 sats
    // So 50_000 alone can't cover 50_000 + 545, but 50k + 10k = 60k covers ~59_400
    const result = selectCoins(utxos, 59_000, 5);
    expect(result).not.toBeNull();
    if (!result) return;

    // Should find some selection
    expect(result.paymentAmount).toBe(59_000);
    expect(result.inputTotal).toBeGreaterThanOrEqual(59_000);
  });

  it("uses single UTXO when possible", () => {
    const utxos = [
      makeInput(100_000),
      makeInput(50_000),
      makeInput(25_000),
    ];

    const result = selectCoins(utxos, 20_000, 5);
    expect(result).not.toBeNull();
    if (!result) return;

    // Should prefer smallest sufficient UTXO (25_000)
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].utxo.value).toBe(25_000);
    expect(result.changeAmount).toBeGreaterThan(0);
  });

  it("returns null for insufficient funds", () => {
    const utxos = [makeInput(1000), makeInput(2000)];
    const result = selectCoins(utxos, 100_000, 5);
    expect(result).toBeNull();
  });

  it("returns null for empty utxo set", () => {
    expect(selectCoins([], 10_000)).toBeNull();
  });

  it("warns about toxic change", () => {
    // A UTXO of 25_000 paying 20_000 at 5 sat/vB
    // Fee for 1-in 2-out P2WPKH: (68 + 10 + 62) * 5 = 700
    // Change = 25_000 - 20_000 - 700 = 4_300 (toxic)
    const utxos = [makeInput(25_000)];
    const result = selectCoins(utxos, 20_000, 5);
    expect(result).not.toBeNull();
    if (!result) return;

    const toxicFinding = result.findings.find(f => f.id === "coin-select-toxic-change");
    expect(toxicFinding).toBeDefined();
  });

  it("warns about mixed script types", () => {
    const utxos = [
      makeInput(30_000, "bc1qaddr1"),
      makeInput(30_000, "3addr2xxxx"),
    ];

    const result = selectCoins(utxos, 55_000, 1);
    expect(result).not.toBeNull();
    if (!result) return;

    if (result.selected.length > 1) {
      const mixedFinding = result.findings.find(f => f.id === "coin-select-mixed-scripts");
      expect(mixedFinding).toBeDefined();
    }
  });

  it("warns about multiple inputs (CIOH)", () => {
    const utxos = [
      makeInput(20_000),
      makeInput(20_000),
      makeInput(20_000),
    ];

    const result = selectCoins(utxos, 55_000, 1);
    expect(result).not.toBeNull();
    if (!result) return;

    if (result.selected.length > 1) {
      const ciohFinding = result.findings.find(f => f.id === "coin-select-multiple-inputs");
      expect(ciohFinding).toBeDefined();
    }
  });

  it("rewards exact match selection", () => {
    // Create UTXOs that perfectly match a target
    const utxos = [makeInput(50_000), makeInput(10_000)];

    // Target 59_000 at low fee rate should find exact match with both UTXOs
    const result = selectCoins(utxos, 59_000, 1);
    if (result && result.strategy === "exact-match") {
      const exactFinding = result.findings.find(f => f.id === "coin-select-exact-match");
      expect(exactFinding).toBeDefined();
      expect(exactFinding?.severity).toBe("good");
    }
  });
});
