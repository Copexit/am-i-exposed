"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isXpubPrivacyAcked } from "@/components/wallet/XpubPrivacyWarning";
import type { LocalApiStatus } from "@/hooks/useLocalApi";
import { useNetwork } from "@/context/NetworkContext";

const subscribeNoop = () => () => {};

interface HashRoutingCallbacks {
  analyze: (input: string) => void;
  walletAnalyze: (input: string) => void;
  reset: () => void;
  walletReset: () => void;
  isThirdPartyApi: boolean;
  setPendingXpub: (xpub: string | null) => void;
}

interface HashRoutingResult {
  /** True when the initial URL had a hash that hasn't been processed yet. */
  pendingHash: boolean;
  /** Dismiss the pending-hash indicator (e.g. once analysis starts). */
  dismissPendingHash: () => void;
  /** Ref used to skip the next hashchange event (set before programmatic hash changes). */
  skipNextHashChangeRef: React.MutableRefObject<boolean>;
}

/**
 * Encapsulates all hash-routing logic: initial hash detection,
 * hashchange listener, API-status gating, and programmatic skip flag.
 */
export function useHashRouting(
  callbacks: HashRoutingCallbacks,
  localApiStatus: LocalApiStatus,
): HashRoutingResult {
  // Keep latest function refs for hashchange listener (avoids stale closures)
  const analyzeRef = useRef(callbacks.analyze);
  const walletAnalyzeRef = useRef(callbacks.walletAnalyze);
  const resetRef = useRef(callbacks.reset);
  const walletResetRef = useRef(callbacks.walletReset);
  const isThirdPartyRef = useRef(callbacks.isThirdPartyApi);
  const setPendingXpubRef = useRef(callbacks.setPendingXpub);

  useEffect(() => {
    analyzeRef.current = callbacks.analyze;
    walletAnalyzeRef.current = callbacks.walletAnalyze;
    resetRef.current = callbacks.reset;
    walletResetRef.current = callbacks.walletReset;
    isThirdPartyRef.current = callbacks.isThirdPartyApi;
    setPendingXpubRef.current = callbacks.setPendingXpub;
  });

  // Wait for both the local API probe and Tor detection to settle before
  // processing the initial hash URL. Otherwise the first scan goes to
  // mempool.space on Umbrel, or to clearnet instead of the onion on Tor.
  const { torStatus } = useNetwork();
  const apiReady = localApiStatus !== "checking" && torStatus !== "checking";
  const initialHashProcessedRef = useRef(false);
  /** Skip the next hashchange handler (set when startXpubScan changes the hash programmatically). */
  const skipNextHashChangeRef = useRef(false);

  // Detect if initial URL has a hash so we can suppress the landing flash.
  // useSyncExternalStore reads the hash synchronously on the client (preventing
  // a flash) while returning false during SSR to avoid hydration mismatch.
  const hasInitialHash = useSyncExternalStore(
    subscribeNoop,
    () => {
      const hash = window.location.hash.slice(1);
      if (!hash) return false;
      const params = new URLSearchParams(hash);
      return !!(params.get("tx") ?? params.get("addr") ?? params.get("check") ?? params.get("xpub"));
    },
    () => false,
  );
  const [pendingHashDismissed, setPendingHashDismissed] = useState(false);
  const pendingHash = hasInitialHash && !pendingHashDismissed;

  useEffect(() => {
    function handleHash() {
      // Skip when hash was changed programmatically by startXpubScan
      if (skipNextHashChangeRef.current) {
        skipNextHashChangeRef.current = false;
        setPendingHashDismissed(true);
        return;
      }

      const hash = window.location.hash.slice(1);
      if (!hash) {
        setPendingHashDismissed(true);
        resetRef.current();
        walletResetRef.current();
        return;
      }

      const params = new URLSearchParams(hash);
      const txid = params.get("tx");
      const addr = params.get("addr");
      const check = params.get("check");
      const xpub = params.get("xpub");

      // Handle xpub/descriptor via wallet analysis flow
      if (xpub) {
        initialHashProcessedRef.current = true;
        // Guard: show privacy warning if using a third-party API
        if (isThirdPartyRef.current && !isXpubPrivacyAcked()) {
          setPendingXpubRef.current(xpub);
          setPendingHashDismissed(true);
          return;
        }
        resetRef.current();
        walletAnalyzeRef.current(xpub);
        return;
      }

      // #check=X is treated as #addr=X (unified flow)
      const input = txid ?? addr ?? check;
      if (input) {
        // Mark as processed so the apiReady settle doesn't re-trigger
        initialHashProcessedRef.current = true;
        walletResetRef.current();
        analyzeRef.current(input);
      }
    }

    // Always listen for hash changes (user-initiated navigation)
    window.addEventListener("hashchange", handleHash);

    // Only process initial hash after API status settles
    if (apiReady && !initialHashProcessedRef.current) {
      initialHashProcessedRef.current = true;
      handleHash();
    }

    return () => window.removeEventListener("hashchange", handleHash);
  }, [apiReady]);

  const dismissPendingHash = () => setPendingHashDismissed(true);

  return { pendingHash, dismissPendingHash, skipNextHashChangeRef };
}
