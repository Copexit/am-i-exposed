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

  it("detects same-address-in-I/O (partial) with h2-same-address-io, impact -20, severity critical", () => {
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
    const f = findings.find((f) => f.id === "h2-same-address-io");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-20);
    expect(f!.severity).toBe("critical");
    expect(f!.description).toContain("100% deterministic");
  });

  // ── Change detection (non-self-send) ─────────────────────────────────

  it("detects change via address type mismatch alone (medium confidence, weight=2), impact -10", () => {
    // Input is p2wpkh (bc1q), one output is bc1q (matches), other is p2pkh (1...)
    // Address type mismatch alone gives weight=2, which reaches medium confidence threshold
    // Neither output is a round amount (non-round values)
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 100_000 } })],
      vout: [
        makeVout({ value: 51_234, scriptpubkey_address: "bc1qout000000000000000000000000000000000000" }),
        makeVout({ value: 47_266, scriptpubkey_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }),
      ],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-change-detected");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-10);
    expect(f!.severity).toBe("medium");
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

  it("detects change at medium confidence with round amount boost, impact -15", () => {
    // Both address-type mismatch AND round amount point to the same change output
    // Input: bc1q (p2wpkh). Output 0: round + bc1p (different type). Output 1: non-round + bc1q (matches input type).
    // Address type mismatch: output 1 matches input type -> change = index 1 (weight 2)
    // Round amount: output 0 is round -> change = index 1 (weight 1)
    // Both agree, round signal present -> boosted impact -15
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
    expect(f!.scoreImpact).toBe(-15);
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

  // ── Optimal change detection ─────────────────────────────────────────

  it("detects optimal change when one output has >90% of input value", () => {
    // Input: 100k. Fee: 1500. Output 0: 95k (95% of spendable). Output 1: 3.5k.
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 100_000 } })],
      vout: [
        makeVout({ value: 95_123, scriptpubkey_address: "bc1qout1a0000000000000000000000000000000000" }),
        makeVout({ value: 3_377, scriptpubkey_address: "bc1qout2a0000000000000000000000000000000000" }),
      ],
      fee: 1500,
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-change-detected");
    expect(f).toBeDefined();
    expect(f!.params?.signalKeys).toContain("optimal_change");
  });

  // ── Shadow change detection ──────────────────────────────────────────

  it("detects shadow change when one output is <10% of smallest input", () => {
    // Input: 100k. Output 0: 91k. Output 1: 8k (8% of input, below 10% threshold).
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 100_000 } })],
      vout: [
        makeVout({ value: 91_123, scriptpubkey_address: "bc1qout1a0000000000000000000000000000000000" }),
        makeVout({ value: 7_377, scriptpubkey_address: "bc1qout2a0000000000000000000000000000000000" }),
      ],
      fee: 1500,
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-change-detected");
    expect(f).toBeDefined();
    expect(f!.params?.signalKeys).toContain("shadow_change");
  });

  // ── Sweep detection ──────────────────────────────────────────────────

  it("detects sweep (1-in, 1-out) with impact 0, severity low (normal practice)", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 100_000 } })],
      vout: [makeVout({ value: 99_000, scriptpubkey_address: "bc1qout1a0000000000000000000000000000000000" })],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-sweep");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(0);
    expect(f!.severity).toBe("low");
  });

  it("does NOT detect sweep when input and output share the same address (self-transfer)", () => {
    const addr = "bc1qselfaddr000000000000000000000000000000";
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addr, value: 100_000 } })],
      vout: [makeVout({ value: 99_000, scriptpubkey_address: addr })],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-sweep");
    expect(f).toBeUndefined();
  });

  it("does NOT detect sweep for multi-input single-output (consolidation)", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput1000000000000000000000000000000000", value: 50_000 } }),
      ],
      vout: [makeVout({ value: 99_000, scriptpubkey_address: "bc1qout1a0000000000000000000000000000000000" })],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-sweep");
    expect(f).toBeUndefined();
  });

  // ── Wallet hop detection ──────────────────────────────────────────────

  it("detects wallet hop (P2PKH -> P2WPKH script type upgrade), impact 0", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "p2pkh", scriptpubkey_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "p2pkh", scriptpubkey_address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", value: 30_000 } }),
      ],
      vout: [makeVout({ value: 79_000, scriptpubkey_address: "bc1qout1a0000000000000000000000000000000000" })],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-wallet-hop");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(0);
    expect(f!.severity).toBe("low");
    expect(f!.params?.fromTypes).toContain("p2pkh");
    expect(f!.params?.toType).toBe("v0_p2wpkh");
  });

  it("detects wallet hop (P2WPKH -> P2TR script type upgrade)", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 80_000 } }),
      ],
      vout: [makeVout({
        value: 79_000,
        scriptpubkey_type: "v1_p2tr",
        scriptpubkey_address: "bc1pout00000000000000000000000000000000000000000000000000",
      })],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-wallet-hop");
    expect(f).toBeDefined();
    expect(f!.params?.toType).toBe("v1_p2tr");
  });

  it("does NOT detect wallet hop when same script type (no upgrade)", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 80_000 } }),
      ],
      vout: [makeVout({ value: 79_000, scriptpubkey_address: "bc1qout1a0000000000000000000000000000000000" })],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-wallet-hop");
    expect(f).toBeUndefined();
  });

  it("does NOT detect wallet hop for downgrades (P2TR -> P2PKH)", () => {
    const tx = makeTx({
      vin: [
        makeVin({
          prevout: {
            scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v1_p2tr",
            scriptpubkey_address: "bc1pout00000000000000000000000000000000000000000000000000",
            value: 80_000,
          },
        }),
      ],
      vout: [makeVout({ value: 79_000, scriptpubkey_type: "p2pkh", scriptpubkey_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" })],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-wallet-hop");
    expect(f).toBeUndefined();
  });

  // ── Round USD change detection ──────────────────────────────────────

  it("detects change via round USD amount (low confidence), impact -5", () => {
    // At $50,000/BTC, $100 = 200,000 sats. One output is exactly $100, other is not.
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 300_000 } })],
      vout: [
        makeVout({ value: 200_000, scriptpubkey_address: "bc1qout1a0000000000000000000000000000000000" }),
        makeVout({ value: 99_000, scriptpubkey_address: "bc1qout2a0000000000000000000000000000000000" }),
      ],
    });
    const { findings } = analyzeChangeDetection(tx, undefined, { usdPrice: 50_000 });
    const f = findings.find((f) => f.id === "h2-change-detected");
    expect(f).toBeDefined();
    expect(f!.params?.signalKeys).toContain("round_usd_amount");
  });

  it("does NOT use round USD signal when no usdPrice in context", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 300_000 } })],
      vout: [
        makeVout({ value: 200_000, scriptpubkey_address: "bc1qout1a0000000000000000000000000000000000" }),
        makeVout({ value: 99_000, scriptpubkey_address: "bc1qout2a0000000000000000000000000000000000" }),
      ],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-change-detected");
    // May or may not have findings from other sub-heuristics, but should NOT have round_usd_amount
    if (f) {
      expect(f.params?.signalKeys).not.toContain("round_usd_amount");
    }
  });

  // ── Fresh address change detection ────────────────────────────────

  it("detects change via fresh vs reused address (medium confidence)", () => {
    const freshAddr = "bc1qfresh00000000000000000000000000000000";
    const reusedAddr = "bc1qreused0000000000000000000000000000000";
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 100_000 } })],
      vout: [
        makeVout({ value: 51_234, scriptpubkey_address: freshAddr }),
        makeVout({ value: 47_266, scriptpubkey_address: reusedAddr }),
      ],
    });
    const outputTxCounts = new Map([
      [freshAddr, 1],   // fresh: only this tx
      [reusedAddr, 15], // reused: seen many times
    ]);
    const { findings } = analyzeChangeDetection(tx, undefined, { outputTxCounts });
    const f = findings.find((f) => f.id === "h2-change-detected");
    expect(f).toBeDefined();
    expect(f!.params?.signalKeys).toContain("fresh_address");
    expect(f!.severity).toBe("medium");
  });

  it("does NOT use fresh address signal when both outputs are fresh", () => {
    const addr0 = "bc1qfresh10000000000000000000000000000000";
    const addr1 = "bc1qfresh20000000000000000000000000000000";
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 100_000 } })],
      vout: [
        makeVout({ value: 51_234, scriptpubkey_address: addr0 }),
        makeVout({ value: 47_266, scriptpubkey_address: addr1 }),
      ],
    });
    const outputTxCounts = new Map([
      [addr0, 1],
      [addr1, 1],
    ]);
    const { findings } = analyzeChangeDetection(tx, undefined, { outputTxCounts });
    // Both fresh: no fresh address signal should fire
    const f = findings.find((f) => f.id === "h2-change-detected");
    if (f) {
      expect(f.params?.signalKeys).not.toContain("fresh_address");
    }
  });

  it("does NOT use fresh address signal when no outputTxCounts in context", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qinput0000000000000000000000000000000000", value: 100_000 } })],
      vout: [
        makeVout({ value: 51_234, scriptpubkey_address: "bc1qout1a0000000000000000000000000000000000" }),
        makeVout({ value: 47_266, scriptpubkey_address: "bc1qout2a0000000000000000000000000000000000" }),
      ],
    });
    const { findings } = analyzeChangeDetection(tx);
    const f = findings.find((f) => f.id === "h2-change-detected");
    if (f) {
      expect(f.params?.signalKeys).not.toContain("fresh_address");
    }
  });
});
