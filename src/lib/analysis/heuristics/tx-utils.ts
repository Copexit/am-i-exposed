import type { MempoolVout } from "@/lib/api/types";

/** Filter transaction outputs to only spendable ones (excluding OP_RETURN). */
export function getSpendableOutputs(vout: MempoolVout[]): MempoolVout[] {
  return vout.filter((o) => o.scriptpubkey_type !== "op_return");
}
