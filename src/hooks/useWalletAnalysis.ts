"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient, isLocalApi } from "@/lib/api/client";
import { getAnalysisSettings } from "@/hooks/useAnalysisSettings";
import { DEFAULT_ANALYSIS_SETTINGS } from "@/lib/analysis/settings";
import {
  parseXpub,
  deriveOneAddress,
  isDescriptor,
  type DescriptorParseResult,
  type ScriptType,
} from "@/lib/bitcoin/descriptor";
import type { WalletAuditResult, WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { UtxoTraceResult } from "@/lib/wallet/scan";
import { mapApiErrorMessage } from "@/lib/api/error-message";
import { loadEngine } from "@/lib/analysis/load-engine";
import { detectAddressNetwork } from "@/lib/api/detect-network";
import { NETWORK_CONFIG, type BitcoinNetwork } from "@/lib/bitcoin/networks";

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
  /** Set when the key belongs to another network and the scan switched to it */
  autoSwitchedNetwork: BitcoinNetwork | null;
  /** The address type of a bare xpub/tpub was guessed from on-chain history */
  scriptTypeDetected: boolean;
  /** Consecutive unused addresses the scan stopped after */
  gapLimit: number | null;
}

/** Wallet software's usual gap limit; used on self-hosted backends, which have no throttle. */
export const STANDARD_GAP_LIMIT = 20;

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
  autoSwitchedNetwork: null,
  scriptTypeDetected: false,
  gapLimit: null,
};

// ---------- Hook ----------

export function useWalletAnalysis() {
  const [state, setState] = useState<WalletAnalysisState>(INITIAL_STATE);
  const { t } = useTranslation();
  const { network, setNetwork, config, configFor, customApiUrl, isUmbrel, isCustomApi } = useNetwork();
  const abortRef = useRef<AbortController | null>(null);

  const analyze = useCallback(
    async (input: string, scriptTypeOverride?: ScriptType, gapLimitOverride?: number) => {
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
        let parsed = parseXpub(input, scriptTypeOverride);

        // A key for another network (tpub on mainnet, xpub on signet): on public
        // mempool.space scan where its addresses live, like a single address does.
        // A self-hosted or custom backend cannot answer for another network.
        let cfg = config;
        let switchedTo: BitcoinNetwork | null = null;
        if ((parsed.network === "mainnet") !== (network === "mainnet")) {
          const first = deriveOneAddress(parsed, parsed.singleChain === 1 ? 1 : 0, 0).address;
          const detected = isUmbrel || customApiUrl
            ? null
            : await detectAddressNetwork(first, network, controller.signal, (n) => configFor(n).mempoolBaseUrl);
          if (controller.signal.aborted) return;
          if (!detected) {
            throw new Error(t("errors.walletWrongNetwork", {
              keyNetwork: parsed.network === "mainnet" ? "Mainnet" : "Testnet/Signet",
              network: NETWORK_CONFIG[network].label,
              defaultValue: "This key belongs to {{keyNetwork}}, but the connected backend serves {{network}}. Its addresses cannot be looked up there.",
            }));
          }
          cfg = configFor(detected);
          switchedTo = detected;
          setNetwork(detected);
        }

        const engine = await loadEngine();
        if (controller.signal.aborted) return;
        const api = createApiClient(cfg, controller.signal);

        // A bare xpub/tpub (the "legacy" prefix) can be any address type
        const bareKey = !scriptTypeOverride && !isDescriptor(input) && parsed.scriptType === "p2pkh";
        if (bareKey) {
          parsed = { ...parsed, scriptType: await engine.detectScriptType(parsed, api) };
          if (controller.signal.aborted) return;
        }

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
          autoSwitchedNetwork: switchedTo,
          scriptTypeDetected: bareKey,
        }));

        const {
          scanChain, walletChains, collectWalletTxs, traceWalletTxs, UTXO_TRACE_DEPTH, auditWallet, buildTraceBarrier,
        } = engine;

        // Step 2: Incrementally derive + fetch addresses.
        const localApi = isLocalApi(cfg.mempoolBaseUrl);
        const { walletGapLimit: saved, minSats } = getAnalysisSettings();
        // The low default keeps hosted scans short (throttled); a self-hosted backend scans like a wallet
        const walletGapLimit = gapLimitOverride
          ?? (localApi && saved === DEFAULT_ANALYSIS_SETTINGS.walletGapLimit ? STANDARD_GAP_LIMIT : saved);
        setState(prev => ({ ...prev, gapLimit: walletGapLimit }));
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
        for (const chain of walletChains(parsed)) {
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

        // Parse errors (invalid xpub/descriptor) carry a useful message;
        // descriptor.ts throws English, so translate the checksum ones here
        const raw = err instanceof Error ? err.message : undefined;
        const fallback = raw?.startsWith("Invalid descriptor checksum format")
          ? t("errors.descriptorChecksumFormat", { defaultValue: "Invalid descriptor checksum format: expected 8 characters after '#'." })
          : raw?.startsWith("Descriptor checksum mismatch")
            ? t("errors.descriptorChecksumMismatch", { defaultValue: "Descriptor checksum mismatch: the descriptor may be mistyped or truncated." })
            : raw;
        const { message } = mapApiErrorMessage(err, t, { isUmbrel, isCustomApi, fallback });

        setState(prev => ({
          ...prev,
          phase: "error",
          error: message,
        }));
      }
    },
    [network, setNetwork, config, configFor, customApiUrl, t, isUmbrel, isCustomApi],
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
