"use client";

import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useScanner } from "@/hooks/useScanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { XpubPrivacyWarning } from "@/components/wallet/XpubPrivacyWarning";
import { Home } from "@/components/home/Home";
import { ScanScreen } from "@/components/scan/ScanScreen";
import { ErrorScreen } from "@/components/flows/ErrorScreen";
import { WalletLoading } from "@/components/flows/WalletLoading";
// Result views pull the report UI and its engine helpers: loaded after first paint, not with the route
const loadResults = () => import("@/components/results/Results");
const loadDestination = () => import("@/components/flows/DestinationResult");
const Results = lazy(() => loadResults().then(m => ({ default: m.Results })));
const DestinationResult = lazy(() => loadDestination().then(m => ({ default: m.DestinationResult })));
const NetworkSwitchToast = lazy(() => import("@/components/NetworkSwitchToast").then(m => ({ default: m.NetworkSwitchToast })));
const WalletResults = lazy(() => import("@/components/flows/WalletResults").then(m => ({ default: m.WalletResults })));

export default function ScannerPage() {
  const {
    analysis, wallet, walletActive, recent, bookmarks: bm, inputRef, pendingHash, pendingXpub,
    xpubAddressCount, apiEndpoint, isThirdPartyApi, isLocalApi, ariaStatus,
    handleSubmit, handleBack, handleBroadcastSuccess, handleXpubConfirm, handleXpubCancel,
  } = useScanner();
  const {
    phase, query, inputType, steps, result, txData, addressData,
    txBreakdown, addressTxs, addressUtxos, preSendResult, error,
    errorCode, durationMs, usdPrice, outspends, localTx, fetchProgress,
    backwardLayers, forwardLayers, boltzmannResult, autoSwitchedNetwork, fromCache, analyze, retryLocal,
    localLookup, localOutputTxCounts, completeLocalLookup, awaitingIndex,
  } = analysis;
  const { t } = useTranslation();

  // Warm the result views once the home screen is up, so a scan never waits on them
  useEffect(() => {
    void loadResults().catch(() => {});
    void loadDestination().catch(() => {});
  }, []);

  const viewFallback = (
    <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted py-24">
      <Loader2 size={16} className="animate-spin text-bitcoin" aria-hidden="true" />
      {t("common.loading", { defaultValue: "Loading..." })}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col">
      <div className="sr-only" role="status" aria-live="polite">{ariaStatus}</div>
      {/* Deep link waiting for backend detection (local API / Tor probe, up to ~10s). */}
      {phase === "idle" && pendingHash && !walletActive && (
        <div data-testid="pending-hash-loader" className="flex-1 flex items-center justify-center gap-2 text-sm text-muted py-24">
          <Loader2 size={16} className="animate-spin text-bitcoin" aria-hidden="true" />
          {t("common.loading", { defaultValue: "Loading..." })}
        </div>
      )}
      {/*
        Views swap without exit animations on purpose (no AnimatePresence
        mode="wait"): a view whose exit was interrupted by a fast phase change
        could hold the switch and leave the page stuck on the old view.
        Each view still animates in. Keys stay for React identity.
      */}
      <>
        {phase === "idle" && !pendingHash && !walletActive && (
          <Home
            key="hero"
            onSubmit={handleSubmit}
            inputRef={inputRef}
            scans={recent.scans}
            bookmarks={bm.bookmarks}
            onClearScans={recent.clearScans}
            onRemoveBookmark={bm.removeBookmark}
            onClearBookmarks={bm.clearBookmarks}
            onExportBookmarks={bm.exportBookmarks}
            onImportBookmarks={bm.importBookmarks}
          />
        )}

        {(phase === "fetching" || phase === "analyzing") && (
          <ScanScreen
            key="loading"
            query={query ?? ""}
            inputType={inputType}
            phase={phase}
            steps={steps}
            fetchProgress={fetchProgress}
            awaitingIndex={awaitingIndex}
            txData={inputType === "txid" || localTx ? txData : null}
          />
        )}

        {phase === "complete" && query && inputType && result && (
          <Suspense key="results" fallback={viewFallback}>
          <Results
            query={query}
            inputType={inputType === "psbt" || inputType === "rawtx" ? "txid" : inputType as "txid" | "address"}
            result={result}
            txData={txData}
            addressData={addressData}
            addressTxs={addressTxs}
            addressUtxos={addressUtxos}
            txBreakdown={txBreakdown}
            preSendResult={preSendResult}
            onScan={handleSubmit}
            onBack={handleBack}
            durationMs={durationMs}
            usdPrice={usdPrice}
            outspends={outspends}
            backwardLayers={backwardLayers}
            forwardLayers={forwardLayers}
            boltzmannResult={boltzmannResult}
            reveal={!fromCache}
            local={localTx}
            onRetryLocal={retryLocal}
            localLookup={localLookup}
            localOutputTxCounts={localOutputTxCounts}
            onLocalLookup={() => { void completeLocalLookup(); }}
            onBroadcastSuccess={handleBroadcastSuccess}
          />
          </Suspense>
        )}

        {phase === "complete" && query && preSendResult && !result && (
          <Suspense key="destination" fallback={viewFallback}>
            <DestinationResult query={query} preSendResult={preSendResult} onBack={handleBack} durationMs={durationMs} />
          </Suspense>
        )}

        {phase === "error" && error !== "xpub" && (
          <ErrorScreen key="error" error={error} query={query} errorCode={errorCode} onRetry={analyze} onBack={handleBack} />
        )}

        {walletActive && wallet.phase !== "complete" && wallet.phase !== "error" && (
          <WalletLoading
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
            <WalletResults
              descriptor={wallet.descriptor}
              result={wallet.result}
              addressInfos={wallet.addressInfos}
              utxoTraces={wallet.utxoTraces}
              onBack={handleBack}
              onScan={handleSubmit}
              durationMs={wallet.durationMs}
              scriptTypeDetected={wallet.scriptTypeDetected}
              gapLimit={wallet.gapLimit}
              onRescanGap={(n) => { if (wallet.query) void wallet.analyze(wallet.query, undefined, n); }}
              labelRecords={wallet.labels}
              onLabelsChange={wallet.setLabels}
              saved={wallet.saved}
              saveError={wallet.saveError}
              onFullRescan={() => { if (wallet.query) void wallet.analyze(wallet.query, undefined, undefined, { fullRescan: true }); }}
              onForget={() => void wallet.forget()}
              query={wallet.query}
              snapshotKey={wallet.snapshotKey}
            />
          </Suspense>
        )}

        {wallet.phase === "error" && (
          <ErrorScreen key="wallet-error" error={wallet.error} onBack={handleBack} />
        )}
      </>

      {/* No floating promo or tip toasts: both are inline (home self-host row, results tip row). */}
      <InstallPrompt />
      {phase === "complete" && autoSwitchedNetwork && (
        <Suspense fallback={null}><NetworkSwitchToast key={query} network={autoSwitchedNetwork} kind={inputType === "address" ? "address" : "txid"} /></Suspense>
      )}
      {wallet.autoSwitchedNetwork && (
        <Suspense fallback={null}><NetworkSwitchToast key={wallet.query} network={wallet.autoSwitchedNetwork} kind="wallet" /></Suspense>
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
