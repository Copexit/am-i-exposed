"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  checkChainalysis,
  checkChainalysisViaTor,
  checkChainalysisDirect,
  ChainalysisRateLimitError,
  type ChainalysisRoute,
} from "@/lib/analysis/cex-risk/chainalysis-check";
import type { ChainalysisCheckResult } from "@/lib/analysis/cex-risk/types";

const INITIAL_RESULT: ChainalysisCheckResult = {
  status: "idle",
  sanctioned: false,
  identifications: [],
  matchedAddresses: [],
};

interface UseChainalysisCheckResult {
  chainalysis: ChainalysisCheckResult;
  routeUsed: ChainalysisRoute | null;
  showFallbackConfirm: boolean;
  setShowFallbackConfirm: (show: boolean) => void;
  runChainalysis: () => Promise<void>;
  runChainalysisDirect: () => Promise<void>;
}

/**
 * Encapsulates the Chainalysis sanctions screening state machine:
 * abort handling, Tor fallback (Umbrel), and direct fallback.
 */
export function useChainalysisCheck(
  addresses: string[],
  isUmbrel: boolean,
): UseChainalysisCheckResult {
  const { t } = useTranslation();
  const [chainalysis, setChainalysis] = useState<ChainalysisCheckResult>(INITIAL_RESULT);
  const [showFallbackConfirm, setShowFallbackConfirm] = useState(false);
  const [routeUsed, setRouteUsed] = useState<ChainalysisRoute | null>(null);

  // AbortController to cancel in-flight chainalysis requests on unmount/re-render
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const rateLimitedError = useCallback(
    () => t("cex.errorRateLimited", { defaultValue: "Too many sanctions checks from this network right now (the limit is shared on Tor). Wait a minute and try again." }),
    [t],
  );

  const settleDone = useCallback(
    (result: Pick<ChainalysisCheckResult, "sanctioned" | "identifications" | "matchedAddresses">, route: ChainalysisRoute) => {
      setRouteUsed(route);
      setChainalysis({
        status: "done",
        sanctioned: result.sanctioned,
        identifications: result.identifications,
        matchedAddresses: result.matchedAddresses,
      });
    },
    [],
  );

  /** Aborts stay silent; rate limits get their own message, anything else `fallbackMsg`. */
  const settleError = useCallback(
    (err: unknown, fallbackMsg: string) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setChainalysis((prev) => ({
        ...prev,
        status: "error",
        error: err instanceof ChainalysisRateLimitError ? rateLimitedError() : fallbackMsg,
      }));
    },
    [rateLimitedError],
  );

  const runChainalysis = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setChainalysis((prev) => ({ ...prev, status: "loading" }));
    setRouteUsed(null);
    setShowFallbackConfirm(false);

    try {
      if (isUmbrel) {
        // Umbrel mode: try Tor proxy first
        try {
          const result = await checkChainalysisViaTor(
            addresses,
            controller.signal,
          );
          settleDone(result, result.route);
          return;
        } catch (torErr) {
          if (
            torErr instanceof DOMException &&
            torErr.name === "AbortError"
          )
            return;
          if (torErr instanceof ChainalysisRateLimitError) throw torErr;
          // Tor proxy failed on Umbrel - show sidecar-specific error
          // (direct fallback would fail due to CORS on local origins)
          setChainalysis((prev) => ({
            ...prev,
            status: "error",
            error: t("cex.errorUmbrelSidecar", {
              defaultValue: "Tor proxy sidecar unavailable. Ensure the sidecar container is running, or restart the am-i.exposed app from your Umbrel dashboard.",
            }),
          }));
          return;
        }
      }

      // Non-Umbrel: direct check (original behavior)
      const result = await checkChainalysis(addresses, controller.signal);
      settleDone(result, "direct");
    } catch (err) {
      settleError(err, t("cex.requestFailed", { defaultValue: "Request failed. Check your internet connection and try again." }));
    }
  }, [addresses, isUmbrel, t, settleDone, settleError]);

  const runChainalysisDirect = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setChainalysis((prev) => ({ ...prev, status: "loading" }));
    setShowFallbackConfirm(false);

    try {
      const result = await checkChainalysisDirect(
        addresses,
        controller.signal,
      );
      settleDone(result, result.route);
    } catch (err) {
      settleError(err, t("cex.errorDirectFallback", { defaultValue: "Both Tor and direct connections failed. Try restarting the app or check your internet connection." }));
    }
  }, [addresses, t, settleDone, settleError]);

  return {
    chainalysis,
    routeUsed,
    showFallbackConfirm,
    setShowFallbackConfirm,
    runChainalysis,
    runChainalysisDirect,
  };
}
