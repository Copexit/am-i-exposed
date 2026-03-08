import { describe, it, expect, beforeEach } from "vitest";
import { analyzeRecurringPayment } from "../recurring-payment";
import { makeTx, makeVin, makeVout, makeAddress, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

const TARGET_ADDR = "bc1qtarget000000000000000000000000000001";
const SENDER_ADDR = "bc1qsender000000000000000000000000000001";

describe("analyzeRecurringPayment", () => {
  it("detects recurring payment from same sender (2 txs)", () => {
    const addr = makeAddress({ address: TARGET_ADDR });
    const txs = [
      makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: SENDER_ADDR, value: 100_000 } })],
        vout: [makeVout({ value: 50_000, scriptpubkey_address: TARGET_ADDR })],
      }),
      makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: SENDER_ADDR, value: 100_000 } })],
        vout: [makeVout({ value: 60_000, scriptpubkey_address: TARGET_ADDR })],
      }),
    ];

    const { findings } = analyzeRecurringPayment(addr, [], txs);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("recurring-payment-pattern");
    expect(findings[0].scoreImpact).toBe(-5);
    expect(findings[0].params?.maxFrequency).toBe(2);
  });

  it("detects high frequency recurring payment (10+ times)", () => {
    const addr = makeAddress({ address: TARGET_ADDR });
    const txs = Array.from({ length: 12 }, () =>
      makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: SENDER_ADDR, value: 100_000 } })],
        vout: [makeVout({ value: 50_000, scriptpubkey_address: TARGET_ADDR })],
      }),
    );

    const { findings } = analyzeRecurringPayment(addr, [], txs);
    expect(findings).toHaveLength(1);
    expect(findings[0].scoreImpact).toBe(-10);
    expect(findings[0].severity).toBe("critical");
  });

  it("detects recurring send to same receiver", () => {
    const receiverAddr = "bc1qreceiver0000000000000000000000000001";
    const addr = makeAddress({ address: TARGET_ADDR });
    const txs = [
      makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: TARGET_ADDR, value: 100_000 } })],
        vout: [makeVout({ value: 50_000, scriptpubkey_address: receiverAddr })],
      }),
      makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: TARGET_ADDR, value: 100_000 } })],
        vout: [makeVout({ value: 60_000, scriptpubkey_address: receiverAddr })],
      }),
    ];

    const { findings } = analyzeRecurringPayment(addr, [], txs);
    expect(findings).toHaveLength(1);
    expect(findings[0].params?.sendRecurring).toBe(1);
  });

  it("does not fire with only 1 transaction", () => {
    const addr = makeAddress({ address: TARGET_ADDR });
    const txs = [
      makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: SENDER_ADDR, value: 100_000 } })],
        vout: [makeVout({ value: 50_000, scriptpubkey_address: TARGET_ADDR })],
      }),
    ];

    const { findings } = analyzeRecurringPayment(addr, [], txs);
    expect(findings).toHaveLength(0);
  });

  it("does not fire when all counterparties are unique", () => {
    const addr = makeAddress({ address: TARGET_ADDR });
    const txs = [
      makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qunique1" + "0".repeat(29), value: 100_000 } })],
        vout: [makeVout({ value: 50_000, scriptpubkey_address: TARGET_ADDR })],
      }),
      makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qunique2" + "0".repeat(29), value: 100_000 } })],
        vout: [makeVout({ value: 50_000, scriptpubkey_address: TARGET_ADDR })],
      }),
    ];

    const { findings } = analyzeRecurringPayment(addr, [], txs);
    expect(findings).toHaveLength(0);
  });

  it("medium frequency (4 times) gets -7 impact", () => {
    const addr = makeAddress({ address: TARGET_ADDR });
    const txs = Array.from({ length: 5 }, () =>
      makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: SENDER_ADDR, value: 100_000 } })],
        vout: [makeVout({ value: 50_000, scriptpubkey_address: TARGET_ADDR })],
      }),
    );

    const { findings } = analyzeRecurringPayment(addr, [], txs);
    expect(findings).toHaveLength(1);
    expect(findings[0].scoreImpact).toBe(-7);
    expect(findings[0].severity).toBe("high");
  });
});
