import type { Finding } from "@/lib/types";
import type {
  MempoolTransaction,
  MempoolAddress,
  MempoolUtxo,
} from "@/lib/api/types";

/** Translation function passed from React layer to analysis code. */
export type HeuristicTranslator = (key: string, options?: Record<string, unknown>) => string;

interface HeuristicResult {
  findings: Finding[];
}

/** Optional context passed to transaction heuristics (e.g. price data). */
export interface TxContext {
  /** USD per BTC at the time the transaction was confirmed (mainnet only). */
  usdPrice?: number;
}

/** Analyzes a single transaction. */
export type TxHeuristic = (
  tx: MempoolTransaction,
  rawHex?: string,
  ctx?: TxContext,
) => HeuristicResult;

/** Analyzes an address with its UTXOs and transaction history. */
export type AddressHeuristic = (
  address: MempoolAddress,
  utxos: MempoolUtxo[],
  txs: MempoolTransaction[],
) => HeuristicResult;
