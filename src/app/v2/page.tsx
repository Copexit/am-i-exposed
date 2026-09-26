"use client";

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence } from "motion/react";
import { Loader2 } from "lucide-react";
import { useScanner } from "@/hooks/useScanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { XpubPrivacyWarning } from "@/components/wallet/XpubPrivacyWarning";
import { V2Home } from "@/components/v2/home/V2Home";
import { V2Scan } from "@/components/v2/scan/V2Scan";
import { V2Results } from "@/components/v2/results/V2Results";
import { V2Destination } from "@/components/v2/flows/V2Destination";
import { V2Error } from "@/components/v2/flows/V2Error";
import { V2WalletLoading } from "@/components/v2/flows/V2WalletLoading";
const NetworkSwitchToast = lazy(() => import("@/components/NetworkSwitchToast").then(m => ({ default: m.NetworkSwitchToast })));
const V2WalletResults = lazy(() => import("@/components/v2/flows/V2WalletResults").then(m => ({ default: m.V2WalletResults })));

export default function V2ScannerPage() {
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
      {/*
        Deep link waiting for backend detection (local API / Tor probe, up to ~10s).
        Rendered outside AnimatePresence on purpose: it has no exit animation to
        wait for, so it can never hold back the view that replaces it.
      */}
      {phase === "idle" && pendingHash && !walletActive && (
        <div data-testid="pending-hash-loader" className="flex-1 flex items-center justify-center gap-2 text-sm text-muted py-24">
          <Loader2 size={16} className="animate-spin text-bitcoin" aria-hidden="true" />
          {t("common.loading", { defaultValue: "Loading..." })}
        </div>
      )}
      {/* Every direct child of AnimatePresence carries its own key (motion >= 12.41). */}
      <AnimatePresence mode="wait">
        {phase === "idle" && !pendingHash && !walletActive && (
          <V2Home
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
          <V2Scan
            key="loading"
            query={query ?? ""}
            inputType={inputType}
            phase={phase}
            steps={steps}
            fetchProgress={fetchProgress}
          />
        )}

        {phase === "complete" && query && inputType && result && (
          <V2Results
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
          <V2Destination key="destination" query={query} preSendResult={preSendResult} onBack={handleBack} durationMs={durationMs} />
        )}

        {phase === "error" && error !== "xpub" && (
          <V2Error key="error" error={error} query={query} errorCode={errorCode} onRetry={analyze} onBack={handleBack} />
        )}

        {walletActive && wallet.phase !== "complete" && wallet.phase !== "error" && (
          <V2WalletLoading
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
            <V2WalletResults
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
          <V2Error key="wallet-error" error={wallet.error} onBack={handleBack} />
        )}
      </AnimatePresence>

      {/* No floating promo or tip toasts in v2: both are inline (home self-host row, results tip row). */}
      <InstallPrompt />
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
