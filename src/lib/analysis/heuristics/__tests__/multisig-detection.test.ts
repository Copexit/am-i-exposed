import { describe, it, expect, beforeEach } from "vitest";
import { analyzeMultisigDetection } from "../multisig-detection";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

// Compressed pubkey hex (33 bytes = 66 hex chars)
const PUB1 = "02" + "aa".repeat(32);
const PUB2 = "03" + "bb".repeat(32);
const PUB3 = "02" + "cc".repeat(32);
const PUB4 = "03" + "dd".repeat(32);
const PUB5 = "02" + "ee".repeat(32);

function makeMultisigAsm(m: number, keys: string[]): string {
  const keyParts = keys.map((k) => `OP_PUSHBYTES_33 ${k}`).join(" ");
  return `OP_PUSHNUM_${m} ${keyParts} OP_PUSHNUM_${keys.length} OP_CHECKMULTISIG`;
}

const HODLHODL_FEE = "bc1qqmmzt02nu4rqxe03se2zqpw63k0khnwq959zxq";
const BISQ_TAKER_FEE = "bc1qwxsnvnt7724gg02q624q2pknaqjaaj0vff36vr";
const BISQ_MAKER_FEE = "bc1qfy0hw3txwtkr6xrhk965vjkqqcdn5vx2lrt64a";

