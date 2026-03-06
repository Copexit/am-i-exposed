import { describe, it, expect, beforeEach } from "vitest";
import { analyzeRoundAmounts, getMatchingRoundUsd, isRoundUsdAmount } from "../round-amount";
import { makeTx, makeCoinbaseVin, makeVout, makeOpReturnVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeRoundAmounts", () => {
  it("flags 1 round output among non-round with impact -5, severity low", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 1_000_000 }), makeVout({ value: 48_723 })],
    });
    const { findings } = analyzeRoundAmounts(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h1-round-amount");
    expect(findings[0].scoreImpact).toBe(-5);
    expect(findings[0].severity).toBe("low");
  });

  it("flags 2 round outputs with impact -10, severity medium", () => {
    const tx = makeTx({
      vout: [
        makeVout({ value: 1_000_000 }),
        makeVout({ value: 5_000_000 }),
        makeVout({ value: 48_723 }),
      ],
    });
    const { findings } = analyzeRoundAmounts(tx);
    expect(findings[0].scoreImpact).toBe(-10);
    expect(findings[0].severity).toBe("medium");
  });

  it("caps impact at -15 for 3+ round outputs", () => {
    const tx = makeTx({
      vout: [
        makeVout({ value: 1_000_000 }),
        makeVout({ value: 5_000_000 }),
        makeVout({ value: 10_000_000 }),
        makeVout({ value: 50_000_000 }),
        makeVout({ value: 48_723 }),
      ],
    });
    const { findings } = analyzeRoundAmounts(tx);
    expect(findings[0].scoreImpact).toBe(-15);
  });

  it("does NOT flag when ALL outputs are round", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 1_000_000 }), makeVout({ value: 5_000_000 })],
    });
    const { findings } = analyzeRoundAmounts(tx);
    expect(findings).toHaveLength(0);
  });

  it("skips single-output transactions", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 1_000_000 })],
    });
    const { findings } = analyzeRoundAmounts(tx);
    expect(findings).toHaveLength(0);
  });

  it("skips coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 1_000_000 }), makeVout({ value: 48_723 })],
    });
    const { findings } = analyzeRoundAmounts(tx);
    expect(findings).toHaveLength(0);
  });

  it("recognizes round sat multiples (100k sats)", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 100_000 }), makeVout({ value: 48_723 })],
    });
    const { findings } = analyzeRoundAmounts(tx);
    expect(findings).toHaveLength(1);
  });

  it("ignores OP_RETURN outputs when counting", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 48_723 }), makeVout({ value: 31_500 }), makeOpReturnVout()],
    });
    const { findings } = analyzeRoundAmounts(tx);
    expect(findings).toHaveLength(0);
  });

  // ── Round USD amount detection ───────────────────────────────────────

  it("flags round USD output when usdPrice context is provided", () => {
    // At $50,000/BTC, $100 = 200,000 sats
    const tx = makeTx({
      vout: [makeVout({ value: 200_000 }), makeVout({ value: 48_723 })],
    });
    const { findings } = analyzeRoundAmounts(tx, undefined, { usdPrice: 50_000 });
    const usdFinding = findings.find((f) => f.id === "h1-round-usd-amount");
    expect(usdFinding).toBeDefined();
    expect(usdFinding!.scoreImpact).toBe(-5);
    expect(usdFinding!.params?.usdValues).toContain("$100");
  });

  it("does NOT flag round USD when usdPrice is not provided", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 200_000 }), makeVout({ value: 48_723 })],
    });
    const { findings } = analyzeRoundAmounts(tx);
    const usdFinding = findings.find((f) => f.id === "h1-round-usd-amount");
    expect(usdFinding).toBeUndefined();
  });

  it("does NOT flag round USD for values under $5", () => {
    // At $50,000/BTC, $2 = 4,000 sats
    const tx = makeTx({
      vout: [makeVout({ value: 4_000 }), makeVout({ value: 48_723 })],
    });
    const { findings } = analyzeRoundAmounts(tx, undefined, { usdPrice: 50_000 });
    const usdFinding = findings.find((f) => f.id === "h1-round-usd-amount");
    expect(usdFinding).toBeUndefined();
  });
});

describe("getMatchingRoundUsd", () => {
  it("matches $100 at $50,000/BTC (200,000 sats)", () => {
    expect(getMatchingRoundUsd(200_000, 50_000)).toBe(100);
  });

  it("matches $1,000 at $100,000/BTC (1,000,000 sats)", () => {
    expect(getMatchingRoundUsd(1_000_000, 100_000)).toBe(1_000);
  });

  it("allows 0.5% tolerance", () => {
    // $100 at $50,000/BTC = 200,000 sats. 0.5% = 1,000 sats tolerance
    expect(getMatchingRoundUsd(200_500, 50_000)).toBe(100);
    expect(getMatchingRoundUsd(199_500, 50_000)).toBe(100);
  });

  it("rejects outside tolerance", () => {
    // 0.5% of $100 = $0.50 -> 1,000 sats. 202,000 is too far.
    expect(getMatchingRoundUsd(202_000, 50_000)).toBeNull();
  });

  it("skips amounts under $5", () => {
    // $2 at $50,000/BTC = 4,000 sats
    expect(getMatchingRoundUsd(4_000, 50_000)).toBeNull();
  });

  it("matches $10,000 at $25,000/BTC (40,000,000 sats)", () => {
    expect(getMatchingRoundUsd(40_000_000, 25_000)).toBe(10_000);
  });
});

describe("isRoundUsdAmount", () => {
  it("returns true for matching round USD values", () => {
    expect(isRoundUsdAmount(200_000, 50_000)).toBe(true);
  });

  it("returns false for non-round USD values", () => {
    expect(isRoundUsdAmount(123_456, 50_000)).toBe(false);
  });
});
