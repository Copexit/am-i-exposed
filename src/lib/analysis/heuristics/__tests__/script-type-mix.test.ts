import { describe, it, expect, beforeEach } from "vitest";
import { analyzeScriptTypeMix } from "../script-type-mix";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeScriptTypeMix", () => {
  it("detects bare multisig output with impact -8, severity high", () => {
    const tx = makeTx({
      vout: [
        makeVout({ value: 50_000, scriptpubkey_type: "multisig" }),
        makeVout({ value: 48_000 }),
      ],
    });
    const { findings } = analyzeScriptTypeMix(tx);
    const ms = findings.find((f) => f.id === "script-multisig");
    expect(ms).toBeDefined();
    expect(ms!.scoreImpact).toBe(-8);
    expect(ms!.severity).toBe("high");
  });

  it("detects uniform script types with impact +2, severity good", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest1", value: 100_000 } })],
      vout: [
        makeVout({ value: 50_000, scriptpubkey_type: "v0_p2wpkh" }),
        makeVout({ value: 48_000, scriptpubkey_type: "v0_p2wpkh" }),
      ],
    });
    const { findings } = analyzeScriptTypeMix(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("script-uniform");
    expect(findings[0].scoreImpact).toBe(2);
    expect(findings[0].severity).toBe("good");
  });

  it("detects 3+ script types with impact -3, severity medium", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest1", value: 100_000 } })],
      vout: [
        makeVout({ value: 50_000, scriptpubkey_type: "v1_p2tr" }),
        makeVout({ value: 30_000, scriptpubkey_type: "p2pkh" }),
      ],
    });
    const { findings } = analyzeScriptTypeMix(tx);
    const mixed = findings.find((f) => f.id === "script-mixed");
    expect(mixed).toBeDefined();
    expect(mixed!.scoreImpact).toBe(-3);
    expect(mixed!.severity).toBe("medium");
  });

  it("detects 2 script types with impact -1, severity low", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest1", value: 100_000 } })],
      vout: [
        makeVout({ value: 50_000, scriptpubkey_type: "v0_p2wpkh" }),
        makeVout({ value: 30_000, scriptpubkey_type: "v1_p2tr" }),
      ],
    });
    const { findings } = analyzeScriptTypeMix(tx);
    const mixed = findings.find((f) => f.id === "script-mixed");
    expect(mixed).toBeDefined();
    expect(mixed!.scoreImpact).toBe(-1);
    expect(mixed!.severity).toBe("low");
  });

  it("skips coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 50_000 }), makeVout({ value: 48_000 })],
    });
    const { findings } = analyzeScriptTypeMix(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns only multisig finding for single-output tx", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 50_000, scriptpubkey_type: "multisig" })],
    });
    const { findings } = analyzeScriptTypeMix(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("script-multisig");
  });
});
