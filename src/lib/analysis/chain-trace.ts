import { traceBackward, traceForward, type TraceLayer, type EntityBarrierCheck } from "@/lib/analysis/chain/recursive-trace";
import { analyzeEntityProximity } from "@/lib/analysis/chain/entity-proximity";
import { analyzeBackwardTaint } from "@/lib/analysis/chain/taint";
import { analyzeBackward } from "@/lib/analysis/chain/backward";
import { analyzeForward } from "@/lib/analysis/chain/forward";
import { buildCluster } from "@/lib/analysis/chain/clustering";
import { analyzeSpendingPatterns } from "@/lib/analysis/chain/spending-patterns";
import { buildLinkabilityMatrix } from "@/lib/analysis/chain/linkability";
import { buildParentTxsByIdx, buildChildTxsByIdx, buildTxsByAddress } from "@/lib/analysis/chain/trace-maps";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { isCoinJoinTx } from "@/lib/analysis/heuristics/coinjoin";
import type { AnalysisSettings } from "@/lib/analysis/settings";
import type { FetchProgress } from "@/lib/analysis/analysis-state";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import { sumImpact } from "@/lib/scoring/score";
import { enrichFindingsWithMetadata } from "@/lib/analysis/finding-metadata";
import { tick } from "@/lib/analysis/heuristic-registry";
import type { Finding } from "@/lib/types";

interface TraceApi {
  getTransaction: (txid: string) => Promise<MempoolTransaction>;
  getTxOutspends: (txid: string) => Promise<MempoolOutspend[]>;
}

/** Parameters for the chain analysis phase. */
interface ChainTraceParams {
  tx: MempoolTransaction;
  settings: AnalysisSettings;
  api: TraceApi;
  controller: AbortController;
  /** Trace progress for the loader (the caller owns any UI state). */
  onProgress: (progress: FetchProgress) => void;
  parentTx: MempoolTransaction | null;
  childTx: MempoolTransaction | null;
  outspends: MempoolOutspend[] | null;
}

/** Result of the chain analysis phase. */
interface ChainTraceResult {
  backwardLayers: TraceLayer[];
  forwardLayers: TraceLayer[];
  backwardFailed: boolean;
  forwardFailed: boolean;
}

/** Reject with an AbortError as soon as `signal` aborts, whatever `p` does. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * The trace api bound to a phase signal, so the phase timeout stops waiting on
 * in-flight requests. ponytail: the underlying fetch still runs until it
 * settles or the analysis controller aborts it; a per-call signal on
 * ApiClient would cancel it too.
 */
function phaseApi(api: TraceApi, signal: AbortSignal): TraceApi {
  return {
    getTransaction: (txid) => raceAbort(api.getTransaction(txid), signal),
    getTxOutspends: (txid) => raceAbort(api.getTxOutspends(txid), signal),
  };
}

/** More input addresses than this = a "service" tier cluster (see chain/clustering.ts). */
const LARGE_CLUSTER_ADDRESSES = 50;

/** Whether a tx merges a large CIOH cluster (typically an exchange or service consolidation). */
function isLargeCluster(tx: MempoolTransaction): boolean {
  const addrs = new Set<string>();
  for (const vin of tx.vin) {
    const addr = vin.prevout?.scriptpubkey_address;
    if (addr) addrs.add(addr);
  }
  return addrs.size > LARGE_CLUSTER_ADDRESSES;
}

/**
 * Trace barrier: stop tracing through known custodial entities (exchanges,
 * etc.) because they break chain of custody - no link between deposits and
 * withdrawals. Opt-in: also through CoinJoins and large CIOH clusters
 * (barrier txs stay in the layer).
 */
export function buildTraceBarrier(
  settings: Pick<AnalysisSettings, "skipCoinJoins" | "skipLargeClusters">,
): EntityBarrierCheck {
  return (btx) => {
    if (settings.skipCoinJoins && isCoinJoinTx(btx)) return true;
    if (settings.skipLargeClusters && isLargeCluster(btx)) return true;
    for (const vin of btx.vin) {
      const addr = vin.prevout?.scriptpubkey_address;
      if (addr && matchEntitySync(addr)) return true;
    }
    for (const vout of btx.vout) {
      const addr = vout.scriptpubkey_address;
      if (addr && matchEntitySync(addr)) return true;
    }
    return false;
  };
}

/**
 * Run the recursive backward/forward tracing phase.
 * Returns the trace layers (may be empty if depth is 0 or tracing times out).
 */
