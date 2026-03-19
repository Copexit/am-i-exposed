"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient, isLocalApi } from "@/lib/api/client";
import { getAnalysisSettings } from "@/hooks/useAnalysisSettings";
import {
  parseXpub,
  deriveOneAddress,
  type DescriptorParseResult,
  type ScriptType,
  type ParsedXpub,
} from "@/lib/bitcoin/descriptor";
import { auditWallet, type WalletAuditResult, type WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import { traceBackward, traceForward } from "@/lib/analysis/chain/recursive-trace";
import type { MempoolTransaction, MempoolUtxo, MempoolOutspend } from "@/lib/api/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import type { DerivedAddress } from "@/lib/bitcoin/descriptor";
import type { MempoolClient } from "@/lib/api/mempool";

// ---------- Types ----------

type WalletPhase =
  | "idle"
  | "deriving"
  | "fetching"
  | "tracing"
  | "analyzing"
  | "complete"
  | "error";

export interface UtxoTraceResult {
  tx: MempoolTransaction;
  backward: TraceLayer[];
  forward: TraceLayer[];
  outspends: MempoolOutspend[];
}

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
  utxoTraces: null,
  progress: { fetched: 0, total: 0 },
  traceProgress: null,
  error: null,
  durationMs: null,
};

/** Default gap limit if settings unavailable. */
const DEFAULT_GAP_LIMIT = 5;

/** Max UTXO txids to trace (prevents explosion on large wallets). */
const MAX_UTXO_TRACES = 50;

/** Trace depth for UTXO provenance. */
const UTXO_TRACE_DEPTH = 3;

// ---------- Fetch helpers ----------

/** Fetch all 3 endpoints for a single address. */
async function fetchAddress(
  api: MempoolClient,
  derived: DerivedAddress,
): Promise<WalletAddressInfo> {
  const [addressData, utxos, txs] = await Promise.all([
    api.getAddress(derived.address).catch(() => null),
    api.getAddressUtxos(derived.address).catch(() => [] as MempoolUtxo[]),
    api.getAddressTxs(derived.address).catch(() => [] as MempoolTransaction[]),
  ]);
  return { derived, addressData, utxos, txs };
}

/** Returns true if address has any on-chain activity. */
function isUsed(info: WalletAddressInfo): boolean {
  if (info.txs.length > 0) return true;
  if (info.addressData && typeof info.addressData === "object") {
    const stats = info.addressData.chain_stats;
    if (stats && (stats.tx_count > 0 || stats.funded_txo_count > 0)) return true;
  }
  return false;
}

/** Delay that can be cancelled via AbortSignal. */
function abortableDelay(ms: number, abortSignal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { abortSignal.removeEventListener("abort", onAbort); resolve(); }, ms);
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Scan one chain (receive=0 or change=1) incrementally.
 * Derives + fetches one address at a time, stops after gapLimit (configurable)
 * consecutive unused addresses.
 */
async function scanChain(
  parsed: ParsedXpub,
  chain: 0 | 1,
  api: MempoolClient,
  signal: AbortSignal,
  isLocal: boolean,
  gapLimit: number,
  onProgress: (info: WalletAddressInfo) => void,
): Promise<WalletAddressInfo[]> {
  const results: WalletAddressInfo[] = [];
  let consecutiveUnused = 0;
  let index = 0;
  /** Addresses in the initial token bucket (20 tokens / 3 per addr). */
  const BURST_SIZE = 6;
  /** Delay between addresses after burst for hosted APIs. */
  const SUSTAIN_DELAY_MS = 9000;
  /** Small gap between burst addresses. */
  const BURST_GAP_MS = 300;
  /** Track how many addresses have been fetched across this chain for burst logic. */
  let fetchCount = 0;

  while (consecutiveUnused < gapLimit) {
    if (signal.aborted) return results;

    const derived = deriveOneAddress(parsed, chain, index);
    const t0 = performance.now();
    const info = await fetchAddress(api, derived)
      .catch((): WalletAddressInfo => ({
        derived,
        addressData: null,
        txs: [],
        utxos: [],
      }));
    const wasCacheHit = performance.now() - t0 < 100;

    results.push(info);
    onProgress(info);
    if (!wasCacheHit) fetchCount++;

    if (isUsed(info)) {
      consecutiveUnused = 0;
    } else {
      consecutiveUnused++;
    }

    index++;

    // Rate limit for hosted APIs - skip delay on cache hits (IDB reads < 10ms)
    if (!isLocal && !wasCacheHit && consecutiveUnused < gapLimit) {
      const delayMs = fetchCount <= BURST_SIZE ? BURST_GAP_MS : SUSTAIN_DELAY_MS;
      await abortableDelay(delayMs, signal).catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          console.warn("delay failed:", e);
        }
      });
    }
  }

  return results;
}

