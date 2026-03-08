import { describe, it, expect, beforeEach } from "vitest";
import { analyzeBackward } from "../backward";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";

beforeEach(() => resetAddrCounter());

describe("analyzeBackward", () => {
  it("detects CoinJoin input provenance", () => {
    const denom = WHIRLPOOL_DENOMS[0];
    const whirlpoolTx = makeTx({
      vin: Array.from({ length: 5 }, () => makeVin({ vout: 0 })),
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });

    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout()],
    });

    const parentTxs = new Map([[0, whirlpoolTx]]);
    const { findings, coinJoinInputs } = analyzeBackward(tx, parentTxs);

    expect(coinJoinInputs).toContain(0);
    expect(findings.some((f) => f.id === "chain-coinjoin-input")).toBe(true);
    const cjFinding = findings.find((f) => f.id === "chain-coinjoin-input")!;
    expect(cjFinding.severity).toBe("good");
    expect(cjFinding.scoreImpact).toBe(8);
  });

  it("detects exchange batch withdrawal input", () => {
    // Exchange batch: 1 input, 15 outputs, mixed types
    const exchangeTx = makeTx({
      vin: [makeVin()],
      vout: [
        ...Array.from({ length: 5 }, () => makeVout({ scriptpubkey_type: "v0_p2wpkh" })),
        ...Array.from({ length: 5 }, () => makeVout({ scriptpubkey_type: "v1_p2tr" })),
        ...Array.from({ length: 5 }, () => makeVout({ scriptpubkey_type: "p2pkh" })),
      ],
    });

    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout()],
    });

    const parentTxs = new Map([[0, exchangeTx]]);
    const { findings, exchangeInputs } = analyzeBackward(tx, parentTxs);

    expect(exchangeInputs).toContain(0);
    expect(findings.some((f) => f.id === "chain-exchange-input")).toBe(true);
  });

  it("detects dust attack input", () => {
    // Dust attack parent: many tiny outputs to diverse addresses
    const dustParent = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender", value: 50_000 } })],
      vout: Array.from({ length: 15 }, () => makeVout({ value: 546 })),
    });

    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtarget", value: 546 } })],
      vout: [makeVout()],
    });

    const parentTxs = new Map([[0, dustParent]]);
    const { findings, dustInputs } = analyzeBackward(tx, parentTxs);

    expect(dustInputs).toContain(0);
    expect(findings.some((f) => f.id === "chain-dust-input")).toBe(true);
    const dustFinding = findings.find((f) => f.id === "chain-dust-input")!;
    expect(dustFinding.severity).toBe("critical");
    expect(dustFinding.scoreImpact).toBe(-10);
  });

  it("returns empty results for normal parent tx", () => {
    const normalParent = makeTx({
      vin: [makeVin()],
      vout: [makeVout(), makeVout()],
    });

    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout()],
    });

    const parentTxs = new Map([[0, normalParent]]);
    const { findings, coinJoinInputs, exchangeInputs, dustInputs } = analyzeBackward(tx, parentTxs);

    expect(findings).toHaveLength(0);
    expect(coinJoinInputs).toHaveLength(0);
    expect(exchangeInputs).toHaveLength(0);
    expect(dustInputs).toHaveLength(0);
  });

  it("handles empty parent map", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout()],
    });

    const { findings } = analyzeBackward(tx, new Map());
    expect(findings).toHaveLength(0);
  });
});
