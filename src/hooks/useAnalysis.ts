"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { NETWORK_CONFIG } from "@/lib/bitcoin/networks";
import { detectInputType } from "@/lib/analysis/detect-input";
import {
  analyzeTransaction,
  analyzeAddress,
  analyzeDestination,
  analyzeTransactionsForAddress,
  getTxHeuristicSteps,
  getAddressHeuristicSteps,
  type HeuristicStep,
  type PreSendResult,
} from "@/lib/analysis/orchestrator";
import { checkOfac } from "@/lib/analysis/cex-risk/ofac-check";
import { needsEnrichment, enrichPrevouts, countNullPrevouts } from "@/lib/api/enrich-prevouts";
import { parsePSBT, type PSBTParseResult } from "@/lib/bitcoin/psbt";
import { traceBackward, traceForward, type TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import { analyzeEntityProximity } from "@/lib/analysis/chain/entity-proximity";
import { analyzeBackwardTaint } from "@/lib/analysis/chain/taint";
import { analyzeBackward } from "@/lib/analysis/chain/backward";
import { analyzeForward } from "@/lib/analysis/chain/forward";
import { buildCluster } from "@/lib/analysis/chain/clustering";
import { analyzeSpendingPatterns } from "@/lib/analysis/chain/spending-patterns";
import { getAnalysisSettings } from "@/hooks/useAnalysisSettings";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { loadEntityFilter } from "@/lib/analysis/entity-filter";
import type { ScoringResult, InputType, TxAnalysisResult, Finding } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";
import type { HeuristicTranslator } from "@/lib/analysis/heuristics/types";

type AnalysisPhase =
  | "idle"
  | "fetching"
  | "analyzing"
  | "complete"
  | "error";

export interface FetchProgress {
  status: "fetching-tx" | "tracing-backward" | "tracing-forward" | "done";
  timeoutSec: number;
  currentDepth: number;
  maxDepth: number;
  txsFetched: number;
}

interface AnalysisState {
  phase: AnalysisPhase;
  query: string | null;
  inputType: InputType | null;
  steps: HeuristicStep[];
  result: ScoringResult | null;
  txData: MempoolTransaction | null;
  addressData: import("@/lib/api/types").MempoolAddress | null;
  addressTxs: MempoolTransaction[] | null;
  addressUtxos: import("@/lib/api/types").MempoolUtxo[] | null;
  txBreakdown: TxAnalysisResult[] | null;
  preSendResult: PreSendResult | null;
  error: string | null;
  /** Error classification for UI logic (e.g. hide retry on non-retryable errors) */
  errorCode: "retryable" | "not-retryable" | null;
  durationMs: number | null;
  /** USD per BTC at the time the transaction was confirmed (mainnet only). */
  usdPrice: number | null;
  /** Per-output spend status (null = not fetched yet). */
  outspends: import("@/lib/api/types").MempoolOutspend[] | null;
  /** Parsed PSBT metadata (only set when input is a PSBT). */
  psbtData: PSBTParseResult | null;
  /** Progress during fetch/trace phase. */
  fetchProgress: FetchProgress | null;
  /** Backward trace layers from recursive tracing. */
  backwardLayers: TraceLayer[] | null;
  /** Forward trace layers from recursive tracing. */
  forwardLayers: TraceLayer[] | null;
}

const INITIAL_STATE: AnalysisState = {
  phase: "idle",
  query: null,
  inputType: null,
  steps: [],
  result: null,
  txData: null,
  addressData: null,
  addressTxs: null,
  addressUtxos: null,
  txBreakdown: null,
  preSendResult: null,
  error: null,
  errorCode: null,
  durationMs: null,
  usdPrice: null,
  outspends: null,
  psbtData: null,
  fetchProgress: null,
  backwardLayers: null,
  forwardLayers: null,
};

/** Build a finding for missing prevout data after enrichment. */
function makeIncompletePrevoutFinding(remainingNulls: number, isAddress = false): Finding {
  return {
    id: "api-incomplete-prevout",
    severity: "low",
    title: `${remainingNulls} input${remainingNulls > 1 ? "s" : ""} missing data${isAddress ? " across transactions" : ""}`,
    description:
      `Could not retrieve full data for ${remainingNulls} transaction input${remainingNulls > 1 ? "s" : ""}. ` +
      "Some heuristics (CIOH, entropy, change detection, script type analysis) may be incomplete. " +
      "This typically happens with self-hosted mempool instances.",
    recommendation:
      "For complete analysis, try using the public mempool.space API or upgrade your self-hosted instance to mempool/electrs.",
    scoreImpact: 0,
  };
}

/** Build the PreSendResult for an OFAC-sanctioned address. */
function makeOfacPreSendResult(
  t: (key: string, opts?: Record<string, unknown>) => string,
): PreSendResult {
  return {
    riskLevel: "CRITICAL",
    summaryKey: "presend.adviceCritical",
    summary: t("presend.adviceCritical", { defaultValue: "Do NOT send to this address. It poses severe privacy or legal risks." }),
    findings: [
      {
        id: "h13-presend-check",
        severity: "critical",
        params: { riskLevel: "CRITICAL" },
        title: t("finding.h13-presend-check.title", { riskLevel: "CRITICAL", defaultValue: "Destination risk: CRITICAL" }),
        description: t("presend.adviceCritical", { defaultValue: "Do NOT send to this address. It poses severe privacy or legal risks." }),
        recommendation: t("finding.h13-ofac-match.recommendation", { defaultValue: "Do NOT send funds to this address. Consult legal counsel if you have already transacted with this address." }),
        scoreImpact: 0,
      },
      {
        id: "h13-ofac-match",
        severity: "critical",
        title: t("finding.h13-ofac-match.title", { defaultValue: "OFAC sanctioned address" }),
        description: t("finding.h13-ofac-match.description", { defaultValue: "This address matches an entry on the U.S. Treasury OFAC Specially Designated Nationals (SDN) list. Transacting with sanctioned addresses may have serious legal consequences." }),
        recommendation: t("finding.h13-ofac-match.recommendation", { defaultValue: "Do NOT send funds to this address. Consult legal counsel if you have already transacted with this address." }),
        scoreImpact: -100,
      },
    ],
    txCount: 0,
    timesReceived: 0,
    totalReceived: 0,
  };
}

/** Mark all heuristic steps as done (used when analysis completes or errors). */
function markAllDone(steps: HeuristicStep[]): HeuristicStep[] {
  return steps.map((s) => ({ ...s, status: "done" as const }));
}

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const { network, config } = useNetwork();
  const { t } = useTranslation();
  const abortRef = useRef<AbortController | null>(null);

  // Auto-load core entity filter on mount
  useEffect(() => { loadEntityFilter(); }, []);

  // Wrap t as HeuristicTranslator for passing into analysis layer
  const ht: HeuristicTranslator = useCallback(
    (key: string, options?: Record<string, unknown>) => t(key, options),
    [t],
  );

  /** Shared step-update callback for diagnostic loader progress. */
  const onStep = useCallback((stepId: string, impact?: number) => {
    setState((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => {
        if (s.id === stepId) {
          if (impact !== undefined) {
            return { ...s, status: "done" as const, impact };
          }
          return { ...s, status: "running" as const };
        }
        if (s.status === "running") {
          return { ...s, status: "done" as const };
        }
        return s;
      }),
    }));
  }, []);

  const isCustomApi =
    config.mempoolBaseUrl !== NETWORK_CONFIG[network].mempoolBaseUrl;

  const analyze = useCallback(
    async (input: string) => {
      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const inputType = detectInputType(input, network);

      if (inputType === "invalid") {
        setState({
          ...INITIAL_STATE,
          phase: "error",
          query: input,
          inputType: "invalid",
          error: t("errors.invalid_input", { defaultValue: "Invalid Bitcoin address or transaction ID." }),
          errorCode: "not-retryable",
        });
        return;
      }

      // xpub/descriptor inputs are handled by useWalletAnalysis, not here
      if (inputType === "xpub") {
        setState({
          ...INITIAL_STATE,
          phase: "error",
          query: input,
          inputType: "xpub",
          error: "xpub",
          errorCode: "not-retryable",
        });
        return;
      }

      // PSBT: parse locally and run tx heuristics without API calls
      if (inputType === "psbt") {
        const steps = getTxHeuristicSteps(ht);
        const startTime = Date.now();
        setState({
          ...INITIAL_STATE,
          phase: "analyzing",
          query: input.slice(0, 32) + "...",
          inputType: "psbt",
          steps,
        });

        try {
          const psbtResult = parsePSBT(input);
          const result = await analyzeTransaction(psbtResult.tx, undefined, onStep);
          if (controller.signal.aborted) return;
          // No trace data for PSBTs - mark all chain steps as done
          for (const cid of ["chain-backward", "chain-forward", "chain-cluster", "chain-spending", "chain-entity", "chain-taint"]) {
            onStep(cid); onStep(cid, 0);
          }

          setState((prev) => ({
            ...prev,
            phase: "complete",
            steps: markAllDone(prev.steps),
            result,
            txData: psbtResult.tx,
            psbtData: psbtResult,
            durationMs: Date.now() - startTime,
          }));
        } catch (err) {
          if (controller.signal.aborted) return;
          setState((prev) => ({
            ...prev,
            phase: "error",
            error: err instanceof Error
              ? t("errors.psbt_parse", { defaultValue: `Failed to parse PSBT: ${err.message}` })
              : t("errors.unexpected", { defaultValue: "An unexpected error occurred." }),
            errorCode: "not-retryable",
          }));
        }
        return;
      }

      const api = createApiClient(config, controller.signal);

      const steps =
        inputType === "txid"
          ? getTxHeuristicSteps(ht)
          : getAddressHeuristicSteps(ht);

      const startTime = Date.now();

      setState({
        ...INITIAL_STATE,
        phase: "fetching",
        query: input,
        inputType,
        steps,
      });

      try {
        if (inputType === "txid") {
          const [tx, rawHex] = await Promise.all([
            api.getTransaction(input),
            api.getTxHex(input).catch(() => undefined),
          ]);

          // Enrich missing prevout data for self-hosted mempool backends
          if (needsEnrichment([tx])) {
            await enrichPrevouts([tx], {
              getTransaction: (txid) => api.getTransaction(txid),
              signal: controller.signal,
            });
          }

          // Fetch historical fiat prices + outspend data for confirmed txs
          // Also pre-fetch parent tx for peel chain detection (only for 1-input txs)
          let usdPrice: number | null = null;
          let eurPrice: number | null = null;
          let outspends: import("@/lib/api/types").MempoolOutspend[] | null = null;
          let parentTx: MempoolTransaction | null = null;
          const isPeelCandidate = tx.vin.length === 1 && !tx.vin[0].is_coinbase;
          const parentTxPromise = isPeelCandidate
            ? api.getTransaction(tx.vin[0].txid).catch(() => null)
            : Promise.resolve(null);

          if (network === "mainnet" && tx.status?.block_time) {
            [usdPrice, eurPrice, outspends, parentTx] = await Promise.all([
              api.getHistoricalPrice(tx.status.block_time).catch(() => null),
              api.getHistoricalEurPrice(tx.status.block_time).catch(() => null),
              api.getTxOutspends(input).catch(() => null),
              parentTxPromise,
            ]);
          } else if (tx.status?.confirmed) {
            [outspends, parentTx] = await Promise.all([
              api.getTxOutspends(input).catch(() => null),
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
              childTx = await api.getTransaction(spentEntry.txid).catch(() => null);
            }
          }

          // Pre-fetch output address tx counts for fresh address change detection (H2 sub-heuristic 8)
          // Only for 2-output txs (the change detection heuristic only applies to these)
          let outputTxCounts: Map<string, number> | undefined;
          const spendableOuts = tx.vout.filter(
            (v) => v.scriptpubkey_type !== "op_return" && v.scriptpubkey_address && v.value > 0,
          );
          if (spendableOuts.length === 2) {
            const addrs = spendableOuts.map((v) => v.scriptpubkey_address!);
            const counts = await Promise.all(
              addrs.map((addr) =>
                api.getAddress(addr)
                  .then((a) => a.chain_stats.tx_count + a.mempool_stats.tx_count)
                  .catch(() => -1),
              ),
            );
            if (counts.every((c) => c >= 0)) {
              outputTxCounts = new Map(addrs.map((a, i) => [a, counts[i]]));
            }
          }

          // --- Recursive tracing (chain analysis) ---
          const analysisSettings = getAnalysisSettings();
          let backwardLayers: TraceLayer[] = [];
          let forwardLayers: TraceLayer[] = [];
          const totalMaxDepth = analysisSettings.maxDepth * 2; // backward + forward

          if (analysisSettings.maxDepth >= 1 && !controller.signal.aborted) {
            const traceAbort = new AbortController();
            const onParentAbort = () => traceAbort.abort();
            controller.signal.addEventListener("abort", onParentAbort);
            const traceTimer = setTimeout(
              () => traceAbort.abort(),
              analysisSettings.timeout * 1000,
            );

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
                    timeoutSec: analysisSettings.timeout,
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

            const traceFetcher = {
              getTransaction: (txid: string) => api.getTransaction(txid),
              getTxOutspends: (txid: string) => api.getTxOutspends(txid),
            };

            try {
              setState((prev) => ({
                ...prev,
                fetchProgress: {
                  status: "tracing-backward",
                  timeoutSec: analysisSettings.timeout,
                  currentDepth: 0,
                  maxDepth: totalMaxDepth,
                  txsFetched: 0,
                },
              }));

              const backResult = await traceBackward(
                tx,
                analysisSettings.maxDepth,
                analysisSettings.minSats,
                traceFetcher,
                traceAbort.signal,
                (p) => updateFetchProgress("tracing-backward", p.currentDepth, p.txsFetched),
                existingParents,
              );
              backwardLayers = backResult.layers;

              if (!traceAbort.signal.aborted) {
                // Forward depths continue from where backward left off
                const depthOffset = analysisSettings.maxDepth;
                setState((prev) => ({
                  ...prev,
                  fetchProgress: {
                    status: "tracing-forward",
                    timeoutSec: analysisSettings.timeout,
                    currentDepth: depthOffset,
                    maxDepth: totalMaxDepth,
                    txsFetched: backResult.fetchCount,
                  },
                }));

                const fwdResult = await traceForward(
                  tx,
                  analysisSettings.maxDepth,
                  analysisSettings.minSats,
                  traceFetcher,
                  traceAbort.signal,
                  (p) => updateFetchProgress(
                    "tracing-forward",
                    depthOffset + p.currentDepth,
                    p.txsFetched + backResult.fetchCount,
                  ),
                  existingChildren,
                  outspends ?? undefined,
                );
                forwardLayers = fwdResult.layers;
              }
            } catch {
              // Tracing failed or timed out - proceed with whatever was collected
            }

            clearTimeout(traceTimer);
            controller.signal.removeEventListener("abort", onParentAbort);
          }

          if (controller.signal.aborted) return;

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

          const ctx: import("@/lib/analysis/heuristics/types").TxContext = {
            ...(usdPrice ? { usdPrice } : {}),
            ...(eurPrice ? { eurPrice } : {}),
            isCustomApi,
            ...(parentTx ? { parentTx } : {}),
            ...(childTx ? { childTx } : {}),
            ...(outputTxCounts ? { outputTxCounts } : {}),
          };
          const result = await analyzeTransaction(tx, rawHex, onStep, ctx);
          if (controller.signal.aborted) return;

          // --- Chain analysis from trace layers ---
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
            onStep("chain-backward", backwardResult.findings.reduce((s, f) => s + f.scoreImpact, 0));
          } else {
            onStep("chain-backward", 0);
          }

          // 2. Forward analysis (output destinations)
          onStep("chain-forward");
          await tick50();
          if (childTxsByIdx.size > 0 && outspends) {
            const forwardResult = analyzeForward(tx, outspends, childTxsByIdx);
            result.findings.push(...forwardResult.findings);
            onStep("chain-forward", forwardResult.findings.reduce((s, f) => s + f.scoreImpact, 0));
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
              onStep("chain-cluster", clusterResult.findings.reduce((s, f) => s + f.scoreImpact, 0));
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
            const spResult = analyzeSpendingPatterns(
              tx,
              parentTxsByIdx,
              coinJoinInputIndices,
              outspends,
              childTxsByIdx,
            );
            result.findings.push(...spResult.findings);
            onStep("chain-spending", spResult.findings.reduce((s, f) => s + f.scoreImpact, 0));
          }

          // 5. Entity proximity scan
          onStep("chain-entity");
          await tick50();
          if (hasTraceLayers) {
            const proximityResult = analyzeEntityProximity(tx, backwardLayers, forwardLayers);
            result.findings.push(...proximityResult.findings);
            onStep("chain-entity", proximityResult.findings.reduce((s, f) => s + f.scoreImpact, 0));
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
            onStep("chain-taint", taintResult.findings.reduce((s, f) => s + f.scoreImpact, 0));
          } else {
            onStep("chain-taint", 0);
          }

          // If prevout data is still missing after enrichment, warn the user
          const remainingNulls = countNullPrevouts([tx]);
          if (remainingNulls > 0) {
            result.findings.push(makeIncompletePrevoutFinding(remainingNulls));
          }

          setState((prev) => ({
            ...prev,
            phase: "complete",
            steps: markAllDone(prev.steps),
            result,
            durationMs: Date.now() - startTime,
          }));
        } else {
          // OFAC pre-flight check (no network needed)
          const ofacResult = checkOfac([input]);
          if (ofacResult.sanctioned) {
            setState({
              ...INITIAL_STATE,
              phase: "complete",
              query: input,
              inputType: "address",
              steps: steps.map((s) => ({ ...s, status: "done" as const })),
              preSendResult: makeOfacPreSendResult(t),
              durationMs: Date.now() - startTime,
            });
            return;
          }

          // Fetch address data - UTXOs may fail for addresses with >500 UTXOs
          const [address, utxos, txs] = await Promise.all([
            api.getAddress(input),
            api.getAddressUtxos(input).catch(() => [] as import("@/lib/api/types").MempoolUtxo[]),
            api.getAddressTxs(input).catch(() => [] as import("@/lib/api/types").MempoolTransaction[]),
          ]);

          // Enrich missing prevout data for self-hosted mempool backends
          if (txs.length > 0 && needsEnrichment(txs)) {
            await enrichPrevouts(txs, {
              getTransaction: (txid) => api.getTransaction(txid),
              signal: controller.signal,
              maxParentTxids: 50,
            });
          }

          setState((prev) => ({ ...prev, phase: "analyzing", addressData: address }));

          const totalTxCount = address.chain_stats.tx_count + address.mempool_stats.tx_count;
          const isFreshAddress = totalTxCount === 0;

          // Fresh address: no transactions, nothing to score - only run destination check
          if (isFreshAddress) {
            const preSendResult = await analyzeDestination(address, utxos, txs, onStep);

            setState((prev) => ({
              ...prev,
              phase: "complete",
              steps: markAllDone(prev.steps),
              preSendResult,
              durationMs: Date.now() - startTime,
            }));
          } else {
            // Run both address analysis AND destination check on the same data
            const [result, preSendResult] = await Promise.all([
              analyzeAddress(address, utxos, txs, onStep),
              analyzeDestination(address, utxos, txs),
            ]);
            if (controller.signal.aborted) return;

            // Run per-tx heuristic breakdown for address analysis
            const txBreakdown = txs.length > 0
              ? await analyzeTransactionsForAddress(input, txs)
              : null;
            if (controller.signal.aborted) return;

            // If prevout data is still missing after enrichment, warn the user
            if (txs.length > 0) {
              const remainingNulls = countNullPrevouts(txs);
              if (remainingNulls > 0) {
                result.findings.push(makeIncompletePrevoutFinding(remainingNulls, true));
              }
            }

            setState((prev) => ({
              ...prev,
              phase: "complete",
              steps: markAllDone(prev.steps),
              result,
              preSendResult,
              addressTxs: txs.length > 0 ? txs : null,
              addressUtxos: utxos.length > 0 ? utxos : null,
              txBreakdown,
              durationMs: Date.now() - startTime,
            }));
          }
        }
      } catch (err) {
        // Ignore aborted requests (user started a new analysis)
        if (controller.signal.aborted) return;

        // For address queries, even when API fails, check OFAC locally
        if (inputType === "address") {
          const fallbackOfac = checkOfac([input]);
          if (fallbackOfac.sanctioned) {
            setState((prev) => ({
              ...prev,
              phase: "complete",
              steps: markAllDone(prev.steps),
              preSendResult: makeOfacPreSendResult(t),
              durationMs: Date.now() - startTime,
            }));
            return;
          }
        }

        let message = t("errors.unexpected", { defaultValue: "An unexpected error occurred." });
        let errorCode: "retryable" | "not-retryable" = "retryable";
        if (err instanceof ApiError) {
          switch (err.code) {
            case "NOT_FOUND":
              message = t("errors.not_found", { defaultValue: "Not found. Check that the address or transaction ID is correct and exists on the selected network." });
              errorCode = "not-retryable";
              break;
            case "INVALID_INPUT":
              errorCode = "not-retryable";
              break;
            case "RATE_LIMITED":
              message = t("errors.rate_limited", { defaultValue: "Rate limited by mempool.space. Please wait a moment and try again." });
              break;
            case "NETWORK_ERROR":
              message = isCustomApi
                ? t("errors.network_custom", { defaultValue: "Connection to your custom endpoint failed. Open API settings to troubleshoot." })
                : t("errors.network", { defaultValue: "Network error. Check your internet connection or try again later." });
              break;
            case "API_UNAVAILABLE":
              message = isCustomApi
                ? t("errors.api_custom", { defaultValue: "Your custom API endpoint returned an error. Check that it is running." })
                : t("errors.api_unavailable", { defaultValue: "The API is temporarily unavailable. Please try again later." });
              break;
          }
        } else if (err instanceof Error) {
          console.error("Analysis error:", err.name);
          message = t("errors.unexpected", { defaultValue: "An unexpected error occurred." });
        }
        setState((prev) => ({
          ...prev,
          phase: "error",
          error: message,
          errorCode,
        }));
      }
    },
    [network, config, isCustomApi, t, ht, onStep],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  // Abort in-flight requests on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  return { ...state, analyze, reset };
}
