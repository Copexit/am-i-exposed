import type { MempoolTransaction, MempoolVout } from "@/lib/api/types";

/** Check if a transaction is a coinbase (block reward) transaction. */
export function isCoinbase(tx: MempoolTransaction): boolean {
  return tx.vin.some((v) => v.is_coinbase);
}

/** Filter transaction outputs to only spendable ones (excluding OP_RETURN). */
export function getSpendableOutputs(vout: MempoolVout[]): MempoolVout[] {
  return vout.filter((o) => o.scriptpubkey_type !== "op_return");
}