/**
 * Collect unique transactions that have outputs belonging to the wallet.
 * Includes both spent and unspent outputs. Sorted by wallet output value descending.
 */
function collectWalletTxs(
  allInfos: WalletAddressInfo[],
): Map<string, MempoolTransaction> {
  // Build set of all wallet addresses for output matching
  const walletAddresses = new Set<string>();
  for (const info of allInfos) {
    walletAddresses.add(info.derived.address);
  }

  const txMap = new Map<string, MempoolTransaction>();
  const valueMap = new Map<string, number>();

  for (const info of allInfos) {
    for (const tx of info.txs) {
      if (txMap.has(tx.txid)) continue;
      // Sum outputs belonging to the wallet
      let walletValue = 0;
      for (const vout of tx.vout) {
        if (vout.scriptpubkey_address && walletAddresses.has(vout.scriptpubkey_address)) {
          walletValue += vout.value;
        }
      }
      if (walletValue === 0) continue; // Skip txs where wallet has no outputs
      txMap.set(tx.txid, tx);
      valueMap.set(tx.txid, walletValue);
    }
  }

  // Sort by wallet output value descending and cap
  const sorted = [...txMap.entries()]
    .sort((a, b) => (valueMap.get(b[0]) ?? 0) - (valueMap.get(a[0]) ?? 0))
    .slice(0, MAX_UTXO_TRACES);

  return new Map(sorted);
}

// ---------- Hook ----------

export function useWalletAnalysis() {
  const [state, setState] = useState<WalletAnalysisState>(INITIAL_STATE);
  const { t } = useTranslation();
  const { config } = useNetwork();
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
        // Uses configurable gap limit (default 5): scans until N consecutive
        // unused addresses per chain. Hosted API: sequential with rate limiting.
        // Local/Umbrel/custom: no delays.
        const api = createApiClient(config, controller.signal);
        const localApi = isLocalApi(config.mempoolBaseUrl);
        const { walletGapLimit = DEFAULT_GAP_LIMIT, minSats = 5000 } = getAnalysisSettings();
        const allInfos: WalletAddressInfo[] = [];
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
          await scanChain(parsed, chain, api, controller.signal, localApi, walletGapLimit, onProgress);
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

          let tracedCount = 0;
          const traceResults = new Map<string, UtxoTraceResult>();

          const { maxDepth = UTXO_TRACE_DEPTH } = getAnalysisSettings();
          const traceDepth = Math.min(UTXO_TRACE_DEPTH, maxDepth);

          const tracePromises = [...utxoTxs.entries()].map(async ([txid, tx]) => {
            try {
              const [bwResult, fwResult, outspends] = await Promise.all([
                traceBackward(tx, traceDepth, minSats, api, controller.signal),
                traceForward(tx, traceDepth, minSats, api, controller.signal),
                api.getTxOutspends(txid).catch(() => [] as MempoolOutspend[]),
              ]);

              traceResults.set(txid, {
                tx,
                backward: bwResult.layers,
                forward: fwResult.layers,
                outspends,
              });
            } catch {
              // Failed trace - root will appear without pre-expansion
            }

            tracedCount++;
            setState(prev => ({
              ...prev,
              traceProgress: { traced: tracedCount, total: utxoTxs.size },
            }));
          });

          await Promise.all(tracePromises);
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

        const result = auditWallet(allInfos);

        setState(prev => ({
          ...prev,
          phase: "complete",
          result,
          addressInfos: allInfos,
          utxoTraces,
          durationMs: Date.now() - startTime,
        }));
      } catch (err) {
        if (controller.signal.aborted) return;

        let message = t("errors.unexpected", { defaultValue: "An unexpected error occurred." });
        if (err instanceof Error) {
          message = err.message;
        }

        setState(prev => ({
          ...prev,
          phase: "error",
          error: message,
        }));
      }
    },
    [config, t],
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
