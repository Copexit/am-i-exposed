"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAnalysis } from "@/hooks/useAnalysis";
import { useWalletAnalysis } from "@/hooks/useWalletAnalysis";
import { isXpubOrDescriptor, parseAndDerive } from "@/lib/bitcoin/descriptor";
import { isPSBT } from "@/lib/bitcoin/psbt";
import { useNetwork } from "@/context/NetworkContext";
import { useRecentScans } from "@/hooks/useRecentScans";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { useHashRouting } from "@/hooks/useHashRouting";
import { isXpubPrivacyAcked } from "@/components/wallet/XpubPrivacyWarning";

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;

/** Minimal shape needed by getAriaStatus (shared by ScoringResult and WalletAuditResult). */
interface GradeInfo { grade: string; score: number }

interface AriaStatusParams {
  walletActive: boolean;
  walletPhase: string;
  walletResult: GradeInfo | null;
  phase: string;
  result: GradeInfo | null;
  error: string | null;
  t: TranslationFn;
}

/** Pure function to compute aria-live status text for screen readers. */
export function getAriaStatus({ walletActive, walletPhase, walletResult, phase, result, error, t }: AriaStatusParams): string {
  if (walletActive && walletPhase !== "complete" && walletPhase !== "error") {
    return t("page.aria_scanning", { defaultValue: "Scanning. Please wait." });
  }
  if (walletActive && walletPhase === "complete" && walletResult) {
    return t("page.aria_complete", {
      grade: walletResult.grade,
      score: walletResult.score,
      defaultValue: `Scan complete. Grade ${walletResult.grade}, score ${walletResult.score} out of 100.`,
    });
  }
  if (phase === "fetching" || phase === "analyzing") {
    return t("page.aria_scanning", { defaultValue: "Scanning. Please wait." });
  }
  if (phase === "complete" && result) {
    return t("page.aria_complete", {
      grade: result.grade,
      score: result.score,
      defaultValue: `Scan complete. Grade ${result.grade}, score ${result.score} out of 100.`,
    });
  }
  if (phase === "error") {
    return t("page.aria_error", { error: error ?? "", defaultValue: `Analysis failed. ${error ?? ""}` });
  }
  return "";
}

/**
 * Scanner page controller shared by the classic and v2 home pages:
 * analysis state, hash routing, submit/back handlers, recent scans,
 * bookmarks, document title, service worker, keyboard nav, xpub warning.
 */
export function useScanner() {
  const analysis = useAnalysis();
  const { phase, query, inputType, result, preSendResult, error, analyze, reset } = analysis;

  const wallet = useWalletAnalysis();
  const { t } = useTranslation();
  const recent = useRecentScans();
  const { addScan } = recent;
  const bookmarks = useBookmarks();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingXpub, setPendingXpub] = useState<string | null>(null);

  // Detect third-party API (not Umbrel and no custom API)
  const { customApiUrl, isUmbrel, config } = useNetwork();
  const isThirdPartyApi = !isUmbrel && !customApiUrl;

  // Hash routing (refs, hashchange listener, initial hash detection)
  const { pendingHash, dismissPendingHash, skipNextHashChangeRef } = useHashRouting(
    { analyze, walletAnalyze: wallet.analyze, reset, walletReset: wallet.reset, isThirdPartyApi, setPendingXpub },
  );

  // Register service worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Dynamic page title
  useEffect(() => {
    if (phase === "complete" && result) {
      document.title = `${result.grade} (${result.score}/100) - am-i.exposed`;
    } else if (phase === "complete" && preSendResult && !result) {
      document.title = `${preSendResult.riskLevel} ${t("page.title_risk", { defaultValue: "Risk" })} - am-i.exposed`;
    } else if (phase === "fetching" || phase === "analyzing") {
      document.title = `${t("page.title_scanning", { defaultValue: "Scanning" })}... - am-i.exposed`;
    } else {
      document.title = `am-i.exposed - ${t("page.title_default", { defaultValue: "Bitcoin Privacy Scanner" })}`;
    }
  }, [phase, result, preSendResult, t]);

  // Save completed scan to recent history
  useEffect(() => {
    if (phase === "complete" && query && inputType && result) {
      addScan({
        input: query,
        type: inputType === "txid" || inputType === "psbt" ? "txid" : "address",
        grade: result.grade,
        score: result.score,
      });
    }
  }, [phase, query, inputType, result, addScan]);

  // Keyboard navigation
  useKeyboardNav({
    onBack: () => {
      if (phase !== "idle") { window.location.hash = ""; reset(); }
    },
    onFocusSearch: () => {
      if (phase === "idle") inputRef.current?.focus();
    },
  });

  const startXpubScan = useCallback((input: string) => {
    const newHash = `xpub=${encodeURIComponent(input)}`;
    const oldHash = window.location.hash.slice(1);
    if (oldHash !== newHash) skipNextHashChangeRef.current = true;
    window.location.hash = newHash;
    reset();
    // Fire-and-forget: the callee catches its own errors.
    void wallet.analyze(input);
  }, [reset, wallet, skipNextHashChangeRef]);

  const handleXpubConfirm = useCallback(() => {
    if (pendingXpub) { startXpubScan(pendingXpub); setPendingXpub(null); }
  }, [pendingXpub, startXpubScan]);

  const handleXpubCancel = useCallback(() => { setPendingXpub(null); }, []);

  const handleSubmit = useCallback((input: string) => {
    if (isXpubOrDescriptor(input)) {
      if (isThirdPartyApi && !isXpubPrivacyAcked()) { setPendingXpub(input); return; }
      startXpubScan(input);
      return;
    }
    // Fire-and-forget: the callee catches its own errors.
    if (isPSBT(input)) { wallet.reset(); void analyze(input); return; }
    const prefix = input.length === 64 ? "tx" : "addr";
    const newHash = `${prefix}=${encodeURIComponent(input)}`;
    const oldHash = window.location.hash.slice(1);
    window.location.hash = newHash;
    // Fire-and-forget: the callee catches its own errors.
    if (oldHash === newHash) { wallet.reset(); void analyze(input); }
  }, [analyze, isThirdPartyApi, startXpubScan, wallet]);

  const handleBack = useCallback(() => {
    window.location.hash = "";
    reset();
    wallet.reset();
  }, [reset, wallet]);

  const walletActive = wallet.phase !== "idle";

  if (pendingHash && (phase !== "idle" || walletActive)) {
    dismissPendingHash();
  }

  const xpubAddressCount = useMemo(() => {
    if (!pendingXpub) return 40;
    try {
      const d = parseAndDerive(pendingXpub, 20);
      return d.receiveAddresses.length + d.changeAddresses.length;
    }
    catch { return 40; }
  }, [pendingXpub]);

  const ariaStatus = getAriaStatus({
    walletActive, walletPhase: wallet.phase, walletResult: wallet.result,
    phase, result, error, t: t as TranslationFn,
  });

  // Only needed (and only computed) while the xpub privacy warning is shown.
  const apiEndpoint = pendingXpub ? config.mempoolBaseUrl.replace(/^https?:\/\//, "").replace(/\/api\/?$/, "") : "";

  return {
    analysis,
    wallet,
    walletActive,
    recent,
    bookmarks,
    inputRef,
    pendingHash,
    pendingXpub,
    xpubAddressCount,
    apiEndpoint,
    isThirdPartyApi,
    isLocalApi: isUmbrel || !!customApiUrl,
    ariaStatus,
    handleSubmit,
    handleBack,
    handleXpubConfirm,
    handleXpubCancel,
  };
}
