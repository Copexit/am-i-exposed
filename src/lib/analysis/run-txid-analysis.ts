/**
 * Pure async function that runs the full txid analysis pipeline.
 *
 * Extracted from useAnalysis.ts to keep the hook thin. This function
 * performs all fetching, enrichment, heuristic analysis, chain tracing,
 * and Boltzmann computation for a single transaction. It returns a
 * partial AnalysisState that the hook merges into React state.
 *
 * Throws on any unrecoverable error - the caller (hook) catches and
 * maps to user-facing error state.
 */

import { runTxHeuristicSteps, finalizeTxResult } from "@/lib/analysis/orchestrator";
import { getAddressedOutputs } from "@/lib/analysis/heuristics/tx-utils";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { needsEnrichment, enrichPrevouts, countNullPrevouts } from "@/lib/api/enrich-prevouts";
import { computeBoltzmann, isAutoComputable, extractTxValues } from "@/lib/analysis/boltzmann-compute";
import { enhanceEntropyFinding } from "@/lib/analysis/boltzmann-enhance";
import { enrichBip47Finding, enrichRicochetFinding } from "@/lib/analysis/enrichment";
import { getAnalysisSettings, type AnalysisSettings } from "@/hooks/useAnalysisSettings";
import { runChainTrace, runChainAnalysis } from "@/lib/analysis/chain-trace";
import { makeIncompletePrevoutFinding } from "@/hooks/useAnalysisState";
import type { ApiClient } from "@/lib/api/client";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { TxContext } from "@/lib/analysis/heuristics/types";
import type { AnalysisState } from "@/hooks/useAnalysisState";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { Finding, ScoringResult } from "@/lib/types";

/** Low-severity marker added when an optional enrichment fetch failed. */
export const ANALYSIS_INCOMPLETE_FINDING: Finding = {
  id: "analysis-incomplete",
  severity: "low",
  confidence: "high",
  title: "Some optional data could not be fetched",
  description:
    "One or more optional lookups (raw transaction, historical prices, output spends, " +
    "parent/child transactions or output address history) failed, usually because of rate " +
    "limiting or a timeout. Heuristics that depend on that data were skipped, so the result may be incomplete.",
  recommendation: "Scan again in a moment for a complete analysis.",
  scoreImpact: 0,
};

/** Dependencies injected from the React hook layer. */
export interface TxidAnalysisDeps {
  api: ApiClient;
  controller: AbortController;
  network: string;
  isCustomApi: boolean;
  analysisSettingsForCache: AnalysisSettings;
  /** Step-update callback for diagnostic loader progress. */
  onStep: (stepId: string, impact?: number) => void;
  /** React setState - applies chain-trace progress and the final result. */
  setState: React.Dispatch<React.SetStateAction<AnalysisState>>;
}

/** The result returned by runTxidAnalysis on success. */
export interface TxidAnalysisResult {
  result: ScoringResult;
  txData: MempoolTransaction;
  usdPrice: number | null;
  outspends: MempoolOutspend[] | null;
  backwardLayers: TraceLayer[] | null;
  forwardLayers: TraceLayer[] | null;
  boltzmannResult: BoltzmannWorkerResult | null;
  boltzmannStatus: "idle" | "complete" | "error";
  /** Whether Boltzmann was attempted but unsupported / not auto-computable. */
  shouldAutoBoltzmann: boolean;
}

/**
 * Run the full txid analysis pipeline.
 *
 * The caller must handle AbortSignal checks after awaiting this function.
 * This function checks the signal at key points and returns early (via throw)
 * but the caller should also check after the returned promise resolves.
 */
