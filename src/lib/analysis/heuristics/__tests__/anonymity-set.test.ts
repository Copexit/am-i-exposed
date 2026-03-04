import { describe, it, expect, beforeEach } from "vitest";
import { analyzeAnonymitySet } from "../anonymity-set";
import { makeTx, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeAnonymitySet", () => {
  it("detects strong anonymity set (5+ equal outputs), impact +5", () => {
    const tx = makeTx({
      vout: Array.from({ length: 5 }, () => makeVout({ value: 5_000_000 })),
    });
    const { findings } = analyzeAnonymitySet(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("anon-set-strong");
    expect(findings[0].scoreImpact).toBe(5);
    expect(findings[0].severity).toBe("good");
  });

  it("detects moderate anonymity set (2-4 equal outputs), impact +1", () => {
    const tx = makeTx({
      vout: [
        makeVout({ value: 50_000 }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 30_000 }),
      ],
    });
    const { findings } = analyzeAnonymitySet(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("anon-set-moderate");
    expect(findings[0].scoreImpact).toBe(1);
    expect(findings[0].severity).toBe("low");
  });

  it("flags all unique outputs with impact -1", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 50_000 }), makeVout({ value: 30_000 })],
    });
    const { findings } = analyzeAnonymitySet(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("anon-set-none");
    expect(findings[0].scoreImpact).toBe(0);
    expect(findings[0].severity).toBe("low");
  });

  it("returns empty for < 2 spendable outputs", () => {
    const tx = makeTx({ vout: [makeVout({ value: 50_000 })] });
    const { findings } = analyzeAnonymitySet(tx);
    expect(findings).toHaveLength(0);
  });

  it("skips coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 50_000 }), makeVout({ value: 50_000 })],
    });
    const { findings } = analyzeAnonymitySet(tx);
    expect(findings).toHaveLength(0);
  });

  it("excludes dust outputs from anonymity set calculation", () => {
    // Two equal dust outputs (< 1000 sats) should not count as an anonymity set
    const tx = makeTx({
      vout: [
        makeVout({ value: 500 }),
        makeVout({ value: 500 }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 30_000 }),
      ],
    });
    const { findings } = analyzeAnonymitySet(tx);
    // Only 50k and 30k are non-dust, both unique -> anon-set-none
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("anon-set-none");
  });

  it("does not inflate anonymity set with dust matching real outputs", () => {
    // A dust output matching a real output value shouldn't inflate the set
    const tx = makeTx({
      vout: [
        makeVout({ value: 50_000 }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 999 }), // dust, should be excluded
      ],
    });
    const { findings } = analyzeAnonymitySet(tx);
    // Two equal 50k outputs = moderate anonymity set
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("anon-set-moderate");
    expect(findings[0].params?.count).toBe(2);
  });
});
