import { describe, it, expect, beforeEach } from "vitest";
import { analyzeOpReturn } from "../op-return";
import { makeTx, makeCoinbaseVin, makeVout, makeOpReturnVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeOpReturn", () => {
  it("detects a single OP_RETURN with no protocol, impact -5, severity low", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 48_000 }), makeOpReturnVout("cafebabe")],
    });
    const { findings } = analyzeOpReturn(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h7-op-return");
    expect(findings[0].scoreImpact).toBe(-5);
    expect(findings[0].severity).toBe("low");
  });

  it("detects Omni Layer protocol with impact -8, severity medium", () => {
    // "omni" in hex = 6f6d6e69
    // The scriptpubkey is "6a" + pushbyte + data. We need the data after extraction to start with 6f6d6e69.
    // Construct the scriptpubkey manually for Omni: 6a + push length + 6f6d6e69...
    const omniVout = {
      scriptpubkey: "6a146f6d6e690000000000000001000000003b9aca00",
      scriptpubkey_asm: "OP_RETURN OP_PUSHBYTES_20 6f6d6e690000000000000001000000003b9aca00",
      scriptpubkey_type: "op_return" as const,
      value: 0,
    };
    const tx2 = makeTx({ vout: [makeVout({ value: 48_000 }), omniVout] });
    const { findings } = analyzeOpReturn(tx2);
    expect(findings).toHaveLength(1);
    expect(findings[0].scoreImpact).toBe(-8);
    expect(findings[0].severity).toBe("medium");
  });

  it("detects Runes protocol (6a5d prefix)", () => {
    const runesVout = {
      scriptpubkey: "6a5d0114e80700",
      scriptpubkey_asm: "OP_RETURN OP_13 ...",
      scriptpubkey_type: "op_return" as const,
      value: 0,
    };
    const tx = makeTx({ vout: [makeVout({ value: 48_000 }), runesVout] });
    const { findings } = analyzeOpReturn(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].scoreImpact).toBe(-8);
    expect(findings[0].severity).toBe("medium");
  });

  it("produces indexed IDs for multiple OP_RETURN outputs", () => {
    const tx = makeTx({
      vout: [
        makeVout({ value: 48_000 }),
        makeOpReturnVout("aabb"),
        makeOpReturnVout("ccdd"),
      ],
    });
    const { findings } = analyzeOpReturn(tx);
    expect(findings).toHaveLength(2);
    expect(findings[0].id).toBe("h7-op-return-0");
    expect(findings[1].id).toBe("h7-op-return-1");
  });

  it("returns empty when no OP_RETURN outputs exist", () => {
    const { findings } = analyzeOpReturn(makeTx());
    expect(findings).toHaveLength(0);
  });

  it("skips coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 625_000_000 }), makeOpReturnVout("aa")],
    });
    const { findings } = analyzeOpReturn(tx);
    expect(findings).toHaveLength(0);
  });
});