export async function runTxidAnalysis(
  txid: string,
  deps: TxidAnalysisDeps,
): Promise<TxidAnalysisResult> {
  const { api, controller, network, isCustomApi, analysisSettingsForCache, onStep, setState } = deps;

  // Optional enrichment: a failure (other than NOT_FOUND) marks the result
  // partial so it is flagged to the user and never cached.
  let partial = false;
  const optional = <T>(p: Promise<T>): Promise<T | null> =>
    p.catch((err: unknown) => {
      if (!(err instanceof ApiError && err.code === "NOT_FOUND")) partial = true;
      return null;
    });

  const [tx, rawHex] = await Promise.all([
    api.getTransaction(txid),
    optional(api.getTxHex(txid)),
  ]);

  // Enrich missing prevout data for self-hosted mempool backends
  if (needsEnrichment([tx])) {
    await enrichPrevouts([tx], {
      getTransaction: (id) => api.getTransaction(id),
      signal: controller.signal,
    });
  }

  // Start Boltzmann computation early (in parallel with price/trace fetches)
  const txValues = extractTxValues(tx);
  const shouldAutoBoltzmann = isAutoComputable(txValues.inputValues, txValues.outputValues);
  const boltzmannPromise = shouldAutoBoltzmann
    ? computeBoltzmann(tx, {
        timeoutMs: (analysisSettingsForCache.boltzmannTimeout ?? 300) * 1000,
        signal: controller.signal,
      }).catch(() => null)
    : Promise.resolve(null);

  // Fetch historical fiat prices + outspend data for confirmed txs
  // Also pre-fetch parent tx for peel chain detection (only for 1-input txs)
  let usdPrice: number | null = null;
  let eurPrice: number | null = null;
  let outspends: MempoolOutspend[] | null = null;
  let parentTx: MempoolTransaction | null = null;
  const isPeelCandidate = tx.vin.length === 1 && !tx.vin[0].is_coinbase;
  const parentTxPromise = isPeelCandidate
    ? optional(api.getTransaction(tx.vin[0].txid))
    : Promise.resolve(null);

  if (network === "mainnet" && tx.status?.block_time) {
    [usdPrice, eurPrice, outspends, parentTx] = await Promise.all([
      optional(api.getHistoricalPrice(tx.status.block_time)),
      optional(api.getHistoricalEurPrice(tx.status.block_time)),
      optional(api.getTxOutspends(txid)),
      parentTxPromise,
    ]);
  } else if (tx.status?.confirmed) {
    [outspends, parentTx] = await Promise.all([
      optional(api.getTxOutspends(txid)),
      parentTxPromise,
    ]);
  } else {
    parentTx = await parentTxPromise;
  }

  // Fetch child tx for peel chain detection: if one of our outputs was
  // spent, fetch the spending tx to check if it continues the peel pattern
  let childTx: MempoolTransaction | null = null;
  if (outspends && isPeelCandidate) {
    const spentEntry = outspends.find((o) => o.spent && o.txid);
    if (spentEntry?.txid) {
      childTx = await optional(api.getTransaction(spentEntry.txid));
    }
  }

  // Pre-fetch output address tx counts for fresh address change detection (H2 sub-heuristic 8)
  // Only for 2-output txs (the change detection heuristic only applies to these)
  let outputTxCounts: Map<string, number> | undefined;
  const spendableOuts = getAddressedOutputs(tx.vout);
  if (spendableOuts.length === 2) {
    const addrs = spendableOuts.map((v) => v.scriptpubkey_address!);
    const counts = await Promise.all(
      addrs.map((addr) =>
        optional(api.getAddress(addr).then((a) => a.chain_stats.tx_count + a.mempool_stats.tx_count)),
      ),
    );
    if (counts.every((c) => c !== null)) {
      outputTxCounts = new Map(addrs.map((a, i) => [a, counts[i]!]));
    }
  }

  // --- Recursive tracing (chain analysis) ---
  const analysisSettings = getAnalysisSettings();
  const { backwardLayers, forwardLayers, backwardFailed, forwardFailed } = await runChainTrace({
    tx,
    settings: analysisSettings,
    api,
    controller,
    onProgress: (fetchProgress) => setState((prev) => ({ ...prev, fetchProgress })),
    parentTx,
    childTx,
    outspends,
  });

  if (controller.signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  setState((prev) => ({
    ...prev,
    phase: "analyzing",
    txData: tx,
    usdPrice,
    outspends,
    fetchProgress: { status: "done", timeoutSec: 0, currentDepth: 0, maxDepth: 0, txsFetched: 0 },
    backwardLayers: backwardLayers.length > 0 ? backwardLayers : null,
    forwardLayers: forwardLayers.length > 0 ? forwardLayers : null,
  }));

  // Build parentTxs Map from backward trace layer 0 (direct parents)
  // for heuristics that need confirmation heights of input funding txs
  let parentTxs: Map<string, MempoolTransaction> | undefined;
  if (backwardLayers.length > 0 && backwardLayers[0].txs.size > 0) {
    parentTxs = backwardLayers[0].txs;
  } else if (parentTx) {
    // Fallback: only the single pre-fetched parent for vin[0]
    parentTxs = new Map([[tx.vin[0].txid, parentTx]]);
  }

  const ctx: TxContext = {
    ...(usdPrice ? { usdPrice } : {}),
    ...(eurPrice ? { eurPrice } : {}),
    isCustomApi,
    ...(parentTx ? { parentTx } : {}),
    ...(parentTxs ? { parentTxs } : {}),
    ...(childTx ? { childTx } : {}),
    ...(outputTxCounts ? { outputTxCounts } : {}),
  };
  // Raw findings: every stage below appends to this list, then one
  // finalizeTxResult scores everything together (chain findings count).
  const findings = await runTxHeuristicSteps(tx, rawHex ?? undefined, onStep, ctx);
  if (controller.signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // --- BIP47 notification address enrichment ---
  await enrichBip47Finding(findings, api, controller.signal);

  // --- Ricochet hop chain enrichment ---
  await enrichRicochetFinding(findings, api, tx, controller.signal);

  // --- Chain analysis from trace layers (appends to findings) ---
  await runChainAnalysis({
    tx,
    result: { findings },
    backwardLayers,
    forwardLayers,
    parentTx,
    childTx,
    outspends,
    onStep,
  });

  // Warn if chain tracing failed or timed out
  if (backwardFailed || forwardFailed) {
    const direction = backwardFailed && forwardFailed ? "backward and forward"
      : backwardFailed ? "backward" : "forward";
    findings.push({
      id: "chain-trace-partial",
      severity: "low",
      confidence: "high",
      title: `Chain tracing incomplete (${direction})`,
      description:
        `${direction.charAt(0).toUpperCase() + direction.slice(1)} tracing failed or timed out. ` +
        "Chain analysis results may be incomplete. This typically happens with rate-limited APIs or deep trace depths.",
      recommendation:
        "Try again with a shorter chain depth or longer timeout in Analysis settings.",
      scoreImpact: 0,
    });
  }

  // If prevout data is still missing after enrichment, warn the user
  const remainingNulls = countNullPrevouts([tx]);
  if (remainingNulls > 0) {
    findings.push(makeIncompletePrevoutFinding(remainingNulls));
  }

  // Await Boltzmann result (started earlier in parallel)
  const boltzmannResult = await boltzmannPromise;

  // Enhance entropy finding with real WASM Boltzmann data
  if (boltzmannResult && !boltzmannResult.timedOut) {
    enhanceEntropyFinding(findings, boltzmannResult);
  }

  if (partial) findings.push({ ...ANALYSIS_INCOMPLETE_FINDING });

  const result = finalizeTxResult(findings);
  // chain-trace-partial already tells the user; it only needs the flag
  if (partial || backwardFailed || forwardFailed) result.partial = true;

  return {
    result,
    txData: tx,
    usdPrice,
    outspends,
    backwardLayers: backwardLayers.length > 0 ? backwardLayers : null,
    forwardLayers: forwardLayers.length > 0 ? forwardLayers : null,
    boltzmannResult: boltzmannResult ?? null,
    boltzmannStatus: boltzmannResult ? "complete" : shouldAutoBoltzmann ? "error" : "idle",
    shouldAutoBoltzmann,
  };
}
