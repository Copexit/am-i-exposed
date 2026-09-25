import type { MempoolTransaction, MempoolVin, MempoolVout } from "@/lib/api/types";

/** Check if a transaction is a coinbase (block reward) transaction. */
export function isCoinbase(tx: MempoolTransaction): boolean {
  return tx.vin.some((v) => v.is_coinbase);
}

/** Check if a scriptpubkey is an OP_RETURN output (starts with 0x6a opcode). */
export function isOpReturn(scriptpubkey: string): boolean {
  return scriptpubkey.startsWith("6a");
}

/**
 * Canonical OP_RETURN check for an output. mempool.space labels it via
 * scriptpubkey_type; PSBT-derived outputs may only carry the raw script.
 */
export function isOpReturnOutput(o: { scriptpubkey_type?: string; scriptpubkey?: string }): boolean {
  return o.scriptpubkey_type === "op_return" || (o.scriptpubkey !== undefined && isOpReturn(o.scriptpubkey));
}

/** BIP125 opt-in RBF: any non-coinbase input with nSequence below 0xfffffffe. */
export function isRbfSignaling(vin: MempoolVin[]): boolean {
  return vin.some((v) => !v.is_coinbase && v.sequence < 0xfffffffe);
}

/** Filter transaction outputs to only spendable ones (excluding OP_RETURN). */
export function getSpendableOutputs(vout: MempoolVout[]): MempoolVout[] {
  return vout.filter((o) => !isOpReturnOutput(o));
}

/** Spendable outputs with positive value (excludes OP_RETURN and zero-value). */
export function getValuedOutputs<T extends { scriptpubkey_type?: string; scriptpubkey?: string; value: number }>(vout: T[]): T[] {
  return vout.filter((o) => !isOpReturnOutput(o) && o.value > 0);
}

/** Spendable outputs with positive value and an address. */
export function getAddressedOutputs(vout: MempoolVout[]): MempoolVout[] {
  return vout.filter((o) => !isOpReturnOutput(o) && o.scriptpubkey_address && o.value > 0);
}

/** Count occurrences of each output value in the given outputs. */
export function countOutputValues(outputs: { value: number }[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const o of outputs) {
    counts.set(o.value, (counts.get(o.value) ?? 0) + 1);
  }
  return counts;
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
