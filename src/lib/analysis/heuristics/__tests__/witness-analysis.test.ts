import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWitnessData } from "../witness-analysis";
import { makeTx, makeVin, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeWitnessData", () => {
  it("returns empty for legacy tx without witness data", () => {
    const tx = makeTx({
      vin: [
        makeVin({ witness: undefined }),
        makeVin({ witness: undefined }),
      ],
    });
    const { findings } = analyzeWitnessData(tx);
    expect(findings).toHaveLength(0);
  });

  it("detects mixed witness and non-witness inputs", () => {
    const tx = makeTx({
      vin: [
        makeVin({ witness: ["3044022020" + "00".repeat(30) + "0220" + "00".repeat(30), "02" + "aa".repeat(32)] }),
        makeVin({ witness: undefined }),
      ],
    });
    const { findings } = analyzeWitnessData(tx);
    const f = findings.find((f) => f.id === "witness-mixed-types");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-1);
    expect(f!.params?.witnessCount).toBe(1);
    expect(f!.params?.nonWitnessCount).toBe(1);
  });

  it("detects unusual witness stack depth (> 4)", () => {
    const tx = makeTx({
      vin: [
        makeVin({
          witness: ["", "sig1", "sig2", "sig3", "redeemscript", "extra"],
        }),
      ],
    });
    const { findings } = analyzeWitnessData(tx);
    const f = findings.find((f) => f.id === "witness-deep-stack");
    expect(f).toBeDefined();
    expect(f!.params?.maxDepth).toBe(6);
  });

  it("detects mixed witness stack depths", () => {
    const tx = makeTx({
      vin: [
        makeVin({ witness: ["sig", "pubkey"] }), // depth 2
        makeVin({ witness: ["", "sig1", "sig2", "redeemscript"] }), // depth 4
      ],
    });
    const { findings } = analyzeWitnessData(tx);
    const f = findings.find((f) => f.id === "witness-mixed-depths");
    expect(f).toBeDefined();
  });

  it("detects mixed Schnorr and ECDSA signatures", () => {
    const tx = makeTx({
      vin: [
        makeVin({
          prevout: {
            scriptpubkey: "5120" + "aa".repeat(32),
            scriptpubkey_asm: "",
            scriptpubkey_type: "v1_p2tr",
            scriptpubkey_address: "bc1ptestaddr",
            value: 100_000,
          },
          witness: ["schnorr_sig_64_bytes"],
        }),
        makeVin({
          prevout: {
            scriptpubkey: "0014" + "bb".repeat(20),
            scriptpubkey_asm: "",
            scriptpubkey_type: "v0_p2wpkh",
            scriptpubkey_address: "bc1qtestaddr",
            value: 100_000,
          },
          witness: ["ecdsa_sig", "pubkey"],
        }),
      ],
    });
    const { findings } = analyzeWitnessData(tx);
    const f = findings.find((f) => f.id === "witness-mixed-sig-types");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
    expect(f!.scoreImpact).toBe(-2);
    expect(f!.params?.taprootCount).toBe(1);
    expect(f!.params?.ecdsaCount).toBe(1);
  });

  it("skips coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeVin({ is_coinbase: true, witness: ["commitment"] })],
    });
    const { findings } = analyzeWitnessData(tx);
    expect(findings).toHaveLength(0);
  });

  it("does not flag normal P2WPKH with uniform 2-item witness", () => {
    const tx = makeTx({
      vin: [
        makeVin({ witness: ["sig1", "pubkey1"] }),
        makeVin({ witness: ["sig2", "pubkey2"] }),
      ],
    });
    const { findings } = analyzeWitnessData(tx);
    // Should not have witness-uniform-size for standard P2WPKH
    expect(findings.find((f) => f.id === "witness-uniform-size")).toBeUndefined();
    // Should not have mixed depths either since all are depth 2
    expect(findings.find((f) => f.id === "witness-mixed-depths")).toBeUndefined();
  });
});
