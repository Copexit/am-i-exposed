import { describe, it, expect, beforeEach } from "vitest";
import { analyzeRoundAmounts } from "../round-amount";
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
});
