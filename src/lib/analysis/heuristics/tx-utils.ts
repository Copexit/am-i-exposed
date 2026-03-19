import type { MempoolTransaction, MempoolVout } from "@/lib/api/types";

/** Check if a transaction is a coinbase (block reward) transaction. */
export function isCoinbase(tx: MempoolTransaction): boolean {
  return tx.vin.some((v) => v.is_coinbase);
}

/** Filter transaction outputs to only spendable ones (excluding OP_RETURN). */
export function getSpendableOutputs(vout: MempoolVout[]): MempoolVout[] {
  return vout.filter((o) => o.scriptpubkey_type !== "op_return");
}

/** Spendable outputs with positive value (excludes OP_RETURN and zero-value). */
export function getValuedOutputs(vout: MempoolVout[]): MempoolVout[] {
  return vout.filter((o) => o.scriptpubkey_type !== "op_return" && o.value > 0);
}

/** Spendable outputs with positive value and an address. */
export function getAddressedOutputs(vout: MempoolVout[]): MempoolVout[] {
  return vout.filter((o) => o.scriptpubkey_type !== "op_return" && o.scriptpubkey_address && o.value > 0);
}

/** Check if a scriptpubkey is an OP_RETURN output (starts with 0x6a opcode). */
export function isOpReturn(scriptpubkey: string): boolean {
  return scriptpubkey.startsWith("6a");
}

/** Extract the data portion after the OP_RETURN opcode (0x6a) and push length bytes. */
export function extractOpReturnData(scriptpubkey: string): string {
  if (!scriptpubkey.startsWith("6a")) return "";

  let offset = 2;
  if (offset >= scriptpubkey.length) return "";

  const pushByte = parseInt(scriptpubkey.slice(offset, offset + 2), 16);
  if (pushByte <= 0x4b) {
    // Direct push: 1-byte length
    offset += 2;
  } else if (pushByte === 0x4c) {
    // OP_PUSHDATA1: length in next byte
    offset += 4;
  } else if (pushByte === 0x4d) {
    // OP_PUSHDATA2: length in next 2 bytes
    offset += 6;
  }

  return scriptpubkey.slice(offset);
}
