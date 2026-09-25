"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient, isLocalApi } from "@/lib/api/client";
import { getAnalysisSettings } from "@/hooks/useAnalysisSettings";
import {
  parseXpub,
  type DescriptorParseResult,
  type ScriptType,
} from "@/lib/bitcoin/descriptor";
import { auditWallet, type WalletAuditResult, type WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import {
  scanChain,
  collectWalletTxs,
  traceWalletTxs,
  UTXO_TRACE_DEPTH,
  type UtxoTraceResult,
} from "@/lib/wallet/scan";
import { mapApiErrorMessage } from "@/lib/api/error-message";
import { buildTraceBarrier } from "@/lib/analysis/chain-trace";

export type { UtxoTraceResult } from "@/lib/wallet/scan";

// ---------- Types ----------

type WalletPhase =
  | "idle"
  | "deriving"
  | "fetching"
  | "tracing"
  | "analyzing"
  | "complete"
  | "error";

interface WalletAnalysisState {
  phase: WalletPhase;
  /** Original xpub/descriptor input */
  query: string | null;
  /** Parsed descriptor result (addresses, script type, network) */
  descriptor: DescriptorParseResult | null;
  /** Wallet audit result */
  result: WalletAuditResult | null;
  /** Per-address info (for detail views) */
  addressInfos: WalletAddressInfo[];
  /** Addresses whose data could not be fetched (partial scan when non-empty) */
  failedAddresses: string[];
  /** Pre-fetched UTXO trace data for graph visualization */
  utxoTraces: Map<string, UtxoTraceResult> | null;
  /** Progress: addresses fetched so far / total (0 = unknown) */
  progress: { fetched: number; total: number };
  /** Tracing progress */
  traceProgress: { traced: number; total: number } | null;
  /** Error message */
  error: string | null;
  /** Duration in ms */
  durationMs: number | null;
}

const INITIAL_STATE: WalletAnalysisState = {
  phase: "idle",
  query: null,
  descriptor: null,
  result: null,
  addressInfos: [],
  failedAddresses: [],
  utxoTraces: null,
  progress: { fetched: 0, total: 0 },
  traceProgress: null,
  error: null,
  durationMs: null,
};

// ---------- Hook ----------

export function useWalletAnalysis() {
  const [state, setState] = useState<WalletAnalysisState>(INITIAL_STATE);
  const { t } = useTranslation();
  const { config, isUmbrel, isCustomApi } = useNetwork();
  const abortRef = useRef<AbortController | null>(null);

  const analyze = useCallback(
    async (input: string, scriptTypeOverride?: ScriptType) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const startTime = Date.now();

      setState({
        ...INITIAL_STATE,
        phase: "deriving",
        query: input,
      });

      try {
        // Step 1: Parse xpub/descriptor (no address derivation yet)
        const parsed = parseXpub(input, scriptTypeOverride);

        setState(prev => ({
          ...prev,
          phase: "fetching",
          descriptor: {
            scriptType: parsed.scriptType,
            network: parsed.network,
            receiveAddresses: [],
            changeAddresses: [],
            xpub: parsed.xpub,
          },
          progress: { fetched: 0, total: 0 },
        }));

        // Step 2: Incrementally derive + fetch addresses.
        const api = createApiClient(config, controller.signal);
        const localApi = isLocalApi(config.mempoolBaseUrl);
        const { walletGapLimit, minSats } = getAnalysisSettings();
        const allInfos: WalletAddressInfo[] = [];
        const failedAddresses: string[] = [];
        let fetched = 0;

        const onProgress = (info: WalletAddressInfo) => {
          allInfos.push(info);
          fetched++;
          setState(prev => ({
            ...prev,
            progress: { fetched, total: 0 },
          }));
        };

        // Scan receive chain (0) then change chain (1)
        const chains: (0 | 1)[] =
          parsed.singleChain !== undefined
            ? [parsed.singleChain as 0 | 1]
            : [0, 1];

        for (const chain of chains) {
          if (controller.signal.aborted) return;
          const { failed } = await scanChain(parsed, chain, api, controller.signal, localApi, walletGapLimit, onProgress);
          failedAddresses.push(...failed);
        }

        if (controller.signal.aborted) return;

        // Build final descriptor result from discovered addresses
        const receiveAddresses = allInfos
          .filter(i => !i.derived.isChange)
          .map(i => i.derived);
        const changeAddresses = allInfos
          .filter(i => i.derived.isChange)
          .map(i => i.derived);

        const descriptor: DescriptorParseResult = {
          scriptType: parsed.scriptType,
          network: parsed.network,
          receiveAddresses,
          changeAddresses,
          xpub: parsed.xpub,
        };

        // Step 2.5: Trace wallet tx provenance concurrently
        const utxoTxs = collectWalletTxs(allInfos);
        let utxoTraces: Map<string, UtxoTraceResult> | null = null;

        if (utxoTxs.size > 0) {
          setState(prev => ({
            ...prev,
            phase: "tracing",
            descriptor,
            progress: { fetched, total: fetched },
            traceProgress: { traced: 0, total: utxoTxs.size },
          }));

          const settings = getAnalysisSettings();
          const { maxDepth } = settings;
          const traceResults = await traceWalletTxs(
            utxoTxs,
            api,
            controller.signal,
            // Hosted APIs: one trace at a time to stay under the rate limit
            {
              depth: Math.min(UTXO_TRACE_DEPTH, maxDepth),
              minSats,
              concurrency: localApi ? 3 : 1,
              barrier: buildTraceBarrier(settings),
            },
            (traced) => setState(prev => ({
              ...prev,
              traceProgress: { traced, total: utxoTxs.size },
            })),
          );
          if (controller.signal.aborted) return;

          utxoTraces = traceResults.size > 0 ? traceResults : null;
        }

        // Step 3: Run wallet audit
        setState(prev => ({
          ...prev,
          phase: "analyzing",
          descriptor,
          progress: { fetched, total: fetched },
        }));

        const result = auditWallet(allInfos, failedAddresses);

        setState(prev => ({
          ...prev,
          phase: "complete",
          result,
          addressInfos: allInfos,
          failedAddresses,
          utxoTraces,
          durationMs: Date.now() - startTime,
        }));
      } catch (err) {
        if (controller.signal.aborted) return;

        const { message } = mapApiErrorMessage(err, t, {
          isUmbrel,
          isCustomApi,
          // Parse errors (invalid xpub/descriptor) carry a useful message
          fallback: err instanceof Error ? err.message : undefined,
        });

        setState(prev => ({
          ...prev,
          phase: "error",
          error: message,
        }));
      }
    },
    [config, t, isUmbrel, isCustomApi],
  );

  // Abort in-flight requests on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { ...state, analyze, reset };
}
