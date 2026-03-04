import type { MempoolVin } from "@/lib/api/types";

export interface MultisigInfo {
  m: number;
  n: number;
  scriptType: "p2sh" | "p2wsh" | "p2sh-p2wsh";
}

/**
 * Parse multisig M-of-N from a transaction input's witness/script data.
 * Returns null if the input is not spending a multisig script.
 *
 * Detection methods (in priority order):
 * 1. Parse inner_witnessscript_asm (most reliable, from mempool.space API)
 * 2. Parse last witness stack element as raw hex (fallback)
 * 3. Parse inner_redeemscript_asm for legacy P2SH multisig
 */
export function parseMultisigFromInput(vin: MempoolVin): MultisigInfo | null {
  // Method 1: inner_witnessscript_asm (P2WSH or P2SH-P2WSH)
  const result = parseFromAsm(vin.inner_witnessscript_asm);
  if (result) {
    const hasRedeem = !!vin.inner_redeemscript_asm;
    return { ...result, scriptType: hasRedeem ? "p2sh-p2wsh" : "p2wsh" };
  }

  // Method 2: raw witness hex (last element is the serialized script)
  if (vin.witness && vin.witness.length >= 4) {
    const lastWitness = vin.witness[vin.witness.length - 1];
    const hexResult = parseMultisigFromHex(lastWitness);
    if (hexResult) {
      const hasRedeem = !!vin.inner_redeemscript_asm;
      return { ...hexResult, scriptType: hasRedeem ? "p2sh-p2wsh" : "p2wsh" };
    }
  }

  // Method 3: inner_redeemscript_asm (legacy P2SH multisig)
  const redeemResult = parseFromAsm(vin.inner_redeemscript_asm);
  if (redeemResult) {
    return { ...redeemResult, scriptType: "p2sh" };
  }

  return null;
}

const MULTISIG_ASM_RE =
  /^OP_PUSHNUM_(\d+)\s+(?:OP_PUSHBYTES_(?:33|65)\s+[0-9a-f]+\s*)+OP_PUSHNUM_(\d+)\s+OP_CHECKMULTISIG$/;

function parseFromAsm(asm: string | undefined): { m: number; n: number } | null {
  if (!asm) return null;
  const match = asm.match(MULTISIG_ASM_RE);
  if (!match) return null;
  const m = parseInt(match[1], 10);
  const n = parseInt(match[2], 10);
  if (m < 1 || m > 16 || n < 1 || n > 16 || m > n) return null;
  return { m, n };
}

/**
 * Parse multisig from raw hex-encoded script.
 * Format: OP_M <pubkey1> <pubkey2> ... OP_N OP_CHECKMULTISIG
 * OP_1..OP_16 = 0x51..0x60, OP_CHECKMULTISIG = 0xae
 */
function parseMultisigFromHex(hex: string): { m: number; n: number } | null {
  if (!hex || hex.length < 10) return null;

  // Convert hex to bytes
  const len = hex.length / 2;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }

  // Must end with OP_CHECKMULTISIG (0xae)
  if (bytes[bytes.length - 1] !== 0xae) return null;

  // First byte: OP_M (0x51 = OP_1, 0x60 = OP_16)
  const mByte = bytes[0];
  if (mByte < 0x51 || mByte > 0x60) return null;
  const m = mByte - 0x50;

  // Second-to-last byte: OP_N
  const nByte = bytes[bytes.length - 2];
  if (nByte < 0x51 || nByte > 0x60) return null;
  const n = nByte - 0x50;

  if (m > n) return null;

  // Verify pubkey count matches N
  let pubkeyCount = 0;
  let pos = 1;
  while (pos < bytes.length - 2) {
    const keyLen = bytes[pos];
    // Compressed (33) or uncompressed (65) pubkey
    if (keyLen !== 33 && keyLen !== 65) return null;
    pos += 1 + keyLen;
    pubkeyCount++;
  }

  if (pubkeyCount !== n || pos !== bytes.length - 2) return null;

  return { m, n };
}
