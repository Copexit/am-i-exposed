import { describe, it, expect } from "vitest";
import { parseMultisigFromInput } from "../multisig";
import { makeMultisigAsm } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";
import type { MempoolVin } from "@/lib/api/types";

function baseVin(overrides: Partial<MempoolVin> = {}): MempoolVin {
  return {
    txid: "a".repeat(64),
    vout: 0,
    prevout: {
      scriptpubkey: "",
      scriptpubkey_asm: "",
      scriptpubkey_type: "v0_p2wsh",
      scriptpubkey_address: "bc1q" + "0".repeat(38),
      value: 100_000,
    },
    scriptsig: "",
    scriptsig_asm: "",
    is_coinbase: false,
    sequence: 0xffffffff,
    ...overrides,
  };
}

// Compressed pubkey hex (33 bytes = 66 hex chars)
const PUB1 = "02" + "aa".repeat(32);
const PUB2 = "03" + "bb".repeat(32);
const PUB3 = "02" + "cc".repeat(32);
const PUB4 = "03" + "dd".repeat(32);
const PUB5 = "02" + "ee".repeat(32);

// Build raw hex for a multisig script: OP_M <pubkey pushes> OP_N OP_CHECKMULTISIG
function makeMultisigHex(m: number, keys: string[]): string {
  const n = keys.length;
  let hex = (0x50 + m).toString(16);
  for (const k of keys) {
    hex += "21" + k; // 0x21 = 33 (compressed pubkey push)
  }
  hex += (0x50 + n).toString(16);
  hex += "ae"; // OP_CHECKMULTISIG
  return hex;
}

describe("parseMultisigFromInput", () => {
  it("detects 2-of-2 P2WSH from inner_witnessscript_asm", () => {
    const vin = baseVin({
      inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2]),
    });
    const result = parseMultisigFromInput(vin);
    expect(result).toEqual({ m: 2, n: 2, scriptType: "p2wsh" });
  });

  it("detects 2-of-3 P2SH-P2WSH from inner_witnessscript_asm + inner_redeemscript_asm", () => {
    const vin = baseVin({
      inner_witnessscript_asm: makeMultisigAsm(2, [PUB1, PUB2, PUB3]),
      inner_redeemscript_asm: "OP_0 OP_PUSHBYTES_32 " + "ff".repeat(32),
    });
    const result = parseMultisigFromInput(vin);
    expect(result).toEqual({ m: 2, n: 3, scriptType: "p2sh-p2wsh" });
  });

  it("detects 3-of-5 P2WSH from inner_witnessscript_asm", () => {
    const vin = baseVin({
      inner_witnessscript_asm: makeMultisigAsm(3, [PUB1, PUB2, PUB3, PUB4, PUB5]),
    });
    const result = parseMultisigFromInput(vin);
    expect(result).toEqual({ m: 3, n: 5, scriptType: "p2wsh" });
  });

  it("falls back to raw witness hex when inner_witnessscript_asm is absent", () => {
    const witnessScript = makeMultisigHex(2, [PUB1, PUB2, PUB3]);
    const vin = baseVin({
      witness: [
        "", // OP_0 dummy
        "3045" + "aa".repeat(32), // sig1
        "3045" + "bb".repeat(32), // sig2
        witnessScript, // the witness script
      ],
    });
    const result = parseMultisigFromInput(vin);
    expect(result).toEqual({ m: 2, n: 3, scriptType: "p2wsh" });
  });

  it("returns null for regular P2WPKH input (no multisig)", () => {
    const vin = baseVin({
      witness: [
        "3045" + "aa".repeat(32), // signature
        PUB1, // pubkey
      ],
    });
    const result = parseMultisigFromInput(vin);
    expect(result).toBeNull();
  });

  it("rejects HTLC/complex script containing CHECKMULTISIG (not anchored)", () => {
    // An HTLC script that happens to contain OP_CHECKMULTISIG but is not a pure multisig
    const vin = baseVin({
      inner_witnessscript_asm:
        "OP_IF OP_PUSHNUM_2 OP_PUSHBYTES_33 " + PUB1 +
        " OP_PUSHBYTES_33 " + PUB2 +
        " OP_PUSHNUM_2 OP_CHECKMULTISIG OP_ELSE OP_PUSHBYTES_3 401f00 OP_CHECKSEQUENCEVERIFY OP_ENDIF",
    });
    const result = parseMultisigFromInput(vin);
    expect(result).toBeNull();
  });

  it("returns null for malformed witness hex", () => {
    const vin = baseVin({
      witness: ["", "3045aa", "3045bb", "deadbeef"],
    });
    const result = parseMultisigFromInput(vin);
    expect(result).toBeNull();
  });

  it("returns null for input with no witness and no script data", () => {
    const vin = baseVin({
      witness: undefined,
      inner_witnessscript_asm: undefined,
      inner_redeemscript_asm: undefined,
    });
    const result = parseMultisigFromInput(vin);
    expect(result).toBeNull();
  });

  it("detects legacy P2SH multisig from inner_redeemscript_asm", () => {
    const vin = baseVin({
      prevout: {
        scriptpubkey: "",
        scriptpubkey_asm: "",
        scriptpubkey_type: "p2sh",
        scriptpubkey_address: "3" + "0".repeat(33),
        value: 50_000,
      },
      inner_redeemscript_asm: makeMultisigAsm(2, [PUB1, PUB2]),
    });
    const result = parseMultisigFromInput(vin);
    expect(result).toEqual({ m: 2, n: 2, scriptType: "p2sh" });
  });
});
