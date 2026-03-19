"use client";

import { useEffect, useRef, useState, lazy, Suspense, useCallback, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck, ShieldAlert, EyeOff, Github } from "lucide-react";
import { AddressInput } from "@/components/AddressInput";
import { DiagnosticLoader } from "@/components/DiagnosticLoader";
import { ResultsPanel } from "@/components/ResultsPanel";
import { ScanHistory } from "@/components/ScanHistory";
import { InstallPrompt } from "@/components/InstallPrompt";
import { GlowCard } from "@/components/ui/GlowCard";
import { DestinationOnlyResult } from "@/components/DestinationOnlyResult";
import { ErrorView } from "@/components/ErrorView";
import { WalletLoadingView } from "@/components/wallet/WalletLoadingView";
import { useAnalysis } from "@/hooks/useAnalysis";
import { useWalletAnalysis } from "@/hooks/useWalletAnalysis";
import { isXpubOrDescriptor, parseAndDerive } from "@/lib/bitcoin/descriptor";
import { isPSBT } from "@/lib/bitcoin/psbt";
import { useNetwork } from "@/context/NetworkContext";
import { useRecentScans } from "@/hooks/useRecentScans";
import { useBookmarks } from "@/hooks/useBookmarks";
import { EXAMPLES } from "@/lib/constants";
import { formatSats } from "@/lib/format";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { useDevMode } from "@/hooks/useDevMode";
import { XpubPrivacyWarning, isXpubPrivacyAcked } from "@/components/wallet/XpubPrivacyWarning";
const TipToast = lazy(() => import("@/components/TipToast").then(m => ({ default: m.TipToast })));
const DevChainalysisPanel = lazy(() => import("@/components/DevChainalysisPanel").then(m => ({ default: m.DevChainalysisPanel })));
const WalletAuditResults = lazy(() => import("@/components/wallet/WalletAuditResults").then(m => ({ default: m.WalletAuditResults })));
const subscribeNoop = () => () => {};

