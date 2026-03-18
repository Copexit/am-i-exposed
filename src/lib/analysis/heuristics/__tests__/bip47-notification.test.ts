import { describe, it, expect, beforeEach } from "vitest";
import { analyzeBip47Notification } from "../bip47-notification";
import { makeTx, makeVin, makeVout, makeCoinbaseVin, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

/** Generate a fake 80-byte (160 hex char) OP_RETURN payload */
function makeNotificationPayload(): string {
  return "a".repeat(160);
}

/** Build a scriptpubkey for OP_RETURN with given hex data */
function makeOpReturnScript(dataHex: string): string {
  const byteLen = dataHex.length / 2;
  if (byteLen <= 0x4b) {
    return "6a" + byteLen.toString(16).padStart(2, "0") + dataHex;
  }
  // OP_PUSHDATA1
  return "6a4c" + byteLen.toString(16).padStart(2, "0") + dataHex;
}

describe("analyzeBip47Notification", () => {
  it("detects BIP47 notification tx with 80-byte OP_RETURN + notification dust + change", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender0000000000000000000000000000001", value: 100_000 } })],
      vout: [
        {
          scriptpubkey: makeOpReturnScript(makeNotificationPayload()),
          scriptpubkey_asm: "",
          scriptpubkey_type: "op_return",
          scriptpubkey_address: "",
          value: 0,
        },
        makeVout({ value: 546 }), // notification dust to receiver
        makeVout({ value: 98_000 }), // toxic change
      ],
      fee: 1_454,
    });

    const { findings } = analyzeBip47Notification(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("bip47-notification");
    expect(findings[0].scoreImpact).toBe(3);
    expect(findings[0].params?._variant).toBe("toxic");
    expect(findings[0].params?.notificationValue).toBe(546);
    expect(findings[0].params?.toxicChangeValue).toBe("98,000");
    expect(findings[0].remediation?.urgency).toBe("immediate");
    // Notification address should be extracted from the dust output
    expect(findings[0].params?.notificationAddress).toBeTruthy();
    expect(typeof findings[0].params?.notificationAddress).toBe("string");
  });

  it("detects notification tx without dust output (change only)", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        {
          scriptpubkey: makeOpReturnScript(makeNotificationPayload()),
          scriptpubkey_asm: "",
          scriptpubkey_type: "op_return",
          scriptpubkey_address: "",
          value: 0,
        },
        makeVout({ value: 50_000 }), // just change, no dust
      ],
    });

    const { findings } = analyzeBip47Notification(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("bip47-notification");
    expect(findings[0].params?._variant).toBe("toxic");
    // No dust output means no notification address
    expect(findings[0].params?.notificationAddress).toBe("");
  });

  it("extracts the notification address from the dust output", () => {
    const notifAddr = "bc1qnotification000000000000000000001";
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        {
          scriptpubkey: makeOpReturnScript(makeNotificationPayload()),
          scriptpubkey_asm: "",
          scriptpubkey_type: "op_return",
          scriptpubkey_address: "",
          value: 0,
        },
        makeVout({ value: 546, scriptpubkey_address: notifAddr }), // notification dust
        makeVout({ value: 90_000 }), // toxic change
      ],
    });

    const { findings } = analyzeBip47Notification(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].params?.notificationAddress).toBe(notifAddr);
  });

  it("rejects coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [
        {
          scriptpubkey: makeOpReturnScript(makeNotificationPayload()),
          scriptpubkey_asm: "",
          scriptpubkey_type: "op_return",
          scriptpubkey_address: "",
          value: 0,
        },
        makeVout({ value: 546 }),
      ],
    });

    const { findings } = analyzeBip47Notification(tx);
    expect(findings).toHaveLength(0);
  });

  it("rejects OP_RETURN with non-80-byte payload", () => {
    // 40 bytes instead of 80
    const shortPayload = "b".repeat(80);
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        {
          scriptpubkey: makeOpReturnScript(shortPayload),
          scriptpubkey_asm: "",
          scriptpubkey_type: "op_return",
          scriptpubkey_address: "",
          value: 0,
        },
        makeVout({ value: 546 }),
        makeVout({ value: 50_000 }),
      ],
    });

    const { findings } = analyzeBip47Notification(tx);
    expect(findings).toHaveLength(0);
  });

  it("rejects transactions with multiple OP_RETURN outputs", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        {
          scriptpubkey: makeOpReturnScript(makeNotificationPayload()),
          scriptpubkey_asm: "",
          scriptpubkey_type: "op_return",
          scriptpubkey_address: "",
          value: 0,
        },
        {
          scriptpubkey: makeOpReturnScript(makeNotificationPayload()),
          scriptpubkey_asm: "",
          scriptpubkey_type: "op_return",
          scriptpubkey_address: "",
          value: 0,
        },
        makeVout({ value: 546 }),
      ],
    });

    const { findings } = analyzeBip47Notification(tx);
    expect(findings).toHaveLength(0);
  });

  it("rejects transactions with too many inputs (>3)", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin(), makeVin(), makeVin()],
      vout: [
        {
          scriptpubkey: makeOpReturnScript(makeNotificationPayload()),
          scriptpubkey_asm: "",
          scriptpubkey_type: "op_return",
          scriptpubkey_address: "",
          value: 0,
        },
        makeVout({ value: 546 }),
      ],
    });

    const { findings } = analyzeBip47Notification(tx);
    expect(findings).toHaveLength(0);
  });

  it("handles notification tx without change (all funds to notification dust)", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender0000000000000000000000000000001", value: 1_000 } })],
      vout: [
        {
          scriptpubkey: makeOpReturnScript(makeNotificationPayload()),
          scriptpubkey_asm: "",
          scriptpubkey_type: "op_return",
          scriptpubkey_address: "",
          value: 0,
        },
        makeVout({ value: 546 }), // notification dust only
      ],
      fee: 454,
    });

    const { findings } = analyzeBip47Notification(tx);
    expect(findings).toHaveLength(1);
    // The 546-sat output is notification dust, and there's no other output, so no toxic change
    // Actually 546 is <= 1000 so it's treated as notification dust, with no change
    expect(findings[0].params?._variant).toBe("clean");
  });
});
