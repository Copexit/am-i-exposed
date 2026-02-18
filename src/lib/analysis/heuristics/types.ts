import type { Finding } from "@/lib/types";
import type {
  MempoolTransaction,
  MempoolAddress,
  MempoolUtxo,
} from "@/lib/api/types";

export interface HeuristicResult {
  findings: Finding[];
}

/** Analyzes a single transaction. */
export type TxHeuristic = (
  tx: MempoolTransaction,
  rawHex?: string,
) => HeuristicResult;

/** Analyzes an address with its UTXOs and transaction history. */
export type AddressHeuristic = (
  address: MempoolAddress,
  utxos: MempoolUtxo[],
  txs: MempoolTransaction[],
) => HeuristicResult;
