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
    expect(findings[0].scoreImpact).toBe(-1);
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
});