describe("analyzeMultisigDetection", () => {
  it("detects HodlHodl escrow release (2-of-3 + known fee address)", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({
          sequence: 0xffffffff,
          prevout: {
            scriptpubkey: "",
            scriptpubkey_asm: "",
            scriptpubkey_type: "p2sh",
            scriptpubkey_address: "3" + "0".repeat(33),
            value: 100_000,
          },
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2, PUB3]),
          inner_redeemscript_asm: "OP_0 OP_PUSHBYTES_32 " + "ff".repeat(32),
        }),
      ],
      vout: [
        makeVout({ value: 90_000 }),
        makeVout({
          value: 696,
          scriptpubkey_address: HODLHODL_FEE,
        }),
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-hodlhodl");
    expect(findings[0].severity).toBe("high");
    expect(findings[0].scoreImpact).toBe(-3);
    expect(findings[0].remediation).toBeDefined();
  });

  it("detects 2-of-3 escrow without fee address match", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({
          sequence: 0xffffffff,
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2, PUB3]),
        }),
      ],
      vout: [
        makeVout({ value: 90_000 }),
        makeVout({ value: 5_000 }),
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-escrow-2of3");
    expect(findings[0].severity).toBe("medium");
    expect(findings[0].scoreImpact).toBe(-2);
  });

  it("detects Bisq escrow release (2-of-2 + known taker fee address)", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({
          sequence: 0xffffffff,
          prevout: {
            scriptpubkey: "",
            scriptpubkey_asm: "",
            scriptpubkey_type: "p2wsh",
            scriptpubkey_address: "bc1q" + "0".repeat(58),
            value: 200_000,
          },
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2]),
        }),
      ],
      vout: [
        makeVout({ value: 190_000 }),
        makeVout({
          value: 5_000,
          scriptpubkey_address: BISQ_TAKER_FEE,
        }),
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-bisq");
    expect(findings[0].severity).toBe("high");
    expect(findings[0].scoreImpact).toBe(-3);
    expect(findings[0].params?.feeAddress).toBe(BISQ_TAKER_FEE);
    expect(findings[0].remediation).toBeDefined();
  });

  it("detects Bisq with maker fee address", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({
          sequence: 0xffffffff,
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2]),
        }),
      ],
      vout: [
        makeVout({ value: 190_000 }),
        makeVout({
          value: 3_000,
          scriptpubkey_address: BISQ_MAKER_FEE,
        }),
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-bisq");
    expect(findings[0].params?.feeAddress).toBe(BISQ_MAKER_FEE);
  });

  it("detects 2-of-2 escrow (generic, no Bisq fee match)", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({
          sequence: 0xffffffff,
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2]),
        }),
      ],
      vout: [
        makeVout({ value: 60_000 }),
        makeVout({ value: 35_000 }),
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-escrow-2of2");
    expect(findings[0].severity).toBe("medium");
    expect(findings[0].scoreImpact).toBe(-2);
    expect(findings[0].params?.likelyLN).toBe(0);
  });

  it("detects 2-of-2 with LN-like metadata (locktime > 0)", () => {
    const tx = makeTx({
      version: 2,
      locktime: 850000,
      vin: [
        makeVin({
          sequence: 0xfffffffd,
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2]),
        }),
      ],
      vout: [
        makeVout({ value: 60_000 }),
        makeVout({ value: 35_000 }),
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("lightning-channel-legacy");
    expect(findings[0].params?.likelyLN).toBe(1);
  });

  it("detects generic M-of-N (3-of-5 enterprise multisig)", () => {
    const tx = makeTx({
      vin: [
        makeVin({
          inner_witnessscript_asm: makeMultisigAsm(3, [PUB1, PUB2, PUB3, PUB4, PUB5]),
        }),
      ],
      vout: [
        makeVout({ value: 80_000 }),
        makeVout({ value: 15_000 }),
        makeVout({ value: 3_000 }),
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-multisig-info");
    expect(findings[0].severity).toBe("low");
    expect(findings[0].scoreImpact).toBe(0);
    expect(findings[0].params?.m).toBe(3);
    expect(findings[0].params?.n).toBe(5);
  });

  it("returns empty for non-multisig transaction", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout(), makeVout()],
    });
    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns empty for coinbase transaction", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 625_000_000 })],
    });
    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(0);
  });

  // ── HodlHodl fee-pattern fallback ──────────────────────────────────

  it("detects HodlHodl via fee pattern (0.8% of input, no known address)", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({
          sequence: 0xffffffff,
          prevout: {
            scriptpubkey: "",
            scriptpubkey_asm: "",
            scriptpubkey_type: "p2sh",
            scriptpubkey_address: "3" + "a".repeat(33),
            value: 100_000,
          },
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2, PUB3]),
          inner_redeemscript_asm: "OP_0 OP_PUSHBYTES_32 " + "ff".repeat(32),
        }),
      ],
      vout: [
        makeVout({ value: 98_800 }),
        makeVout({ value: 800 }), // 0.8% of input
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-hodlhodl");
    expect(findings[0].confidence).toBe("medium");
  });

  it("detects HodlHodl via fee pattern at 0.45% (referral rate)", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({
          sequence: 0xffffffff,
          prevout: {
            scriptpubkey: "",
            scriptpubkey_asm: "",
            scriptpubkey_type: "p2sh",
            scriptpubkey_address: "3" + "b".repeat(33),
            value: 200_000,
          },
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2, PUB3]),
          inner_redeemscript_asm: "OP_0 OP_PUSHBYTES_32 " + "ff".repeat(32),
        }),
      ],
      vout: [
        makeVout({ value: 198_800 }),
        makeVout({ value: 900 }), // 0.45% of input
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-hodlhodl");
    expect(findings[0].confidence).toBe("medium");
  });

  it("detects HodlHodl via fee pattern at 1.0% (combined max fees)", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({
          sequence: 0xffffffff,
          prevout: {
            scriptpubkey: "",
            scriptpubkey_asm: "",
            scriptpubkey_type: "p2sh",
            scriptpubkey_address: "3" + "c".repeat(33),
            value: 100_000,
          },
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2, PUB3]),
          inner_redeemscript_asm: "OP_0 OP_PUSHBYTES_32 " + "ff".repeat(32),
        }),
      ],
      vout: [
        makeVout({ value: 98_700 }),
        makeVout({ value: 1_000 }), // 1.0% of input
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-hodlhodl");
    expect(findings[0].confidence).toBe("medium");
  });

  it("does NOT trigger HodlHodl fee pattern at 2% (too high)", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({
          sequence: 0xffffffff,
          prevout: {
            scriptpubkey: "",
            scriptpubkey_asm: "",
            scriptpubkey_type: "p2sh",
            scriptpubkey_address: "3" + "d".repeat(33),
            value: 100_000,
          },
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2, PUB3]),
          inner_redeemscript_asm: "OP_0 OP_PUSHBYTES_32 " + "ff".repeat(32),
        }),
      ],
      vout: [
        makeVout({ value: 97_500 }),
        makeVout({ value: 2_000 }), // 2.0% - too high
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-escrow-2of3"); // generic fallback
  });

  it("does NOT trigger HodlHodl fee pattern at 0.2% (too low)", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({
          sequence: 0xffffffff,
          prevout: {
            scriptpubkey: "",
            scriptpubkey_asm: "",
            scriptpubkey_type: "p2sh",
            scriptpubkey_address: "3" + "e".repeat(33),
            value: 100_000,
          },
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2, PUB3]),
          inner_redeemscript_asm: "OP_0 OP_PUSHBYTES_32 " + "ff".repeat(32),
        }),
      ],
      vout: [
        makeVout({ value: 99_500 }),
        makeVout({ value: 200 }), // 0.2% - too low
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-escrow-2of3"); // generic fallback
  });

  it("does NOT trigger HodlHodl fee pattern when fee > absolute cap", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({
          sequence: 0xffffffff,
          prevout: {
            scriptpubkey: "",
            scriptpubkey_asm: "",
            scriptpubkey_type: "p2sh",
            scriptpubkey_address: "3" + "f".repeat(33),
            value: 20_000_000, // 0.2 BTC
          },
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2, PUB3]),
          inner_redeemscript_asm: "OP_0 OP_PUSHBYTES_32 " + "ff".repeat(32),
        }),
      ],
      vout: [
        makeVout({ value: 19_800_000 }),
        makeVout({ value: 200_000 }), // 1.0% but 200k sats > abs cap
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-escrow-2of3");
  });

  it("does NOT trigger HodlHodl fee pattern with 3 outputs", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({
          sequence: 0xffffffff,
          prevout: {
            scriptpubkey: "",
            scriptpubkey_asm: "",
            scriptpubkey_type: "p2sh",
            scriptpubkey_address: "3" + "1".repeat(33),
            value: 100_000,
          },
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2, PUB3]),
          inner_redeemscript_asm: "OP_0 OP_PUSHBYTES_32 " + "ff".repeat(32),
        }),
      ],
      vout: [
        makeVout({ value: 88_000 }),
        makeVout({ value: 10_000 }),
        makeVout({ value: 800 }), // 3 outputs - fee pattern requires exactly 2
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-escrow-2of3");
  });

  // ── Bisq deposit OP_RETURN detection ─────────────────────────────

  it("detects Bisq deposit (P2WSH + 20-byte OP_RETURN, 2 inputs)", () => {
    const contractHash = "aa".repeat(20); // 20 bytes = 40 hex
    const tx = makeTx({
      version: 1,
      vin: [makeVin(), makeVin()],
      vout: [
        makeVout({ value: 500_000, scriptpubkey_type: "v0_p2wsh" }),
        {
          scriptpubkey: "6a14" + contractHash,
          scriptpubkey_asm: "OP_RETURN OP_PUSHBYTES_20 " + contractHash,
          scriptpubkey_type: "op_return",
          scriptpubkey_address: undefined as unknown as string,
          value: 0,
        },
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-bisq-deposit");
    expect(findings[0].confidence).toBe("high");
    expect(findings[0].params?.contractHash).toBe(contractHash);
  });

  it("detects Bisq deposit with change output (3 non-OP_RETURN = too many, but 2 non-OP_RETURN + OP_RETURN = 3 total OK)", () => {
    const contractHash = "bb".repeat(20);
    const tx = makeTx({
      version: 1,
      vin: [makeVin(), makeVin()],
      vout: [
        makeVout({ value: 400_000, scriptpubkey_type: "v0_p2wsh" }),
        makeVout({ value: 50_000, scriptpubkey_type: "v0_p2wpkh" }), // change
        {
          scriptpubkey: "6a14" + contractHash,
          scriptpubkey_asm: "OP_RETURN OP_PUSHBYTES_20 " + contractHash,
          scriptpubkey_type: "op_return",
          scriptpubkey_address: undefined as unknown as string,
          value: 0,
        },
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-bisq-deposit");
  });

  it("detects Bisq deposit with P2SH output (legacy Bisq)", () => {
    const contractHash = "cc".repeat(20);
    const tx = makeTx({
      version: 1,
      vin: [makeVin(), makeVin()],
      vout: [
        makeVout({ value: 300_000, scriptpubkey_type: "p2sh" }),
        {
          scriptpubkey: "6a14" + contractHash,
          scriptpubkey_asm: "OP_RETURN OP_PUSHBYTES_20 " + contractHash,
          scriptpubkey_type: "op_return",
          scriptpubkey_address: undefined as unknown as string,
          value: 0,
        },
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-bisq-deposit");
  });

  it("detects Bisq deposit with 3 inputs (partial fill)", () => {
    const contractHash = "dd".repeat(20);
    const tx = makeTx({
      version: 1,
      vin: [makeVin(), makeVin(), makeVin()],
      vout: [
        makeVout({ value: 600_000, scriptpubkey_type: "v0_p2wsh" }),
        {
          scriptpubkey: "6a14" + contractHash,
          scriptpubkey_asm: "OP_RETURN OP_PUSHBYTES_20 " + contractHash,
          scriptpubkey_type: "op_return",
          scriptpubkey_address: undefined as unknown as string,
          value: 0,
        },
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-bisq-deposit");
  });

  it("does NOT trigger Bisq deposit with 32-byte OP_RETURN (wrong hash length)", () => {
    const wrongHash = "ee".repeat(32); // 32 bytes, not 20
    const tx = makeTx({
      version: 1,
      vin: [makeVin(), makeVin()],
      vout: [
        makeVout({ value: 500_000, scriptpubkey_type: "v0_p2wsh" }),
        {
          scriptpubkey: "6a20" + wrongHash,
          scriptpubkey_asm: "OP_RETURN OP_PUSHBYTES_32 " + wrongHash,
          scriptpubkey_type: "op_return",
          scriptpubkey_address: undefined as unknown as string,
          value: 0,
        },
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings.some((f) => f.id === "h17-bisq-deposit")).toBe(false);
  });

  it("does NOT trigger Bisq deposit with P2WPKH output (no multisig output)", () => {
    const contractHash = "ff".repeat(20);
    const tx = makeTx({
      version: 1,
      vin: [makeVin(), makeVin()],
      vout: [
        makeVout({ value: 500_000, scriptpubkey_type: "v0_p2wpkh" }),
        {
          scriptpubkey: "6a14" + contractHash,
          scriptpubkey_asm: "OP_RETURN OP_PUSHBYTES_20 " + contractHash,
          scriptpubkey_type: "op_return",
          scriptpubkey_address: undefined as unknown as string,
          value: 0,
        },
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings.some((f) => f.id === "h17-bisq-deposit")).toBe(false);
  });

  it("does NOT trigger Bisq deposit with single input (not a joint deposit)", () => {
    const contractHash = "ab".repeat(20);
    const tx = makeTx({
      version: 1,
      vin: [makeVin()],
      vout: [
        makeVout({ value: 500_000, scriptpubkey_type: "v0_p2wsh" }),
        {
          scriptpubkey: "6a14" + contractHash,
          scriptpubkey_asm: "OP_RETURN OP_PUSHBYTES_20 " + contractHash,
          scriptpubkey_type: "op_return",
          scriptpubkey_address: undefined as unknown as string,
          value: 0,
        },
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings.some((f) => f.id === "h17-bisq-deposit")).toBe(false);
  });

  it("does NOT trigger Bisq deposit with too many non-OP_RETURN outputs", () => {
    const contractHash = "cd".repeat(20);
    const tx = makeTx({
      version: 1,
      vin: [makeVin(), makeVin()],
      vout: [
        makeVout({ value: 300_000, scriptpubkey_type: "v0_p2wsh" }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 30_000 }), // 3 non-OP_RETURN = too many
        {
          scriptpubkey: "6a14" + contractHash,
          scriptpubkey_asm: "OP_RETURN OP_PUSHBYTES_20 " + contractHash,
          scriptpubkey_type: "op_return",
          scriptpubkey_address: undefined as unknown as string,
          value: 0,
        },
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings.some((f) => f.id === "h17-bisq-deposit")).toBe(false);
  });

  // ── Existing tests ───────────────────────────────────────────────

  it("detects multiple multisig inputs of same type as single informational finding", () => {
    const tx = makeTx({
      vin: [
        makeVin({
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2, PUB3]),
        }),
        makeVin({
          inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2, PUB3]),
        }),
      ],
      vout: [
        makeVout({ value: 80_000 }),
        makeVout({ value: 15_000 }),
        makeVout({ value: 3_000 }),
        makeVout({ value: 1_000 }),
        makeVout({ value: 500 }),
      ],
    });

    const { findings } = analyzeMultisigDetection(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h17-multisig-info");
    expect(findings[0].params?.inputCount).toBe(2);
  });
});