export async function runChainTrace(params: ChainTraceParams): Promise<ChainTraceResult> {
  const { tx, settings, api, controller, onProgress, parentTx, childTx, outspends } = params;

  let backwardLayers: TraceLayer[] = [];
  let forwardLayers: TraceLayer[] = [];
  let backwardFailed = false;
  let forwardFailed = false;
  const totalMaxDepth = settings.maxDepth * 2; // backward + forward

  if (settings.maxDepth < 1 || controller.signal.aborted) {
    return { backwardLayers, forwardLayers, backwardFailed, forwardFailed };
  }

  // Split timeout into two phases so forward tracing always gets a chance
  const halfTimeout = Math.max(settings.timeout * 500, 2000); // ms, at least 2s each

  const progress = (status: FetchProgress["status"], currentDepth: number, txsFetched: number) =>
    onProgress({ status, timeoutSec: settings.timeout, currentDepth, maxDepth: totalMaxDepth, txsFetched });

  // Debounced progress updater (only on depth change or every 500ms)
  let lastProgressUpdate = 0;
  let lastDepth = 0;
  const updateFetchProgress = (
    status: FetchProgress["status"],
    currentDepth: number,
    txsFetched: number,
  ) => {
    const now = Date.now();
    if (currentDepth !== lastDepth || now - lastProgressUpdate >= 500) {
      lastDepth = currentDepth;
      lastProgressUpdate = now;
      progress(status, currentDepth, txsFetched);
    }
  };

  // Build existing data maps to avoid re-fetching depth-1
  const existingParents = new Map<string, MempoolTransaction>();
  if (parentTx) existingParents.set(parentTx.txid, parentTx);
  const existingChildren = new Map<string, MempoolTransaction>();
  if (childTx) existingChildren.set(childTx.txid, childTx);

  const entityBarrier = buildTraceBarrier(settings);

  // --- Phase 1: Backward tracing (first half of timeout) ---
  {
    const backwardAbort = new AbortController();
    const onParentAbort = () => backwardAbort.abort();
    controller.signal.addEventListener("abort", onParentAbort);
    const backwardTimer = setTimeout(() => backwardAbort.abort(), halfTimeout);

    try {
      progress("tracing-backward", 0, 0);

      const backResult = await traceBackward(
        tx,
        settings.maxDepth,
        settings.minSats,
        phaseApi(api, backwardAbort.signal),
        backwardAbort.signal,
        (p) => updateFetchProgress("tracing-backward", p.currentDepth, p.txsFetched),
        existingParents,
        entityBarrier,
      );
      backwardLayers = backResult.layers;
      // traceBackward swallows per-branch errors; a timeout or failed fetch still means partial
      backwardFailed = backResult.aborted || backResult.failedFetches > 0;
    } catch {
      backwardFailed = true;
    }

    clearTimeout(backwardTimer);
    controller.signal.removeEventListener("abort", onParentAbort);
  }

  // --- Phase 2: Forward tracing (second half of timeout) ---
  if (!controller.signal.aborted) {
    const forwardAbort = new AbortController();
    const onParentAbort = () => forwardAbort.abort();
    controller.signal.addEventListener("abort", onParentAbort);
    const forwardTimer = setTimeout(() => forwardAbort.abort(), halfTimeout);

    try {
      const depthOffset = settings.maxDepth;
      const backFetchCount = backwardLayers.reduce((s, l) => s + l.txs.size, 0);

      progress("tracing-forward", depthOffset, backFetchCount);

      const fwdResult = await traceForward(
        tx,
        settings.maxDepth,
        settings.minSats,
        phaseApi(api, forwardAbort.signal),
        forwardAbort.signal,
        (p) => updateFetchProgress(
          "tracing-forward",
          depthOffset + p.currentDepth,
          p.txsFetched + backFetchCount,
        ),
        existingChildren,
        outspends ?? undefined,
        entityBarrier,
      );
      forwardLayers = fwdResult.layers;
      forwardFailed = fwdResult.aborted || fwdResult.failedFetches > 0;
    } catch {
      forwardFailed = true;
    }

    clearTimeout(forwardTimer);
    controller.signal.removeEventListener("abort", onParentAbort);
  }

  return { backwardLayers, forwardLayers, backwardFailed, forwardFailed };
}

/** Parameters for chain analysis (post-trace heuristic phase). */
interface ChainAnalysisParams {
  tx: MempoolTransaction;
  /** Chain findings are appended to `result.findings`. */
  result: { findings: Finding[] };
  backwardLayers: TraceLayer[];
  forwardLayers: TraceLayer[];
  parentTx: MempoolTransaction | null;
  childTx: MempoolTransaction | null;
  outspends: MempoolOutspend[] | null;
  onStep: (stepId: string, impact?: number) => void;
}

