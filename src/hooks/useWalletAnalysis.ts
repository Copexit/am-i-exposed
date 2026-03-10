"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { isLocalInstance } from "@/lib/api/queue";
import { getAnalysisSettings } from "@/hooks/useAnalysisSettings";
import {
  parseXpub,
  deriveOneAddress,
  type DescriptorParseResult,
  type ScriptType,
  type ParsedXpub,
} from "@/lib/bitcoin/descriptor";
import { auditWallet, type WalletAuditResult, type WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { MempoolAddress, MempoolTransaction, MempoolUtxo } from "@/lib/api/types";
import type { DerivedAddress } from "@/lib/bitcoin/descriptor";
import type { MempoolClient } from "@/lib/api/mempool";

// ---------- Types ----------

export type WalletPhase =
  | "idle"
  | "deriving"
  | "fetching"
  | "analyzing"
  | "complete"
  | "error";

export interface WalletAnalysisState {
  phase: WalletPhase;
  /** Original xpub/descriptor input */
  query: string | null;
  /** Parsed descriptor result (addresses, script type, network) */
  descriptor: DescriptorParseResult | null;
  /** Wallet audit result */
  result: WalletAuditResult | null;
  /** Per-address info (for detail views) */
  addressInfos: WalletAddressInfo[];
  /** Progress: addresses fetched so far / total (0 = unknown) */
  progress: { fetched: number; total: number };
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
  progress: { fetched: 0, total: 0 },
  error: null,
  durationMs: null,
};

/** Default gap limit if settings unavailable. */
const DEFAULT_GAP_LIMIT = 5;

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
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
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
        addressData: null as unknown as MempoolAddress,
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
      await abortableDelay(delayMs, signal).catch(() => {});
    }
  }

  return results;
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
        const localApi = isLocalInstance(config.mempoolBaseUrl);
        const { walletGapLimit = DEFAULT_GAP_LIMIT } = getAnalysisSettings();
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
