import { traceBackward, traceForward, type TraceLayer, type EntityBarrierCheck } from "@/lib/analysis/chain/recursive-trace";
import { analyzeEntityProximity } from "@/lib/analysis/chain/entity-proximity";
import { analyzeBackwardTaint } from "@/lib/analysis/chain/taint";
import { analyzeBackward } from "@/lib/analysis/chain/backward";
import { analyzeForward } from "@/lib/analysis/chain/forward";
import { buildCluster } from "@/lib/analysis/chain/clustering";
import { analyzeSpendingPatterns } from "@/lib/analysis/chain/spending-patterns";
import { buildLinkabilityMatrix } from "@/lib/analysis/chain/linkability";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import type { AnalysisSettings } from "@/hooks/useAnalysisSettings";
import type { FetchProgress, AnalysisState } from "@/hooks/useAnalysisState";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import { sumImpact } from "@/lib/scoring/score";
import type { ScoringResult, Finding } from "@/lib/types";

/** Parameters for the chain analysis phase. */
interface ChainTraceParams {
  tx: MempoolTransaction;
  settings: AnalysisSettings;
  api: {
    getTransaction: (txid: string) => Promise<MempoolTransaction>;
    getTxOutspends: (txid: string) => Promise<MempoolOutspend[]>;
  };
  controller: AbortController;
  setState: React.Dispatch<React.SetStateAction<AnalysisState>>;
  onStep: (stepId: string, impact?: number) => void;
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

/**
 * Run the recursive backward/forward tracing phase.
 * Returns the trace layers (may be empty if depth is 0 or tracing times out).
 */
export async function runChainTrace(params: ChainTraceParams): Promise<ChainTraceResult> {
  const { tx, settings, api, controller, setState, parentTx, childTx, outspends } = params;

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
      setState((prev) => ({
        ...prev,
        fetchProgress: {
          status,
          timeoutSec: settings.timeout,
          currentDepth,
          maxDepth: totalMaxDepth,
          txsFetched,
        },
      }));
    }
  };

  // Build existing data maps to avoid re-fetching depth-1
  const existingParents = new Map<string, MempoolTransaction>();
  if (parentTx) existingParents.set(parentTx.txid, parentTx);
  const existingChildren = new Map<string, MempoolTransaction>();
  if (childTx) existingChildren.set(childTx.txid, childTx);

  // Entity barrier: stop tracing through known custodial entities (exchanges, etc.)
  // because they break chain of custody - no link between deposits and withdrawals.
  const entityBarrier: EntityBarrierCheck = (btx) => {
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

  // --- Phase 1: Backward tracing (first half of timeout) ---
  {
    const backwardAbort = new AbortController();
    const onParentAbort = () => backwardAbort.abort();
    controller.signal.addEventListener("abort", onParentAbort);
    const backwardTimer = setTimeout(() => backwardAbort.abort(), halfTimeout);

    try {
      setState((prev) => ({
        ...prev,
        fetchProgress: {
          status: "tracing-backward",
          timeoutSec: settings.timeout,
          currentDepth: 0,
          maxDepth: totalMaxDepth,
          txsFetched: 0,
        },
      }));

      const backResult = await traceBackward(
        tx,
        settings.maxDepth,
        settings.minSats,
        api,
        backwardAbort.signal,
        (p) => updateFetchProgress("tracing-backward", p.currentDepth, p.txsFetched),
        existingParents,
        entityBarrier,
      );
      backwardLayers = backResult.layers;
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

      setState((prev) => ({
        ...prev,
        fetchProgress: {
          status: "tracing-forward",
          timeoutSec: settings.timeout,
          currentDepth: depthOffset,
          maxDepth: totalMaxDepth,
          txsFetched: backFetchCount,
        },
      }));

      const fwdResult = await traceForward(
        tx,
        settings.maxDepth,
        settings.minSats,
        api,
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
  result: ScoringResult;
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
  const tick50 = () => new Promise<void>((r) => setTimeout(r, 50));
  const hasTraceLayers = backwardLayers.length > 0 || forwardLayers.length > 0;

  // Build parentTxsByIdx (input index -> parent tx) from depth-1 backward layer
  const parentTxsByIdx = new Map<number, MempoolTransaction>();
  if (backwardLayers.length > 0) {
    const depth1 = backwardLayers[0];
    for (let i = 0; i < tx.vin.length; i++) {
      if (tx.vin[i].is_coinbase) continue;
      const ptx = depth1.txs.get(tx.vin[i].txid);
      if (ptx) parentTxsByIdx.set(i, ptx);
    }
  }
  // Also use the pre-fetched single parentTx if we have it
  if (parentTx && tx.vin.length === 1 && !parentTxsByIdx.has(0)) {
    parentTxsByIdx.set(0, parentTx);
  }

  // Build childTxsByIdx (output index -> child tx) from depth-1 forward layer
  const childTxsByIdx = new Map<number, MempoolTransaction>();
  if (forwardLayers.length > 0 && outspends) {
    const depth1 = forwardLayers[0];
    for (let i = 0; i < outspends.length; i++) {
      const os = outspends[i];
      if (os?.spent && os.txid) {
        const ctxn = depth1.txs.get(os.txid);
        if (ctxn) childTxsByIdx.set(i, ctxn);
      }
    }
  }
  // Also use the pre-fetched single childTx
  if (childTx && outspends) {
    for (let i = 0; i < outspends.length; i++) {
      if (outspends[i]?.txid === childTx.txid && !childTxsByIdx.has(i)) {
        childTxsByIdx.set(i, childTx);
      }
    }
  }

  // 1. Backward analysis (input provenance)
  let coinJoinInputIndices: number[] = [];
  onStep("chain-backward");
  await tick50();
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
  await tick50();
  if (childTxsByIdx.size > 0 && outspends) {
    const forwardResult = analyzeForward(tx, outspends, childTxsByIdx);
    result.findings.push(...forwardResult.findings);
    onStep("chain-forward", sumImpact(forwardResult.findings));
  } else {
    onStep("chain-forward", 0);
  }

  // 3. Address clustering
  onStep("chain-cluster");
  await tick50();
  if (hasTraceLayers) {
    // Build txsByAddress from all traced txs
    const txsByAddress = new Map<string, MempoolTransaction[]>();
    const addTxToMap = (atx: MempoolTransaction) => {
      for (const vin of atx.vin) {
        const addr = vin.prevout?.scriptpubkey_address;
        if (addr) {
          const arr = txsByAddress.get(addr) ?? [];
          arr.push(atx);
          txsByAddress.set(addr, arr);
        }
      }
      for (const vout of atx.vout) {
        const addr = vout.scriptpubkey_address;
        if (addr && vout.scriptpubkey_type !== "op_return") {
          const arr = txsByAddress.get(addr) ?? [];
          arr.push(atx);
          txsByAddress.set(addr, arr);
        }
      }
    };
    addTxToMap(tx);
    for (const layer of [...backwardLayers, ...forwardLayers]) {
      for (const [, ltx] of layer.txs) addTxToMap(ltx);
    }
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
  await tick50();
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
  await tick50();
  if (hasTraceLayers) {
    const proximityResult = analyzeEntityProximity(tx, backwardLayers, forwardLayers);
    result.findings.push(...proximityResult.findings);
    onStep("chain-entity", sumImpact(proximityResult.findings));
  } else {
    onStep("chain-entity", 0);
  }

  // 6. Taint flow analysis
  onStep("chain-taint");
  await tick50();
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
    } as Finding);
  }
}
