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
    expect(findings[0].id).toBe("h17-escrow-2of2");
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
