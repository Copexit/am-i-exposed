import { describe, it, expect, beforeEach } from "vitest";
import { analyzeDustOutputs, getDustThreshold } from "../dust-output";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeDustOutputs", () => {
  it("detects classic dust attack (1 dust + 2 vout + 1 vin)", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout({ value: 555 }), makeVout({ value: 99_445 })],
    });
    const { findings } = analyzeDustOutputs(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("dust-attack");
    expect(findings[0].scoreImpact).toBe(-8);
    expect(findings[0].severity).toBe("high");
  });

  it("detects batch dust attack (>= 5 dust, > 50% of outputs)", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        makeVout({ value: 300 }),
        makeVout({ value: 400 }),
        makeVout({ value: 500 }),
        makeVout({ value: 600 }),
        makeVout({ value: 700 }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 60_000 }),
      ],
    });
    const { findings } = analyzeDustOutputs(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("dust-attack");
    expect(findings[0].scoreImpact).toBe(-8);
  });

  it("flags non-attack dust with extreme values (< 600 sats) as medium, impact -5", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin()],
      vout: [makeVout({ value: 400 }), makeVout({ value: 50_000 }), makeVout({ value: 49_600 })],
    });
    const { findings } = analyzeDustOutputs(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("dust-outputs");
    expect(findings[0].scoreImpact).toBe(-5);
    expect(findings[0].severity).toBe("medium");
  });

  it("flags non-attack dust without extreme values as low, impact -3", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin()],
      vout: [makeVout({ value: 800 }), makeVout({ value: 50_000 }), makeVout({ value: 49_200 })],
    });
    const { findings } = analyzeDustOutputs(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("dust-outputs");
    expect(findings[0].scoreImpact).toBe(-3);
    expect(findings[0].severity).toBe("low");
  });

  it("returns empty when no dust outputs", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 50_000 }), makeVout({ value: 48_000 })],
    });
    const { findings } = analyzeDustOutputs(tx);
    expect(findings).toHaveLength(0);
  });

  it("skips coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 500 }), makeVout({ value: 624_999_500 })],
    });
    const { findings } = analyzeDustOutputs(tx);
    expect(findings).toHaveLength(0);
  });

  it("flags P2PKH output below 546 sats as economic dust (wallet deficiency)", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin()],
      vout: [
        makeVout({ value: 500, scriptpubkey_type: "p2pkh" }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 49_500 }),
      ],
    });
    const { findings } = analyzeDustOutputs(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("dust-outputs");
    expect(findings[0].severity).toBe("medium");
    expect(findings[0].scoreImpact).toBe(-5);
    expect(findings[0].description).toContain("wallet");
  });

  it("flags P2TR output at 300 sats as economic dust (below 330 threshold)", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin()],
      vout: [
        makeVout({ value: 300, scriptpubkey_type: "v1_p2tr" }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 49_700 }),
      ],
    });
    const { findings } = analyzeDustOutputs(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("dust-outputs");
    expect(findings[0].severity).toBe("medium");
    expect(findings[0].params?.econDustCount).toBe(1);
  });
});

describe("getDustThreshold", () => {
  it("returns 546 for P2PKH", () => expect(getDustThreshold("p2pkh")).toBe(546));
  it("returns 546 for P2SH", () => expect(getDustThreshold("p2sh")).toBe(546));
  it("returns 294 for P2WPKH", () => expect(getDustThreshold("v0_p2wpkh")).toBe(294));
  it("returns 330 for P2WSH", () => expect(getDustThreshold("v0_p2wsh")).toBe(330));
  it("returns 330 for P2TR", () => expect(getDustThreshold("v1_p2tr")).toBe(330));
  it("returns 546 for unknown types", () => expect(getDustThreshold("unknown")).toBe(546));
});