/**
 * Run post-trace chain analysis heuristics (backward, forward, clustering,
 * spending patterns, entity proximity, taint, linkability).
 * Mutates `result.findings` in place to match the original behavior.
 */
export async function runChainAnalysis(params: ChainAnalysisParams): Promise<void> {
  const { tx, result, backwardLayers, forwardLayers, parentTx, childTx, outspends, onStep } = params;
  const hasTraceLayers = backwardLayers.length > 0 || forwardLayers.length > 0;

  // Build index-keyed maps from trace layers
  const parentTxsByIdx = buildParentTxsByIdx(tx, backwardLayers, parentTx);
  const childTxsByIdx = buildChildTxsByIdx(outspends, forwardLayers, childTx);

  // 1. Backward analysis (input provenance)
  let coinJoinInputIndices: number[] = [];
  onStep("chain-backward");
  await tick();
  if (parentTxsByIdx.size > 0) {
    const backwardResult = analyzeBackward(tx, parentTxsByIdx);
    result.findings.push(...backwardResult.findings);
    coinJoinInputIndices = backwardResult.coinJoinInputs;
    onStep("chain-backward", sumImpact(backwardResult.findings));
  } else {
    onStep("chain-backward", 0);
  }

  // 2. Forward analysis (output destinations)
  onStep("chain-forward");
  await tick();
  if (childTxsByIdx.size > 0 && outspends) {
    const forwardResult = analyzeForward(tx, outspends, childTxsByIdx);
    result.findings.push(...forwardResult.findings);
    onStep("chain-forward", sumImpact(forwardResult.findings));
  } else {
    onStep("chain-forward", 0);
  }

  // 3. Address clustering
  onStep("chain-cluster");
  await tick();
  if (hasTraceLayers) {
    const txsByAddress = buildTxsByAddress(tx, backwardLayers, forwardLayers);
    // Use first input address as seed
    const seedAddr = tx.vin[0]?.prevout?.scriptpubkey_address;
    if (seedAddr) {
      const clusterResult = buildCluster(seedAddr, txsByAddress);
      result.findings.push(...clusterResult.findings);
      onStep("chain-cluster", sumImpact(clusterResult.findings));
    } else {
      onStep("chain-cluster", 0);
    }
  } else {
    onStep("chain-cluster", 0);
  }

  // 4. Spending patterns
  onStep("chain-spending");
  await tick();
  {
    // Build flat map of ALL backward txs across all trace layers for multi-hop ricochet detection
    const allBackwardTxs = new Map<string, MempoolTransaction>();
    for (const layer of backwardLayers) {
      for (const [txid, btx] of layer.txs) allBackwardTxs.set(txid, btx);
    }
    const spResult = analyzeSpendingPatterns(
      tx,
      parentTxsByIdx,
      coinJoinInputIndices,
      outspends,
      childTxsByIdx,
      allBackwardTxs,
    );
    result.findings.push(...spResult.findings);
    onStep("chain-spending", sumImpact(spResult.findings));
  }

  // 5. Entity proximity scan
  onStep("chain-entity");
  await tick();
  if (hasTraceLayers) {
    const proximityResult = analyzeEntityProximity(tx, backwardLayers, forwardLayers);
    result.findings.push(...proximityResult.findings);
    onStep("chain-entity", sumImpact(proximityResult.findings));
  } else {
    onStep("chain-entity", 0);
  }

  // 6. Taint flow analysis
  onStep("chain-taint");
  await tick();
  if (backwardLayers.length > 0) {
    const entityChecker = (addr: string) => {
      const match = matchEntitySync(addr);
      return match ? { category: match.category, entityName: match.entityName } : null;
    };
    const taintResult = analyzeBackwardTaint(tx, backwardLayers, entityChecker);
    result.findings.push(...taintResult.findings);
    onStep("chain-taint", sumImpact(taintResult.findings));
  } else {
    onStep("chain-taint", 0);
  }

  // Linkability matrix analysis (pure computation, no API calls)
  {
    const linkResult = buildLinkabilityMatrix(tx);
    if (linkResult) {
      result.findings.push(...linkResult.findings);
    }
  }

  // Emit trace summary so TaintPathDiagram can show hops even without entity findings
  if (hasTraceLayers) {
    result.findings.push({
      id: "chain-trace-summary",
      severity: "good",
      confidence: "high",
      title: `Chain traced ${backwardLayers.length} hops backward, ${forwardLayers.length} hops forward`,
      description: "",
      recommendation: "",
      scoreImpact: 0,
      params: {
        backwardDepth: backwardLayers.length,
        forwardDepth: forwardLayers.length,
      },
    } satisfies Finding);
  }

  // Enrich chain findings with adversary tier and temporality metadata
  enrichFindingsWithMetadata(result.findings);
}
