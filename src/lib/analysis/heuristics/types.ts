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
  /** EUR per BTC at the time the transaction was confirmed (mainnet only). */
  eurPrice?: number;
  /** True when the user is pointing at a custom (self-hosted) mempool API rather than the public mempool.space. */
  isCustomApi?: boolean;
  /** The transaction that created vin[0] (pre-fetched for peel chain detection). */
  parentTx?: MempoolTransaction;
  /** A child transaction that spends one of our outputs (pre-fetched for peel chain detection). */
  childTx?: MempoolTransaction;
  /** Map of output address → total on-chain tx count (for fresh address change detection). */
  outputTxCounts?: Map<string, number>;
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
