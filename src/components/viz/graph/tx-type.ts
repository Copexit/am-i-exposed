import type { MempoolTransaction } from "@/lib/api/types";
import { getSpendableOutputs, isCoinbase, isOpReturnOutput } from "@/lib/analysis/heuristics/tx-utils";

export type TxType = "coinbase" | "bip47Notification" | "sweep" | "simpleSend" | "consolidation" | "batch";

/**
 * Quick tx type shown under a graph node (null: no label). Coinbase comes
 * first: its shape (1 input, N outputs) would otherwise read as a batch.
 * Shapes count spendable outputs (OP_RETURN excluded): 1-in-1-out sweep,
 * 1-in-2-out simple send (payment + change), 1-in-3+-out batch,
 * N-in-1-out consolidation. N-in-M-out gets no label.
 */
export function txTypeOf(tx: MempoolTransaction): TxType | null {
  if (isCoinbase(tx)) return "coinbase";
  if (tx.vout.some((o) => isOpReturnOutput(o) && o.scriptpubkey.replace(/^6a(?:4c..)?/, "").length === 160) &&
    tx.vout.some((o) => o.value > 0 && o.value <= 1000)) return "bip47Notification";
  const inputCount = tx.vin.length;
  const outputCount = getSpendableOutputs(tx.vout).length;
  if (inputCount === 1 && outputCount === 1) return "sweep";
  if (inputCount === 1 && outputCount === 2) return "simpleSend";
  if (inputCount === 1 && outputCount >= 3) return "batch";
  if (inputCount > 1 && outputCount === 1) return "consolidation";
  return null;
}
