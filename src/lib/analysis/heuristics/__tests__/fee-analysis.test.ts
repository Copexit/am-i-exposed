import { describe, it, expect, beforeEach } from "vitest";
import { analyzeFees } from "../fee-analysis";
import { makeTx, makeVin, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeFees", () => {
  it("detects round fee rate > 5 sat/vB with impact -2", () => {
    // weight=400 -> vsize=100, fee=600 -> 6.0 sat/vB (round)
    const tx = makeTx({ weight: 400, fee: 600 });
    const { findings } = analyzeFees(tx);
    const f = findings.find((f) => f.id === "h6-round-fee-rate");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-2);
    expect(f!.severity).toBe("low");
    expect(f!.params?.feeRate).toBe(6);
  });

  it("does not flag round fee rate <= 5 sat/vB", () => {
    // weight=400 -> vsize=100, fee=500 -> 5.0 sat/vB (round but <= 5)
    const tx = makeTx({ weight: 400, fee: 500 });
    const { findings } = analyzeFees(tx);
    expect(findings.find((f) => f.id === "h6-round-fee-rate")).toBeUndefined();
  });

  it("does not flag non-round fee rate", () => {
    // weight=700 -> vsize=175, fee=1500 -> ~8.57 sat/vB (not round)
    const tx = makeTx({ weight: 700, fee: 1500 });
    const { findings } = analyzeFees(tx);
    expect(findings.find((f) => f.id === "h6-round-fee-rate")).toBeUndefined();
  });

  it("detects RBF signaled (sequence < 0xfffffffe) with impact 0", () => {
    const tx = makeTx({
      vin: [makeVin({ sequence: 0xfffffffd })],
    });
    const { findings } = analyzeFees(tx);
    const f = findings.find((f) => f.id === "h6-rbf-signaled");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(0);
  });

  it("does not flag RBF when sequence >= 0xfffffffe", () => {
    const tx = makeTx({
      vin: [makeVin({ sequence: 0xfffffffe })],
    });
    const { findings } = analyzeFees(tx);
    expect(findings.find((f) => f.id === "h6-rbf-signaled")).toBeUndefined();
  });

  it("returns empty when fee is 0", () => {
    const tx = makeTx({ fee: 0 });
    const { findings } = analyzeFees(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns empty when weight is 0", () => {
    const tx = makeTx({ weight: 0 });
    const { findings } = analyzeFees(tx);
    expect(findings).toHaveLength(0);
  });

  it("can return both round-fee and rbf findings", () => {
    const tx = makeTx({
      weight: 400,
      fee: 600,
      vin: [makeVin({ sequence: 0xfffffffd })],
    });
    const { findings } = analyzeFees(tx);
    expect(findings.find((f) => f.id === "h6-round-fee-rate")).toBeDefined();
    expect(findings.find((f) => f.id === "h6-rbf-signaled")).toBeDefined();
  });

  it("detects fee-in-amount when output + fee = round BTC amount", () => {
    // Output of 999,000 sats + fee 1,000 = 1,000,000 (0.01 BTC - round)
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest", value: 1_500_000 } })],
      vout: [
        { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qpay", value: 999_000 },
        { scriptpubkey: "0014ccc", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qchange", value: 500_000 },
      ],
      fee: 1_000,
    });
    const { findings } = analyzeFees(tx);
    const f = findings.find((f) => f.id === "h6-fee-in-amount");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-1);
  });

  it("does not flag fee-in-amount when no output + fee = round", () => {
    // Both outputs are arbitrary amounts; neither + fee yields a round BTC denomination
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest", value: 850_000 } })],
      vout: [
        { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qpay", value: 543_210 },
        { scriptpubkey: "0014ccc", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qchange", value: 305_290 },
      ],
      fee: 1_500,
    });
    const { findings } = analyzeFees(tx);
    // 543,210 + 1,500 = 544,710 (not round); 305,290 + 1,500 = 306,790 (not round)
    expect(findings.find((f) => f.id === "h6-fee-in-amount")).toBeUndefined();
  });
});
