import { describe, it, expect, beforeEach } from "vitest";
import { analyzeCoinbase } from "../coinbase-detection";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeCoinbase", () => {
  it("detects a coinbase transaction", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 625_000_000 })],
    });
    const { findings } = analyzeCoinbase(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("coinbase-transaction");
    expect(findings[0].severity).toBe("low");
    expect(findings[0].scoreImpact).toBe(0);
  });

  it("returns empty findings for a normal transaction", () => {
    const { findings } = analyzeCoinbase(makeTx());
    expect(findings).toHaveLength(0);
  });

  it("returns empty for multi-input even if first is coinbase", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin(), makeVin()],
    });
    const { findings } = analyzeCoinbase(tx);
    expect(findings).toHaveLength(0);
  });
});
