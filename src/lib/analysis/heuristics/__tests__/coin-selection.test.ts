import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { MempoolTransaction } from "@/lib/api/types";
import { analyzeCoinSelection } from "../coin-selection";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeCoinSelection", () => {
  it("detects BnB pattern (multiple inputs, single output, no change)", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 48_500 } }),
      ],
      vout: [makeVout({ value: 97_000 })],
      fee: 1_500,
    });

    const { findings } = analyzeCoinSelection(tx);
    const f = findings.find((f) => f.id === "h-coin-selection-bnb");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("good");
    expect(f!.scoreImpact).toBe(3);
  });

  it("does not flag BnB for single-input single-output", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout({ value: 98_500 })],
    });

    const { findings } = analyzeCoinSelection(tx);
    expect(findings.find((f) => f.id === "h-coin-selection-bnb")).toBeUndefined();
  });

  it("detects ascending value input ordering", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 10_000 } }),
        makeVin({ prevout: { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 30_000 } }),
        makeVin({ prevout: { scriptpubkey: "0014ccc", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qc", value: 50_000 } }),
      ],
      vout: [makeVout({ value: 88_500 })],
    });

    const { findings } = analyzeCoinSelection(tx);
    // Ascending order; 3 inputs to 1 output is a consolidation, not BnB
    expect(findings.find((f) => f.id === "h-coin-selection-bnb")).toBeUndefined();
    expect(findings.find((f) => f.id === "h-coin-selection-value-asc")).toBeDefined();
  });

  it("detects descending value input ordering", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 30_000 } }),
        makeVin({ prevout: { scriptpubkey: "0014ccc", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qc", value: 10_000 } }),
      ],
      vout: [makeVout(), makeVout()],
    });

    const { findings } = analyzeCoinSelection(tx);
    expect(findings.find((f) => f.id === "h-coin-selection-value-desc")).toBeDefined();
  });

  it("does not flag ordering when inputs are unordered", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 30_000 } }),
        makeVin({ prevout: { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 10_000 } }),
        makeVin({ prevout: { scriptpubkey: "0014ccc", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qc", value: 50_000 } }),
      ],
      vout: [makeVout(), makeVout()],
    });

    const { findings } = analyzeCoinSelection(tx);
    expect(findings.find((f) => f.id === "h-coin-selection-value-asc")).toBeUndefined();
    expect(findings.find((f) => f.id === "h-coin-selection-value-desc")).toBeUndefined();
  });

  it("returns empty for coinbase transactions", () => {
    const tx = makeTx({
      vin: [{ txid: "0".repeat(64), vout: 0xffffffff, prevout: null, scriptsig: "", scriptsig_asm: "", is_coinbase: true, sequence: 0xffffffff }],
      vout: [makeVout()],
    });

    const { findings } = analyzeCoinSelection(tx);
    expect(findings).toHaveLength(0);
  });

  it("does not credit consolidation 40b88e16 (5 in, 1 out) as Branch-and-Bound", () => {
    const tx = JSON.parse(readFileSync(join(__dirname, "fixtures/api-responses/consolidation-5in1out.json"), "utf8")) as MempoolTransaction;
    expect(analyzeCoinSelection(tx).findings.find((f) => f.id === "h-coin-selection-bnb")).toBeUndefined();
  });

  it("does not credit any 3+-input consolidation as Branch-and-Bound", () => {
    const tx = makeTx({ vin: [makeVin(), makeVin(), makeVin()], vout: [makeVout({ value: 250_000 })] });
    expect(analyzeCoinSelection(tx).findings.find((f) => f.id === "h-coin-selection-bnb")).toBeUndefined();
  });

  it("does not credit a 2-input self-send (output back to an input address)", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 48_500 } }),
      ],
      vout: [makeVout({ value: 97_000, scriptpubkey_address: "bc1qa" })],
    });
    expect(analyzeCoinSelection(tx).findings.find((f) => f.id === "h-coin-selection-bnb")).toBeUndefined();
  });
});
