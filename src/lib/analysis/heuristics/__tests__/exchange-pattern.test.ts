import { describe, it, expect, beforeEach } from "vitest";
import { analyzeExchangePattern } from "../exchange-pattern";
import { makeTx, makeVin, makeVout, makeCoinbaseVin, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeExchangePattern", () => {
  it("detects batch withdrawal: 1 input, 15 outputs with mixed types and unique addresses", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qexch00000000000000000000000000000001", value: 10_000_000 } })],
      vout: [
        // Mix of address types (exchange serves all formats)
        ...Array.from({ length: 5 }, (_, i) =>
          makeVout({ value: (i + 1) * 100_000, scriptpubkey_type: "v0_p2wpkh" }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeVout({ value: (i + 1) * 50_000, scriptpubkey_type: "p2pkh" }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeVout({ value: (i + 1) * 10_000, scriptpubkey_type: "v1_p2tr" }),
        ),
      ],
    });

    const { findings } = analyzeExchangePattern(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("exchange-withdrawal-pattern");
    expect(findings[0].scoreImpact).toBe(-3);
    expect(findings[0].severity).toBe("medium");
  });

  it("rejects coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: Array.from({ length: 15 }, (_, i) =>
        makeVout({ value: (i + 1) * 100_000, scriptpubkey_type: i % 3 === 0 ? "v0_p2wpkh" : i % 3 === 1 ? "p2pkh" : "v1_p2tr" }),
      ),
    });

    const { findings } = analyzeExchangePattern(tx);
    expect(findings).toHaveLength(0);
  });

  it("rejects transactions with fewer than 10 outputs", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: Array.from({ length: 5 }, () => makeVout({ value: 100_000 })),
    });

    const { findings } = analyzeExchangePattern(tx);
    expect(findings).toHaveLength(0);
  });

  it("rejects transactions with 3+ inputs", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin(), makeVin()],
      vout: Array.from({ length: 15 }, (_, i) =>
        makeVout({ value: (i + 1) * 100_000, scriptpubkey_type: i % 3 === 0 ? "v0_p2wpkh" : "p2pkh" }),
      ),
    });

    const { findings } = analyzeExchangePattern(tx);
    expect(findings).toHaveLength(0);
  });

  it("rejects when signals are too few (uniform types + similar values)", () => {
    // All same type, similar values = not an exchange pattern
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest0000000000000000000000000000001", value: 5_000_000 } })],
      vout: Array.from({ length: 12 }, () =>
        makeVout({ value: 100_000, scriptpubkey_type: "v0_p2wpkh" }),
      ),
    });

    const { findings } = analyzeExchangePattern(tx);
    // Only 1 type = no mixed types signal, values all equal = no wide spread
    // Only unique addresses signal, which is 1 < 2 required
    expect(findings).toHaveLength(0);
  });
});
