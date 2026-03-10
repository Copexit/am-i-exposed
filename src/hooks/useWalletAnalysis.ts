"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createMempoolClient } from "@/lib/api/mempool";
import { isLocalInstance } from "@/lib/api/queue";
import { parseAndDerive, type DescriptorParseResult, type ScriptType } from "@/lib/bitcoin/descriptor";
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
  /** Progress: addresses fetched so far / total */
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

/** Default gap limit for address derivation. */
const GAP_LIMIT = 20;

// ---------- Fetch helpers ----------

/** Fetch all 3 endpoints for a single address (no throttling). */
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

/** Delay that can be cancelled via AbortSignal. */
function abortableDelay(ms: number, abortSignal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
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
        // Step 1: Parse descriptor and derive addresses
        const descriptor = parseAndDerive(input, GAP_LIMIT, scriptTypeOverride);
        const allAddresses = [...descriptor.receiveAddresses, ...descriptor.changeAddresses];

        setState(prev => ({
          ...prev,
          phase: "fetching",
          descriptor,
          progress: { fetched: 0, total: allAddresses.length },
        }));

        // Step 2: Fetch address data.
        // Rate limit strategy based on reverse-engineering mempool.space's
        // token bucket: ~20 token capacity, refills ~1 token every 3s.
        // Each address = 3 requests (address, utxos, txs) fired together.
        //
        // Hosted: burst first 6 addresses (18 tokens from the 20 bucket),
        // then 9s between each remaining address (3 tokens refill in 9s).
        // Total for 40 addresses: ~6s burst + 34*9s = ~5 minutes.
        //
        // Local/Umbrel/custom: all in parallel, no delays.
        const api = createMempoolClient(config.mempoolBaseUrl, controller.signal);
        const localApi = isLocalInstance(config.mempoolBaseUrl);
        const addressInfos: WalletAddressInfo[] = [];

        /** Addresses that fit in the initial token bucket (20 tokens / 3 per addr). */
        const BURST_SIZE = 6;
        /** Seconds between addresses after burst is exhausted. */
        const SUSTAIN_DELAY_MS = 9000;
        /** Small gap between burst addresses to avoid overwhelming the server. */
        const BURST_GAP_MS = 300;

        if (localApi) {
          // Local: fire all in parallel - no rate limits
          let completed = 0;
          const promises = allAddresses.map(async (derived) => {
            const info = await fetchAddress(api, derived)
              .catch((): WalletAddressInfo => ({
                derived,
                addressData: null as unknown as MempoolAddress,
                txs: [],
                utxos: [],
              }));
            completed++;
            setState(prev => ({
              ...prev,
              progress: { fetched: completed, total: allAddresses.length },
            }));
            return info;
          });
          addressInfos.push(...await Promise.all(promises));
        } else {
          // Hosted: burst phase then sustained phase
          for (let i = 0; i < allAddresses.length; i++) {
            if (controller.signal.aborted) return;
            const derived = allAddresses[i];
            const info = await fetchAddress(api, derived)
              .catch((): WalletAddressInfo => ({
                derived,
                addressData: null as unknown as MempoolAddress,
                txs: [],
                utxos: [],
              }));
            addressInfos.push(info);
            setState(prev => ({
              ...prev,
              progress: { fetched: i + 1, total: allAddresses.length },
            }));
            // Delay before next address (skip after the last one)
            if (i < allAddresses.length - 1) {
              const delayMs = i < BURST_SIZE - 1 ? BURST_GAP_MS : SUSTAIN_DELAY_MS;
              await abortableDelay(delayMs, controller.signal).catch(() => {});
            }
          }
        }

        if (controller.signal.aborted) return;

        // Step 3: Run wallet audit
        setState(prev => ({ ...prev, phase: "analyzing" }));

        const result = auditWallet(addressInfos);

        setState(prev => ({
          ...prev,
          phase: "complete",
          result,
          addressInfos,
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