export default function Home() {
  const {
    phase,
    query,
    inputType,
    steps,
    result,
    txData,
    addressData,
    txBreakdown,
    addressTxs,
    addressUtxos,
    preSendResult,
    error,
    errorCode,
    durationMs,
    usdPrice,
    outspends,
    psbtData,
    fetchProgress,
    backwardLayers,
    forwardLayers,
    boltzmannResult,
    analyze,
    reset,
  } = useAnalysis();

  const wallet = useWalletAnalysis();

  const { t } = useTranslation();
  const { scans, addScan, clearScans } = useRecentScans();
  const { bookmarks, removeBookmark, clearBookmarks, exportBookmarks, importBookmarks } = useBookmarks();
  const { devMode } = useDevMode();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingXpub, setPendingXpub] = useState<string | null>(null);

  // Detect third-party API (not Umbrel and no custom API)
  const { customApiUrl, isUmbrel, config, localApiStatus } = useNetwork();
  const isThirdPartyApi = !isUmbrel && !customApiUrl;

  // Keep latest function refs for hashchange listener (avoids stale closures)
  const analyzeRef = useRef(analyze);
  const walletAnalyzeRef = useRef(wallet.analyze);
  const resetRef = useRef(reset);
  const walletResetRef = useRef(wallet.reset);
  const isThirdPartyRef = useRef(isThirdPartyApi);
  const setPendingXpubRef = useRef(setPendingXpub);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs every render to keep refs fresh
  useEffect(() => {
    analyzeRef.current = analyze;
    walletAnalyzeRef.current = wallet.analyze;
    resetRef.current = reset;
    walletResetRef.current = wallet.reset;
    isThirdPartyRef.current = isThirdPartyApi;
    setPendingXpubRef.current = setPendingXpub;
  });

  // Register service worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // SW registration failed - not critical
      });
    }
  }, []);

  // Dynamic page title
  useEffect(() => {
    if (phase === "complete" && result) {
      document.title = `${result.grade} (${result.score}/100) - am-i.exposed`;
    } else if (phase === "complete" && preSendResult && !result) {
      // OFAC-only result (no score)
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

  // Wait for API status to settle before processing initial hash URL.
  // This prevents firing requests to mempool.space on Umbrel where the
  // local API probe hasn't resolved yet.
  const initialHashProcessed = useRef(false);
  /** Skip the next hashchange handler (set when startXpubScan changes the hash programmatically). */
  const skipNextHashChange = useRef(false);

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
      if (skipNextHashChange.current) {
        skipNextHashChange.current = false;
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
        initialHashProcessed.current = true;
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
        // Mark as processed so the localApiStatus settle doesn't re-trigger
        initialHashProcessed.current = true;
        walletResetRef.current();
        analyzeRef.current(input);
      }
    }

    // Always listen for hash changes (user-initiated navigation)
    window.addEventListener("hashchange", handleHash);

    // Only process initial hash after API status settles
    if (localApiStatus !== "checking" && !initialHashProcessed.current) {
      initialHashProcessed.current = true;
      handleHash();
    }

    return () => window.removeEventListener("hashchange", handleHash);
  }, [localApiStatus]);

  // Keyboard navigation
  useKeyboardNav({
    onBack: () => {
      if (phase !== "idle") {
        window.location.hash = "";
        reset();
      }
    },
    onFocusSearch: () => {
      if (phase === "idle") {
        inputRef.current?.focus();
      }
    },
  });

  /** Proceed with an xpub scan (after any privacy warning). */
  const startXpubScan = useCallback((input: string) => {
    const newHash = `xpub=${encodeURIComponent(input)}`;
    const oldHash = window.location.hash.slice(1);
    // Suppress hashchange handler - we call analyze directly below
    if (oldHash !== newHash) skipNextHashChange.current = true;
    window.location.hash = newHash;
    reset();
    wallet.analyze(input);
  }, [reset, wallet]);

  const handleXpubConfirm = useCallback(() => {
    if (pendingXpub) {
      startXpubScan(pendingXpub);
      setPendingXpub(null);
    }
  }, [pendingXpub, startXpubScan]);

  const handleXpubCancel = useCallback(() => {
    setPendingXpub(null);
  }, []);

  const handleSubmit = useCallback((input: string) => {
    // Detect xpub/descriptor and route to wallet analysis
    if (isXpubOrDescriptor(input)) {
      // Guard: show privacy warning if using a third-party API
      if (isThirdPartyApi && !isXpubPrivacyAcked()) {
        setPendingXpub(input);
        return;
      }
      startXpubScan(input);
      return;
    }

    // PSBT: analyze directly (no hash routing for large base64 blobs)
    if (isPSBT(input)) {
      wallet.reset();
      analyze(input);
      return;
    }

    const prefix = input.length === 64 ? "tx" : "addr";
    const newHash = `${prefix}=${encodeURIComponent(input)}`;
    const oldHash = window.location.hash.slice(1);
    window.location.hash = newHash;
    // If hash didn't change (re-scan same input), hashchange won't fire, so call analyze directly
    if (oldHash === newHash) {
      wallet.reset();
      analyze(input);
    }
    // Otherwise, the hashchange listener calls analyze()
  }, [analyze, isThirdPartyApi, startXpubScan, wallet]);

  const handleBack = useCallback(() => {
    window.location.hash = "";
    reset();
    wallet.reset();
  }, [reset, wallet]);

  // Determine if wallet analysis is active (takes precedence when in non-idle state)
  const walletActive = wallet.phase !== "idle";

  // Clear pendingHash once analysis has actually started (phase left idle).
  if (pendingHash && (phase !== "idle" || walletActive)) {
    setPendingHashDismissed(true);
  }

  // Compute xpub address count for the privacy warning dialog
  const xpubAddressCount = useMemo(() => {
    if (!pendingXpub) return 40;
    try {
      const d = parseAndDerive(pendingXpub, 20);
      return d.receiveAddresses.length + d.changeAddresses.length;
    } catch {
      return 40;
    }
  }, [pendingXpub]);

  // Aria-live announcements for screen readers during phase transitions
  const ariaStatus =
    walletActive && wallet.phase !== "complete" && wallet.phase !== "error"
      ? t("page.aria_scanning", { defaultValue: "Scanning. Please wait." })
      : walletActive && wallet.phase === "complete" && wallet.result
        ? t("page.aria_complete", { grade: wallet.result.grade, score: wallet.result.score, defaultValue: `Scan complete. Grade ${wallet.result.grade}, score ${wallet.result.score} out of 100.` })
        : phase === "fetching" || phase === "analyzing"
          ? t("page.aria_scanning", { defaultValue: "Scanning. Please wait." })
          : phase === "complete" && result
            ? t("page.aria_complete", { grade: result.grade, score: result.score, defaultValue: `Scan complete. Grade ${result.grade}, score ${result.score} out of 100.` })
            : phase === "error"
              ? t("page.aria_error", { error: error ?? "", defaultValue: `Analysis failed. ${error ?? ""}` })
              : "";

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-3 sm:px-4 xl:px-8 2xl:px-10 py-4 sm:py-6">
      <div className="sr-only" role="status" aria-live="polite">{ariaStatus}</div>
      <AnimatePresence mode="wait">
        {phase === "idle" && !pendingHash && !walletActive && (
          <motion.div
            key="hero"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col items-center gap-8 text-center w-full"
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 120, damping: 20 }}
              className="space-y-3"
            >
              <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-tight">
                <span className="text-foreground">{t("page.hero_prefix", { defaultValue: "Am I " })}</span>
                <span className="tracking-wide gradient-text">{t("page.hero_suffix", { defaultValue: "exposed?" })}</span>
              </h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className="text-muted text-lg sm:text-xl max-w-xl mx-auto"
              >
                {t("page.tagline", { defaultValue: "The Bitcoin privacy scanner you were afraid to run." })}
              </motion.p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.4, type: "spring", stiffness: 150, damping: 20 }}
              className="w-full flex justify-center"
            >
              <AddressInput
                onSubmit={handleSubmit}
                isLoading={false}
                inputRef={inputRef}
              />
            </motion.div>

            <ScanHistory
              scans={scans}
              bookmarks={bookmarks}
              examples={EXAMPLES}
              onSelect={handleSubmit}
              onClearScans={clearScans}
              onRemoveBookmark={removeBookmark}
              onClearBookmarks={clearBookmarks}
              onExportBookmarks={exportBookmarks}
              onImportBookmarks={importBookmarks}
            />

            {devMode && (
              <Suspense fallback={null}>
                <DevChainalysisPanel />
              </Suspense>
            )}

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.5 }}
              className="inline-flex flex-wrap items-center justify-center gap-3 px-4 py-2 rounded-full border border-card-border bg-surface-elevated/30 text-sm text-muted"
            >
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-success/80" />
                {t("page.trust_client", { defaultValue: "100% client-side" })}
              </span>
              <span className="text-card-border">|</span>
              <span className="inline-flex items-center gap-1.5">
                <EyeOff size={14} className="text-info/80" />
                {t("page.trust_tracking", { defaultValue: "No tracking" })}
              </span>
              <span className="text-card-border">|</span>
              <a href="https://github.com/Copexit/am-i-exposed" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors">
                <Github size={14} className="text-muted/80" />
                {t("page.trust_opensource", { defaultValue: "Open source" })}
              </a>
            </motion.div>

          </motion.div>
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
                <p className="font-mono text-sm text-foreground/90 break-all leading-relaxed">
                  {query}
                </p>
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
              <motion.div
                key="psbt-banner"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-3xl mb-4"
              >
                <div className="rounded-xl border border-bitcoin/30 bg-bitcoin/5 px-5 py-4 space-y-2">
                  <div className="flex items-center gap-2 text-bitcoin font-semibold text-sm">
                    <ShieldAlert size={16} />
                    {t("psbt.banner", { defaultValue: "Pre-broadcast privacy analysis (PSBT)" })}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-muted">
                    <div>
                      <span className="block text-foreground font-medium">{psbtData.inputCount}</span>
                      {t("psbt.inputs", { defaultValue: "Inputs" })}
                    </div>
                    <div>
                      <span className="block text-foreground font-medium">{psbtData.outputCount}</span>
                      {t("psbt.outputs", { defaultValue: "Outputs" })}
                    </div>
                    <div>
                      <span className="block text-foreground font-medium">
                        {psbtData.fee > 0 ? formatSats(psbtData.fee) : "N/A"}
                      </span>
                      {t("psbt.fee", { defaultValue: "Fee" })}
                    </div>
                    <div>
                      <span className="block text-foreground font-medium">
                        {psbtData.feeRate > 0 ? `${psbtData.feeRate} sat/vB` : "N/A"}
                      </span>
                      {t("psbt.feeRate", { defaultValue: "Fee rate" })}
                    </div>
                  </div>
                  {!psbtData.complete && (
                    <p className="text-xs text-severity-medium">
                      {t("psbt.incomplete", { defaultValue: "Some inputs are missing UTXO data. Fee calculation may be incomplete." })}
                    </p>
                  )}
                </div>
              </motion.div>
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
          <DestinationOnlyResult
            query={query}
            preSendResult={preSendResult}
            onBack={handleBack}
            durationMs={durationMs}
          />
        )}

        {phase === "error" && error !== "xpub" && (
          <ErrorView
            error={error}
            query={query}
            errorCode={errorCode}
            onRetry={analyze}
            onBack={handleBack}
          />
        )}
        {/* Wallet analysis: loading states */}
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

        {/* Wallet analysis: results */}
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

        {/* Wallet analysis: error */}
        {wallet.phase === "error" && (
          <ErrorView
            error={wallet.error}
            onBack={handleBack}
          />
        )}
      </AnimatePresence>

      <InstallPrompt />
      {phase === "complete" && <Suspense fallback={null}><TipToast /></Suspense>}

      {/* Xpub privacy warning dialog */}
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
