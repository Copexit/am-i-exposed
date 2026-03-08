/**
 * Analysis API - Clean surface for programmatic access
 *
 * Designed for integration with local AI agents, wallet software,
 * and other tools that need Bitcoin privacy analysis capabilities.
 *
 * All analysis runs client-side. No data is sent to any server
 * beyond the mempool.space API (or a user-configured instance)
 * for fetching blockchain data.
 *
 * Usage:
 *   import { AnalysisAPI } from "@/lib/api/analysis-api";
 *   const api = new AnalysisAPI();
 *   const result = await api.analyzeTransaction("txid...");
 */

import { createApiClient } from "@/lib/api/client";
import { NETWORK_CONFIG, type BitcoinNetwork } from "@/lib/bitcoin/networks";
import {
  analyzeTransaction as runTxAnalysis,
  analyzeAddress as runAddrAnalysis,
} from "@/lib/analysis/orchestrator";
import { parsePSBT, type PSBTParseResult } from "@/lib/bitcoin/psbt";
import { selectCoins, type CoinSelectionInput, type CoinSelectionResult } from "@/lib/analysis/coin-selection";
import { needsEnrichment, enrichPrevouts } from "@/lib/api/enrich-prevouts";
import type { ScoringResult } from "@/lib/types";
import type { NetworkConfig } from "@/lib/bitcoin/networks";

// ---------- Types ----------

export interface AnalysisAPIOptions {
  /** Bitcoin network (default: "mainnet") */
  network?: BitcoinNetwork;
  /** Custom network config (overrides network default) */
  config?: NetworkConfig;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

export interface TransactionAnalysisResult {
  /** Privacy score (0-100) and findings */
  scoring: ScoringResult;
  /** Input count */
  inputCount: number;
  /** Output count */
  outputCount: number;
  /** Fee in sats */
  fee: number;
}

export interface PSBTAnalysisResult {
  /** Privacy score (0-100) and findings */
  scoring: ScoringResult;
  /** Parsed PSBT metadata */
  psbt: PSBTParseResult;
}

export interface AddressAnalysisResult {
  /** Privacy score (0-100) and findings */
  scoring: ScoringResult;
  /** Total transactions */
  txCount: number;
  /** Total received in sats */
  totalReceived: number;
  /** Current balance in sats */
  balance: number;
}

/** Simplified UTXO input for the coin selection API */
export interface SimpleUtxo {
  txid: string;
  vout: number;
  value: number;
  /** Script type (e.g. "v0_p2wpkh", "v1_p2tr") */
  scriptType?: string;
  /** Address this UTXO belongs to */
  address?: string;
}

// ---------- API Class ----------

export class AnalysisAPI {
  private network: BitcoinNetwork;
  private config: NetworkConfig;

  constructor(options?: AnalysisAPIOptions) {
    this.network = options?.network ?? "mainnet";
    this.config = options?.config ?? NETWORK_CONFIG[this.network];
  }

  /**
   * Analyze a confirmed or mempool transaction by txid.
   * Fetches the transaction from the API and runs all heuristics.
   */
  async analyzeTransaction(
    txid: string,
    signal?: AbortSignal,
  ): Promise<TransactionAnalysisResult> {
    const api = createApiClient(this.config, signal);
    const [tx, rawHex] = await Promise.all([
      api.getTransaction(txid),
      api.getTxHex(txid).catch(() => undefined),
    ]);

    if (needsEnrichment([tx])) {
      await enrichPrevouts([tx], {
        getTransaction: (id) => api.getTransaction(id),
        signal,
      });
    }

    const scoring = await runTxAnalysis(tx, rawHex);

    return {
      scoring,
      inputCount: tx.vin.length,
      outputCount: tx.vout.length,
      fee: tx.fee ?? 0,
    };
  }

  /**
   * Analyze a PSBT (unsigned transaction) for privacy before broadcasting.
   * No API calls needed - the PSBT contains all transaction data.
   *
   * @param psbtInput - Base64 or hex encoded PSBT string
   */
  async analyzePSBT(psbtInput: string): Promise<PSBTAnalysisResult> {
    const psbt = parsePSBT(psbtInput);
    const scoring = await runTxAnalysis(psbt.tx);
    return { scoring, psbt };
  }

  /**
   * Analyze a Bitcoin address for privacy patterns.
   * Fetches address data and transaction history from the API.
   */
  async analyzeAddress(
    address: string,
    signal?: AbortSignal,
  ): Promise<AddressAnalysisResult> {
    const api = createApiClient(this.config, signal);
    const [addrData, utxos, txs] = await Promise.all([
      api.getAddress(address),
      api.getAddressUtxos(address).catch(() => []),
      api.getAddressTxs(address).catch(() => []),
    ]);

    if (txs.length > 0 && needsEnrichment(txs)) {
      await enrichPrevouts(txs, {
        getTransaction: (id) => api.getTransaction(id),
        signal,
        maxParentTxids: 50,
      });
    }

    const scoring = await runAddrAnalysis(addrData, utxos, txs);

    const { chain_stats, mempool_stats } = addrData;
    return {
      scoring,
      txCount: chain_stats.tx_count + mempool_stats.tx_count,
      totalReceived: chain_stats.funded_txo_sum + mempool_stats.funded_txo_sum,
      balance:
        chain_stats.funded_txo_sum - chain_stats.spent_txo_sum +
        mempool_stats.funded_txo_sum - mempool_stats.spent_txo_sum,
    };
  }

  /**
   * Suggest optimal coin selection for a payment.
   * Finds the best UTXO combination that minimizes privacy leakage.
   *
   * @param utxos - Available UTXOs to select from
   * @param paymentAmount - Target payment amount in sats
   * @param feeRate - Fee rate in sat/vB (default: 1)
   * @returns Selection result with chosen UTXOs and privacy findings, or null if no valid selection
   */
  suggestCoinSelection(
    utxos: SimpleUtxo[],
    paymentAmount: number,
    feeRate = 1,
  ): CoinSelectionResult | null {
    const inputs: CoinSelectionInput[] = utxos.map((u) => ({
      utxo: {
        txid: u.txid,
        vout: u.vout,
        value: u.value,
        status: { confirmed: true },
      },
      address: u.address ?? "",
    }));
    return selectCoins(inputs, paymentAmount, feeRate);
  }
}

/**
 * Convenience: create a pre-configured API instance.
 * For quick one-off usage without instantiating the class.
 */
export function createAnalysisAPI(options?: AnalysisAPIOptions): AnalysisAPI {
  return new AnalysisAPI(options);
}
