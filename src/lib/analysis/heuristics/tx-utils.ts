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
