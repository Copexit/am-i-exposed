"use client";

import { Fragment, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
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
import { useScanner } from "@/hooks/useScanner";
import { XpubPrivacyWarning } from "@/components/wallet/XpubPrivacyWarning";
import { blurInMotion } from "@/components/results/animations";
const NetworkSwitchToast = lazy(() => import("@/components/NetworkSwitchToast").then(m => ({ default: m.NetworkSwitchToast })));
const TipToast = lazy(() => import("@/components/TipToast").then(m => ({ default: m.TipToast })));
const WalletAuditResults = lazy(() => import("@/components/wallet/WalletAuditResults").then(m => ({ default: m.WalletAuditResults })));

export default function Home() {
  const {
    analysis, wallet, walletActive, recent, bookmarks: bm, inputRef, pendingHash, pendingXpub,
    xpubAddressCount, apiEndpoint, isThirdPartyApi, isLocalApi, ariaStatus,
    handleSubmit, handleBack, handleXpubConfirm, handleXpubCancel,
  } = useScanner();
  const {
    phase, query, inputType, steps, result, txData, addressData,
    txBreakdown, addressTxs, addressUtxos, preSendResult, error,
    errorCode, durationMs, usdPrice, outspends, psbtData, fetchProgress,
    backwardLayers, forwardLayers, boltzmannResult, autoSwitchedNetwork, analyze,
  } = analysis;
  const { scans, clearScans } = recent;
  const { bookmarks, removeBookmark, clearBookmarks, exportBookmarks, importBookmarks } = bm;
  const { t } = useTranslation();

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-3 sm:px-4 xl:px-8 2xl:px-10 py-4 sm:py-6">
      <div className="sr-only" role="status" aria-live="polite">{ariaStatus}</div>
      {/* Deep link waiting for backend detection (local API / Tor probe, up to ~10s) */}
      {phase === "idle" && pendingHash && !walletActive && (
        <div data-testid="pending-hash-loader" className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={16} className="animate-spin text-bitcoin" aria-hidden="true" />
          {t("common.loading", { defaultValue: "Loading..." })}
        </div>
      )}
      {/* Views animate in on mount and unmount immediately. No AnimatePresence
          mode="wait": with motion 12.41+ a view change during an exit animation
          (fast scan, error, network auto-switch) could leave the page stuck on
          the previous view. */}
        {phase === "idle" && !pendingHash && !walletActive && (
          <HeroSection
            key="hero"
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
            {...blurInMotion}
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
          <Fragment key="results">
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
          </Fragment>
        )}

        {phase === "complete" && query && preSendResult && !result && (
          <DestinationOnlyResult key="destination" query={query} preSendResult={preSendResult} onBack={handleBack} durationMs={durationMs} />
        )}

        {phase === "error" && error !== "xpub" && (
          <ErrorView key="error" error={error} query={query} errorCode={errorCode} onRetry={analyze} onBack={handleBack} />
        )}

        {walletActive && wallet.phase !== "complete" && wallet.phase !== "error" && (
          <WalletLoadingView
            key="wallet-loading"
            query={wallet.query}
            phase={wallet.phase as "deriving" | "fetching" | "tracing" | "analyzing"}
            progress={wallet.progress}
            traceProgress={wallet.traceProgress}
            isLocalApi={isLocalApi}
            isThirdPartyApi={isThirdPartyApi}
          />
        )}

        {wallet.phase === "complete" && wallet.descriptor && wallet.result && (
          <Suspense key="wallet-results" fallback={null}>
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
          <ErrorView key="wallet-error" error={wallet.error} onBack={handleBack} />
        )}

      <AppStoreAnnouncement />
      <InstallPrompt />
      {phase === "complete" && <Suspense fallback={null}><TipToast /></Suspense>}
      {phase === "complete" && autoSwitchedNetwork && (
        <Suspense fallback={null}><NetworkSwitchToast key={query} network={autoSwitchedNetwork} /></Suspense>
      )}

      {pendingXpub && (
        <XpubPrivacyWarning
          addressCount={xpubAddressCount}
          apiEndpoint={apiEndpoint}
          onConfirm={handleXpubConfirm}
          onCancel={handleXpubCancel}
        />
      )}
    </div>
  );
}
