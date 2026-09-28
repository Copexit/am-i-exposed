"use client";

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useScanner } from "@/hooks/useScanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { XpubPrivacyWarning } from "@/components/wallet/XpubPrivacyWarning";
import { Home } from "@/components/home/Home";
import { ScanScreen } from "@/components/scan/ScanScreen";
import { Results } from "@/components/results/Results";
import { DestinationResult } from "@/components/flows/DestinationResult";
import { ErrorScreen } from "@/components/flows/ErrorScreen";
import { WalletLoading } from "@/components/flows/WalletLoading";
const NetworkSwitchToast = lazy(() => import("@/components/NetworkSwitchToast").then(m => ({ default: m.NetworkSwitchToast })));
const WalletResults = lazy(() => import("@/components/flows/WalletResults").then(m => ({ default: m.WalletResults })));

export default function ScannerPage() {
  const {
    analysis, wallet, walletActive, recent, bookmarks: bm, inputRef, pendingHash, pendingXpub,
    xpubAddressCount, apiEndpoint, isThirdPartyApi, isLocalApi, ariaStatus,
    handleSubmit, handleBack, handleXpubConfirm, handleXpubCancel,
  } = useScanner();
  const {
    phase, query, inputType, steps, result, txData, addressData,
    txBreakdown, addressTxs, addressUtxos, preSendResult, error,
    errorCode, durationMs, usdPrice, outspends, psbtData, fetchProgress,
    backwardLayers, forwardLayers, boltzmannResult, autoSwitchedNetwork, fromCache, analyze,
  } = analysis;
  const { t } = useTranslation();

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
            txData={inputType === "txid" ? txData : null}
          />
        )}

        {phase === "complete" && query && inputType && result && (
          <Results
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
            onScan={handleSubmit}
            onBack={handleBack}
            durationMs={durationMs}
            usdPrice={usdPrice}
            outspends={outspends}
            backwardLayers={backwardLayers}
            forwardLayers={forwardLayers}
            boltzmannResult={boltzmannResult}
            reveal={!fromCache}
            psbt={psbtData ? {
              inputCount: psbtData.inputCount,
              outputCount: psbtData.outputCount,
              fee: psbtData.fee,
              feeRate: psbtData.feeRate,
              complete: psbtData.complete,
            } : null}
          />
        )}

        {phase === "complete" && query && preSendResult && !result && (
          <DestinationResult key="destination" query={query} preSendResult={preSendResult} onBack={handleBack} durationMs={durationMs} />
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
