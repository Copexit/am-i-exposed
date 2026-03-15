import { describe, it, expect, beforeEach } from "vitest";
import { analyzeRoundAmounts, getMatchingRoundFiat, ROUND_USD_TOLERANCE_DEFAULT, ROUND_USD_TOLERANCE_SELF_HOSTED } from "../round-amount";
import { makeTx, makeCoinbaseVin, makeVout, makeOpReturnVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeRoundAmounts", () => {
  it("flags 1 round output among non-round with impact -8, severity low", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 1_000_000 }), makeVout({ value: 48_723 })],
    });
    const { findings } = analyzeRoundAmounts(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h1-round-amount");
    expect(findings[0].scoreImpact).toBe(-8);
    expect(findings[0].severity).toBe("low");
  });

  it("flags 2 round outputs with impact -16, severity medium", () => {
    const tx = makeTx({
      vout: [
        makeVout({ value: 1_000_000 }),
        makeVout({ value: 5_000_000 }),
        makeVout({ value: 48_723 }),
      ],
    });
    const { findings } = analyzeRoundAmounts(tx);
    expect(findings[0].scoreImpact).toBe(-16);
    expect(findings[0].severity).toBe("medium");
  });

  it("caps impact at -20 for 3+ round outputs", () => {
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
    expect(findings[0].scoreImpact).toBe(-20);
  });

  it("flags all-round outputs with lower impact", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 1_000_000 }), makeVout({ value: 5_000_000 })],
    });
    const { findings } = analyzeRoundAmounts(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].scoreImpact).toBe(-3);
    expect(findings[0].confidence).toBe("medium");
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
    expect(usdFinding!.scoreImpact).toBe(-8);
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

  it("uses looser tolerance for self-hosted mempool (isCustomApi)", () => {
    // At $50,000/BTC, $100 = 200,000 sats. 0.8% off = 201,600 sats
    const tx = makeTx({
      vout: [makeVout({ value: 201_600 }), makeVout({ value: 48_723 })],
    });
    // Default (public mempool.space): 0.5% tolerance - should NOT match
    const defaultResult = analyzeRoundAmounts(tx, undefined, { usdPrice: 50_000 });
    expect(defaultResult.findings.find((f) => f.id === "h1-round-usd-amount")).toBeUndefined();

    // Self-hosted: 1% tolerance - should match
    const selfHostedResult = analyzeRoundAmounts(tx, undefined, { usdPrice: 50_000, isCustomApi: true });
    expect(selfHostedResult.findings.find((f) => f.id === "h1-round-usd-amount")).toBeDefined();
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

describe("getMatchingRoundFiat - USD", () => {
  it("matches $100 at $50,000/BTC (200,000 sats)", () => {
    expect(getMatchingRoundFiat(200_000, 50_000)).toBe(100);
  });

  it("matches $1,000 at $100,000/BTC (1,000,000 sats)", () => {
    expect(getMatchingRoundFiat(1_000_000, 100_000)).toBe(1_000);
  });

  it("allows 0.5% tolerance", () => {
    // $100 at $50,000/BTC = 200,000 sats. 0.5% = 1,000 sats tolerance
    expect(getMatchingRoundFiat(200_500, 50_000)).toBe(100);
    expect(getMatchingRoundFiat(199_500, 50_000)).toBe(100);
  });

  it("rejects outside tolerance", () => {
    // 0.5% of $100 = $0.50 -> 1,000 sats. 202,000 is too far.
    expect(getMatchingRoundFiat(202_000, 50_000)).toBeNull();
  });

  it("skips amounts under $5", () => {
    // $2 at $50,000/BTC = 4,000 sats
    expect(getMatchingRoundFiat(4_000, 50_000)).toBeNull();
  });

  it("matches $10,000 at $25,000/BTC (40,000,000 sats)", () => {
    expect(getMatchingRoundFiat(40_000_000, 25_000)).toBe(10_000);
  });

  it("uses 0.5% default tolerance (ROUND_USD_TOLERANCE_DEFAULT)", () => {
    expect(ROUND_USD_TOLERANCE_DEFAULT).toBe(0.005);
  });

  it("uses 1% self-hosted tolerance (ROUND_USD_TOLERANCE_SELF_HOSTED)", () => {
    expect(ROUND_USD_TOLERANCE_SELF_HOSTED).toBe(0.01);
  });

  it("rejects 0.8% deviation at default tolerance but accepts at self-hosted tolerance", () => {
    // $100 at $50,000/BTC = 200,000 sats. 0.8% off = 201,600 sats ($100.80)
    expect(getMatchingRoundFiat(201_600, 50_000, ROUND_USD_TOLERANCE_DEFAULT)).toBeNull();
    expect(getMatchingRoundFiat(201_600, 50_000, ROUND_USD_TOLERANCE_SELF_HOSTED)).toBe(100);
  });

  it("accepts within 0.5% at default, within 1% at self-hosted", () => {
    // $100 at $50,000/BTC = 200,000 sats. 0.4% off = 200,800 sats
    expect(getMatchingRoundFiat(200_800, 50_000, ROUND_USD_TOLERANCE_DEFAULT)).toBe(100);
    expect(getMatchingRoundFiat(200_800, 50_000, ROUND_USD_TOLERANCE_SELF_HOSTED)).toBe(100);
  });

  it("rejects beyond 1% even at self-hosted tolerance", () => {
    // $100 at $50,000/BTC = 200,000 sats. 1.2% off = 202,400 sats
    expect(getMatchingRoundFiat(202_400, 50_000, ROUND_USD_TOLERANCE_SELF_HOSTED)).toBeNull();
  });
});

describe("getMatchingRoundFiat - boolean equivalence (USD)", () => {
  it("returns non-null for matching round USD values", () => {
    expect(getMatchingRoundFiat(200_000, 50_000) !== null).toBe(true);
  });

  it("returns null for non-round USD values", () => {
    expect(getMatchingRoundFiat(123_456, 50_000) !== null).toBe(false);
  });
});

// ── EUR round amount detection ─────────────────────────────────────

describe("getMatchingRoundFiat - EUR", () => {
  it("matches EUR100 at EUR45,000/BTC", () => {
    // EUR100 at 45,000 EUR/BTC = 222,222 sats
    const sats = Math.round((100 / 45_000) * 100_000_000);
    expect(getMatchingRoundFiat(sats, 45_000)).toBe(100);
  });

  it("matches EUR500 at EUR45,000/BTC", () => {
    const sats = Math.round((500 / 45_000) * 100_000_000);
    expect(getMatchingRoundFiat(sats, 45_000)).toBe(500);
  });

  it("returns null for non-round EUR values", () => {
    expect(getMatchingRoundFiat(123_456, 45_000)).toBeNull();
  });

  it("skips amounts under EUR5", () => {
    const sats = Math.round((2 / 45_000) * 100_000_000);
    expect(getMatchingRoundFiat(sats, 45_000)).toBeNull();
  });
});

describe("getMatchingRoundFiat - boolean equivalence (EUR)", () => {
  it("returns non-null for matching round EUR values", () => {
    const sats = Math.round((200 / 45_000) * 100_000_000);
    expect(getMatchingRoundFiat(sats, 45_000) !== null).toBe(true);
  });

  it("returns null for non-round EUR values", () => {
    expect(getMatchingRoundFiat(123_456, 45_000) !== null).toBe(false);
  });
});

describe("analyzeRoundAmounts - EUR detection", () => {
  it("flags round EUR output when eurPrice context is provided", () => {
    // EUR200 at EUR45,000/BTC = 444,444 sats
    const sats = Math.round((200 / 45_000) * 100_000_000);
    const tx = makeTx({
      vout: [makeVout({ value: sats }), makeVout({ value: 48_723 })],
    });
    const { findings } = analyzeRoundAmounts(tx, undefined, { eurPrice: 45_000 });
    const eurFinding = findings.find((f) => f.id === "h1-round-eur-amount");
    expect(eurFinding).toBeDefined();
    expect(eurFinding!.params?.eurValues).toContain("EUR200");
  });

  it("does not double-count outputs that match both USD and EUR", () => {
    // If an output matches both $200 USD and EUR200, only USD finding should include it.
    // EUR finding should only include EUR-only matches.
    const sats = 200_000; // $100 at $50k/BTC
    const tx = makeTx({
      vout: [makeVout({ value: sats }), makeVout({ value: 48_723 })],
    });
    // Use USD and EUR prices where $100 = EUR100 (both match same output)
    const { findings } = analyzeRoundAmounts(tx, undefined, { usdPrice: 50_000, eurPrice: 50_000 });
    const usdFinding = findings.find((f) => f.id === "h1-round-usd-amount");
    const eurFinding = findings.find((f) => f.id === "h1-round-eur-amount");
    expect(usdFinding).toBeDefined();
    // EUR finding should NOT fire for this output since USD already covers it
    expect(eurFinding).toBeUndefined();
  });

  it("fires EUR finding for EUR-only matches", () => {
    // Output matches EUR200 but not any USD round amount
    // EUR45,000/BTC: EUR200 = 444,444 sats. USD50,000/BTC: 444,444 sats = $222.22 (not round)
    const sats = Math.round((200 / 45_000) * 100_000_000);
    const tx = makeTx({
      vout: [makeVout({ value: sats }), makeVout({ value: 48_723 })],
    });
    const { findings } = analyzeRoundAmounts(tx, undefined, { usdPrice: 50_000, eurPrice: 45_000 });
    const eurFinding = findings.find((f) => f.id === "h1-round-eur-amount");
    expect(eurFinding).toBeDefined();
  });
});
