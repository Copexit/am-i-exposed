"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { parseAndDerive, type DescriptorParseResult, type ScriptType } from "@/lib/bitcoin/descriptor";
import { auditWallet, type WalletAuditResult, type WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { MempoolAddress, MempoolTransaction, MempoolUtxo } from "@/lib/api/types";

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

        // Step 2: Fetch address data, UTXOs, and txs for each derived address
        const api = createApiClient(config, controller.signal);
        const addressInfos: WalletAddressInfo[] = [];
        let fetched = 0;

        // Fetch in batches of 5 to avoid rate limiting
        const BATCH_SIZE = 5;
        for (let i = 0; i < allAddresses.length; i += BATCH_SIZE) {
          if (controller.signal.aborted) return;

          const batch = allAddresses.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.allSettled(
            batch.map(async (derived) => {
              const [addressData, utxos, txs] = await Promise.all([
                api.getAddress(derived.address).catch(() => null),
                api.getAddressUtxos(derived.address).catch(() => [] as MempoolUtxo[]),
                api.getAddressTxs(derived.address).catch(() => [] as MempoolTransaction[]),
              ]);
              return { derived, addressData, utxos, txs };
            }),
          );

          for (let j = 0; j < batchResults.length; j++) {
            const result = batchResults[j];
            if (result.status === "fulfilled") {
              addressInfos.push(result.value as WalletAddressInfo);
            } else {
              // Still include the address, just without data
              addressInfos.push({
                derived: batch[j],
                addressData: null as unknown as MempoolAddress,
                txs: [],
                utxos: [],
              });
            }
          }

          fetched += batch.length;
          setState(prev => ({
            ...prev,
            progress: { fetched, total: allAddresses.length },
          }));
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
