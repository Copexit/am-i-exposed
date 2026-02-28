import { describe, it, expect, beforeEach } from "vitest";
import { analyzeChangeDetection } from "../change-detection";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeChangeDetection", () => {
  // ── Self-send detection ──────────────────────────────────────────────

  it("detects consolidation (1 output matching input) with impact -15, severity high", () => {
    const addr = "bc1qselfaddr000000000000000000000000000000";
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addr, value: 100_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qother00000000000000000000000000000000", value: 50_000 } }),
      ],
      vout: [makeVout({ value: 149_000, scriptpubkey_address: addr })],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-self-send");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-15);
    expect(f!.severity).toBe("high");
  });

  it("detects all-match self-send (2+ outputs) with impact -25, severity critical", () => {
    const addr = "bc1qselfaddr000000000000000000000000000000";
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addr, value: 100_000 } }),
      ],
      vout: [
        makeVout({ value: 50_000, scriptpubkey_address: addr }),
        makeVout({ value: 49_000, scriptpubkey_address: addr }),
      ],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-self-send");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-25);
    expect(f!.severity).toBe("critical");
  });

  it("detects partial self-send with impact -20, severity critical", () => {
    const addr = "bc1qselfaddr000000000000000000000000000000";
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addr, value: 100_000 } }),
      ],
      vout: [
        makeVout({ value: 50_000, scriptpubkey_address: addr }),
        makeVout({ value: 49_000 }), // different address
      ],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-self-send");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-20);
    expect(f!.severity).toBe("critical");
  });

  // ── Change detection (non-self-send) ─────────────────────────────────

  it("detects change via address type mismatch (low confidence), impact -5", () => {
    // Input is p2wpkh (bc1q), one output is bc1q (matches), other is p2pkh (1...)
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 100_000 } })],
      vout: [
        makeVout({ value: 50_000, scriptpubkey_address: "bc1qout000000000000000000000000000000000000" }),
        makeVout({ value: 49_000, scriptpubkey_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }),
      ],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-change-detected");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-5);
    expect(f!.severity).toBe("low");
  });

  it("detects change via round amount (low confidence), impact -5", () => {
    // One output is round (100k sats), other is not
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 200_000 } })],
      vout: [
        makeVout({ value: 100_000, scriptpubkey_address: "bc1qout1a0000000000000000000000000000000000" }),
        makeVout({ value: 99_000, scriptpubkey_address: "bc1qout2a0000000000000000000000000000000000" }),
      ],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-change-detected");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-5);
    expect(f!.severity).toBe("low");
  });

  it("detects change at medium confidence (2 signals agree), impact -10", () => {
    // Both address-type mismatch AND round amount point to the same change output
    // Input: bc1q (p2wpkh). Output 0: round + bc1p (different type). Output 1: non-round + bc1q (matches input type).
    // Address type mismatch: output 1 matches input type -> change = index 1
    // Round amount: output 0 is round -> change = index 1 (the non-round one)
    // Both agree on index 1 -> medium confidence
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 200_000 } })],
      vout: [
        makeVout({ value: 100_000, scriptpubkey_address: "bc1pout00000000000000000000000000000000000000000000000000" }),
        makeVout({ value: 99_000, scriptpubkey_address: "bc1qout2a0000000000000000000000000000000000" }),
      ],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-change-detected");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-10);
    expect(f!.severity).toBe("medium");
  });

  it("returns empty for 3+ spendable outputs (not 2)", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 30_000 }), makeVout({ value: 30_000 }), makeVout({ value: 30_000 })],
    });
    const { findings } = analyzeChangeDetection(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns empty when no change signal found", () => {
    // Both outputs same type as input, both non-round
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 100_000 } })],
      vout: [
        makeVout({ value: 51_234, scriptpubkey_address: "bc1qout1a0000000000000000000000000000000000" }),
        makeVout({ value: 47_266, scriptpubkey_address: "bc1qout2a0000000000000000000000000000000000" }),
      ],
    });
    const { findings } = analyzeChangeDetection(tx);
    expect(findings).toHaveLength(0);
  });

  it("skips coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 625_000_000 })],
    });
    const { findings } = analyzeChangeDetection(tx);
    expect(findings).toHaveLength(0);
  });
});
