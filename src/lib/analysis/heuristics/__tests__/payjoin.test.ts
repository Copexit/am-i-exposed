import { describe, it, expect, beforeEach } from "vitest";
import { analyzePayJoin } from "../payjoin";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzePayJoin", () => {
  it("detects PayJoin with 2 inputs from different addresses and 2 outputs", () => {
    // PayJoin: sender pays 100k to receiver who already has a 50k UTXO.
    // Sender input: 300k sats (dominant contributor)
    // Receiver input: 50k sats (receiver adds their UTXO)
    // Output 0: 150k (receiver gets 100k payment + their 50k input)
    // Output 1: 198.5k (sender's change: 300k - 100k - 1.5k fee)
    // Probable amount (naive): min(150k, 198.5k) = 150k
    // Real amount: 150k - 50k = 100k
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender0000000000000000000000000000001", value: 300_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qreceiver000000000000000000000000000001", value: 50_000 } }),
      ],
      vout: [
        makeVout({ value: 150_000 }),
        makeVout({ value: 198_500 }),
      ],
      fee: 1_500,
    });
    const { findings } = analyzePayJoin(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h4-payjoin");
    expect(findings[0].scoreImpact).toBe(10);
    expect(findings[0].severity).toBe("good");
    expect(findings[0].params?.probableAmount).toBe(150_000);
    expect(findings[0].params?.realAmountEstimate).toBe(100_000);
  });

  it("gives higher impact for mixed script types", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender0000000000000000000000000000001", value: 300_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "p2pkh", scriptpubkey_address: "1ReceiverAddr000000000000000000000001", value: 50_000 } }),
      ],
      vout: [
        makeVout({ value: 150_000 }),
        makeVout({ value: 198_500 }),
      ],
      fee: 1_500,
    });
    const { findings } = analyzePayJoin(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].scoreImpact).toBe(12);
    expect(findings[0].params?.mixedTypes).toBe(1);
  });

  it("rejects single-input transactions", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout(), makeVout({ value: 50_000 })],
    });
    const { findings } = analyzePayJoin(tx);
    expect(findings).toHaveLength(0);
  });

  it("rejects transactions with 3+ outputs", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender0000000000000000000000000000001", value: 300_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qreceiver000000000000000000000000000001", value: 50_000 } }),
      ],
      vout: [makeVout({ value: 150_000 }), makeVout({ value: 100_000 }), makeVout({ value: 98_500 })],
      fee: 1_500,
    });
    const { findings } = analyzePayJoin(tx);
    expect(findings).toHaveLength(0);
  });

  it("rejects when receiver contribution is dust", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender0000000000000000000000000000001", value: 300_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qreceiver000000000000000000000000000001", value: 5_000 } }),
      ],
      vout: [makeVout({ value: 150_000 }), makeVout({ value: 153_500 })],
      fee: 1_500,
    });
    const { findings } = analyzePayJoin(tx);
    expect(findings).toHaveLength(0);
  });

  it("rejects when all inputs are from the same address", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsame000000000000000000000000000000001", value: 300_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsame000000000000000000000000000000001", value: 50_000 } }),
      ],
      vout: [makeVout({ value: 150_000 }), makeVout({ value: 198_500 })],
      fee: 1_500,
    });
    const { findings } = analyzePayJoin(tx);
    expect(findings).toHaveLength(0);
  });

  it("accepts equal-contribution PayJoin", () => {
    // Both parties contribute equally - still a valid PayJoin
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender0000000000000000000000000000001", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qreceiver000000000000000000000000000001", value: 50_000 } }),
      ],
      vout: [makeVout({ value: 80_000 }), makeVout({ value: 18_500 })],
      fee: 1_500,
    });
    const { findings } = analyzePayJoin(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h4-payjoin");
  });
});
