"use client";

import { useEffect, useRef, useState, lazy, Suspense, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { DiagnosticLoader } from "@/components/DiagnosticLoader";
import { ResultsPanel } from "@/components/ResultsPanel";
import { InstallPrompt } from "@/components/InstallPrompt";
import { AppStoreAnnouncement } from "@/components/AppStoreAnnouncement";
import { GlowCard } from "@/components/ui/GlowCard";
import { DestinationOnlyResult } from "@/components/DestinationOnlyResult";
import { ErrorView } from "@/components/ErrorView";
import { WalletLoadingView } from "@/components/wallet/WalletLoadingView";
import { HeroSection } from "@/components/HeroSection";
import { PsbtBanner } from "@/components/PsbtBanner";
import { useAnalysis } from "@/hooks/useAnalysis";
import { useWalletAnalysis } from "@/hooks/useWalletAnalysis";
import { isXpubOrDescriptor, parseAndDerive } from "@/lib/bitcoin/descriptor";
import { isPSBT } from "@/lib/bitcoin/psbt";
import { useNetwork } from "@/context/NetworkContext";
import { useRecentScans } from "@/hooks/useRecentScans";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { useHashRouting } from "@/hooks/useHashRouting";
import { XpubPrivacyWarning, isXpubPrivacyAcked } from "@/components/wallet/XpubPrivacyWarning";
const TipToast = lazy(() => import("@/components/TipToast").then(m => ({ default: m.TipToast })));
const WalletAuditResults = lazy(() => import("@/components/wallet/WalletAuditResults").then(m => ({ default: m.WalletAuditResults })));

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
function getAriaStatus({ walletActive, walletPhase, walletResult, phase, result, error, t }: AriaStatusParams): string {
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

export default function Home() {
  const {
    phase, query, inputType, steps, result, txData, addressData,
    txBreakdown, addressTxs, addressUtxos, preSendResult, error,
    errorCode, durationMs, usdPrice, outspends, psbtData, fetchProgress,
    backwardLayers, forwardLayers, boltzmannResult, analyze, reset,
  } = useAnalysis();

  const wallet = useWalletAnalysis();
  const { t } = useTranslation();
  const { scans, addScan, clearScans } = useRecentScans();
  const { bookmarks, removeBookmark, clearBookmarks, exportBookmarks, importBookmarks } = useBookmarks();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingXpub, setPendingXpub] = useState<string | null>(null);

  // Detect third-party API (not Umbrel and no custom API)
  const { customApiUrl, isUmbrel, config, localApiStatus } = useNetwork();
  const isThirdPartyApi = !isUmbrel && !customApiUrl;

  // Hash routing (refs, hashchange listener, initial hash detection)
  const { pendingHash, dismissPendingHash, skipNextHashChangeRef } = useHashRouting(
    { analyze, walletAnalyze: wallet.analyze, reset, walletReset: wallet.reset, isThirdPartyApi, setPendingXpub },
    localApiStatus,
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
    wallet.analyze(input);
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
    if (isPSBT(input)) { wallet.reset(); analyze(input); return; }
    const prefix = input.length === 64 ? "tx" : "addr";
    const newHash = `${prefix}=${encodeURIComponent(input)}`;
    const oldHash = window.location.hash.slice(1);
    window.location.hash = newHash;
    if (oldHash === newHash) { wallet.reset(); analyze(input); }
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

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-3 sm:px-4 xl:px-8 2xl:px-10 py-4 sm:py-6">
      <div className="sr-only" role="status" aria-live="polite">{ariaStatus}</div>
      <AnimatePresence mode="wait">
        {phase === "idle" && !pendingHash && !walletActive && (
          <HeroSection
            onSubmit={handleSubmit}
            inputRef={inputRef}
            scans={scans}
            bookmarks={bookmarks}
            onClearScans={clearScans}
            onRemoveBookmark={removeBookmark}
            onClearBookmarks={clearBookmarks}
            onExportBookmarks={exportBookmarks}
            onImportBookmarks={importBookmarks}
          />
        )}

        {(phase === "fetching" || phase === "analyzing") && (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 10, filter: "blur(4px)" }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            data-testid="diagnostic-loader"
            className="flex flex-col items-center gap-6 w-full max-w-3xl"
          >
            <GlowCard className="w-full p-8 space-y-6">
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted uppercase tracking-wider">
                  {inputType === "txid" ? t("page.label_transaction", { defaultValue: "Transaction" }) : t("page.label_address", { defaultValue: "Address" })}
                </span>
                <p className="font-mono text-sm text-foreground/90 break-all leading-relaxed">{query}</p>
              </div>
              <div className="border-t border-card-border pt-6">
                <DiagnosticLoader steps={steps} phase={phase} inputType={inputType ?? undefined} fetchProgress={fetchProgress} />
              </div>
            </GlowCard>
          </motion.div>
        )}

        {phase === "complete" && query && inputType && result && (
          <>
            {psbtData && (
              <PsbtBanner
                inputCount={psbtData.inputCount}
                outputCount={psbtData.outputCount}
                fee={psbtData.fee}
                feeRate={psbtData.feeRate}
                complete={psbtData.complete}
              />
            )}
            <ResultsPanel
              key="results"
              query={query}
              inputType={inputType === "psbt" ? "txid" : inputType as "txid" | "address"}
              result={result}
              txData={txData}
              addressData={addressData}
              addressTxs={addressTxs}
              addressUtxos={addressUtxos}
              txBreakdown={txBreakdown}
              preSendResult={preSendResult}
              onBack={handleBack}
              onScan={handleSubmit}
              durationMs={durationMs}
              usdPrice={usdPrice}
              outspends={outspends}
              backwardLayers={backwardLayers}
              forwardLayers={forwardLayers}
              boltzmannResult={boltzmannResult}
            />
          </>
        )}

        {phase === "complete" && query && preSendResult && !result && (
          <DestinationOnlyResult query={query} preSendResult={preSendResult} onBack={handleBack} durationMs={durationMs} />
        )}

        {phase === "error" && error !== "xpub" && (
          <ErrorView error={error} query={query} errorCode={errorCode} onRetry={analyze} onBack={handleBack} />
        )}

        {walletActive && wallet.phase !== "complete" && wallet.phase !== "error" && (
          <WalletLoadingView
            query={wallet.query}
            phase={wallet.phase as "deriving" | "fetching" | "tracing" | "analyzing"}
            progress={wallet.progress}
            traceProgress={wallet.traceProgress}
            isLocalApi={isUmbrel || !!customApiUrl}
            isThirdPartyApi={isThirdPartyApi}
          />
        )}

        {wallet.phase === "complete" && wallet.descriptor && wallet.result && (
          <Suspense fallback={null}>
            <WalletAuditResults
              descriptor={wallet.descriptor}
              result={wallet.result}
              addressInfos={wallet.addressInfos}
              utxoTraces={wallet.utxoTraces}
              onBack={handleBack}
              onScan={handleSubmit}
              durationMs={wallet.durationMs}
            />
          </Suspense>
        )}

        {wallet.phase === "error" && (
          <ErrorView error={wallet.error} onBack={handleBack} />
        )}
      </AnimatePresence>

      <AppStoreAnnouncement />
      <InstallPrompt />
      {phase === "complete" && <Suspense fallback={null}><TipToast /></Suspense>}

      {pendingXpub && (
        <XpubPrivacyWarning
          addressCount={xpubAddressCount}
          apiEndpoint={config.mempoolBaseUrl.replace(/^https?:\/\//, "").replace(/\/api\/?$/, "")}
          onConfirm={handleXpubConfirm}
          onCancel={handleXpubCancel}
        />
      )}
    </div>
  );
}
