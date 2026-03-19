/**
 * Pure async function that runs the full address analysis pipeline.
 *
 * Extracted from useAnalysis.ts to keep the hook thin. This function
 * performs all fetching, enrichment, and heuristic analysis for a single
 * address. It returns a partial AnalysisState that the hook merges
 * into React state.
 *
 * Throws on any unrecoverable error - the caller (hook) catches and
 * maps to user-facing error state.
 */

import {
  analyzeAddress,
  analyzeDestination,
  analyzeTransactionsForAddress,
} from "@/lib/analysis/orchestrator";
import { checkOfac } from "@/lib/analysis/cex-risk/ofac-check";
import { needsEnrichment, enrichPrevouts, countNullPrevouts } from "@/lib/api/enrich-prevouts";
import { makeIncompletePrevoutFinding, makeOfacPreSendResult } from "@/hooks/useAnalysisState";
import type { ApiClient } from "@/lib/api/client";
import type { MempoolTransaction, MempoolAddress, MempoolUtxo } from "@/lib/api/types";
import type { PreSendResult } from "@/lib/analysis/address-orchestrator";
import type { ScoringResult, TxAnalysisResult } from "@/lib/types";
import type { AnalysisState } from "@/hooks/useAnalysisState";

/** Dependencies injected from the React hook layer. */
export interface AddressAnalysisDeps {
  api: ApiClient;
  controller: AbortController;
  /** Step-update callback for diagnostic loader progress. */
  onStep: (stepId: string, impact?: number) => void;
  /** React setState - needed for intermediate "analyzing" phase transition. */
  setState: React.Dispatch<React.SetStateAction<AnalysisState>>;
  /** Translation function for OFAC pre-send result text. */
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/** The result returned by runAddressAnalysis on success. */
export interface AddressAnalysisResult {
  /** Null when the address is OFAC-sanctioned (only preSendResult is set). */
  result: ScoringResult | null;
  /** Null when the address is OFAC-sanctioned (not fetched). */
  addressData: MempoolAddress | null;
  addressTxs: MempoolTransaction[] | null;
  addressUtxos: MempoolUtxo[] | null;
  txBreakdown: TxAnalysisResult[] | null;
  preSendResult: PreSendResult | null;
  /** True when the address is OFAC-sanctioned and analysis was short-circuited. */
  isOfacSanctioned: boolean;
}

/**
 * Run the full address analysis pipeline.
 *
 * Returns early with isOfacSanctioned=true if the address is OFAC-sanctioned.
 * The caller must handle AbortSignal checks after awaiting this function.
 */
export async function runAddressAnalysis(
  address: string,
  deps: AddressAnalysisDeps,
): Promise<AddressAnalysisResult> {
  const { api, controller, onStep, setState, t } = deps;

  // OFAC pre-flight check (no network needed)
  const ofacResult = checkOfac([address]);
  if (ofacResult.sanctioned) {
    return {
      result: null,
      addressData: null,
      addressTxs: null,
      addressUtxos: null,
      txBreakdown: null,
      preSendResult: makeOfacPreSendResult(t),
      isOfacSanctioned: true,
    };
  }

  // Fetch address data - UTXOs may fail for addresses with >500 UTXOs
  const [addressData, utxos, txs] = await Promise.all([
    api.getAddress(address),
    api.getAddressUtxos(address).catch(() => [] as MempoolUtxo[]),
    api.getAddressTxs(address).catch(() => [] as MempoolTransaction[]),
  ]);

  // Enrich missing prevout data for self-hosted mempool backends
  if (txs.length > 0 && needsEnrichment(txs)) {
    await enrichPrevouts(txs, {
      getTransaction: (txid) => api.getTransaction(txid),
      signal: controller.signal,
      maxParentTxids: 50,
    });
  }

  setState((prev) => ({ ...prev, phase: "analyzing", addressData }));

  const totalTxCount = addressData.chain_stats.tx_count + addressData.mempool_stats.tx_count;
  const isFreshAddress = totalTxCount === 0;

  // Fresh address: no transactions, nothing to score - only run destination check
  if (isFreshAddress) {
    const preSendResult = await analyzeDestination(addressData, utxos, txs, onStep);

    return {
      result: null,
      addressData,
      addressTxs: null,
      addressUtxos: null,
      txBreakdown: null,
      preSendResult,
      isOfacSanctioned: false,
    };
  }

  // Run both address analysis AND destination check on the same data
  const [result, preSendResult] = await Promise.all([
    analyzeAddress(addressData, utxos, txs, onStep),
    analyzeDestination(addressData, utxos, txs),
  ]);
  if (controller.signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Run per-tx heuristic breakdown for address analysis
  const txBreakdown = txs.length > 0
    ? await analyzeTransactionsForAddress(address, txs)
    : null;
  if (controller.signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // If prevout data is still missing after enrichment, warn the user
  if (txs.length > 0) {
    const remainingNulls = countNullPrevouts(txs);
    if (remainingNulls > 0) {
      result.findings.push(makeIncompletePrevoutFinding(remainingNulls, true));
    }
  }

  return {
    result,
    addressData,
    addressTxs: txs.length > 0 ? txs : null,
    addressUtxos: utxos.length > 0 ? utxos : null,
    txBreakdown,
    preSendResult,
    isOfacSanctioned: false,
  };
}
