"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck, AlertCircle, Scan, Fingerprint, Shield, Eye } from "lucide-react";
import { AddressInput } from "@/components/AddressInput";
import { DiagnosticLoader } from "@/components/DiagnosticLoader";
import { ResultsPanel } from "@/components/ResultsPanel";
import { PreSendResultPanel } from "@/components/PreSendResultPanel";
import { RecentScans } from "@/components/RecentScans";
import { InstallPrompt } from "@/components/InstallPrompt";
import { useAnalysis } from "@/hooks/useAnalysis";
import { useRecentScans } from "@/hooks/useRecentScans";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { TipToast } from "@/components/TipToast";
import type { AnalysisMode } from "@/lib/types";

const PRIVACY_TIP_KEYS = [
  "tips.0",
  "tips.1",
  "tips.2",
  "tips.3",
  "tips.4",
  "tips.5",
  "tips.6",
  "tips.7",
];

const PRIVACY_TIPS_EN = [
  "Never reuse a Bitcoin address. HD wallets generate a new address for each receive automatically.",
  "CoinJoin breaks the common-input-ownership heuristic, making chain analysis significantly harder.",
  "Use Tor when broadcasting transactions. Your IP can be correlated with your on-chain activity.",
  "Round payment amounts (e.g., 0.01 BTC) reveal which output is the payment and which is change.",
  "Taproot (bc1p...) addresses make all transaction types look identical on-chain.",
  "Dust outputs (< 1000 sats) may be surveillance dust. Freeze them in your wallet's coin control.",
  "Wallet software can be identified through nLockTime, nSequence, and signature patterns.",
  "PayJoin has the receiver contribute an input, breaking the assumption that all inputs belong to the sender.",
];

const EXAMPLES = [
  {
    labelKey: "page.example_whirlpool",
    labelDefault: "Whirlpool CoinJoin",
    hint: "A+",
    input: "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2",
  },
  {
    labelKey: "page.example_wabisabi",
    labelDefault: "WabiSabi CoinJoin",
    hint: "A+",
    input: "fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e",
  },
  {
    labelKey: "page.example_satoshi",
    labelDefault: "Satoshi's address",
    hint: "F",
    input: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  },
  {
    labelKey: "page.example_opreturn",
    labelDefault: "OP_RETURN data",
    hint: "C",
    input: "8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684",
  },
];

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
    preSendResult,
    error,
    durationMs,
    analyze,
    checkDestination,
    reset,
  } = useAnalysis();

  const { t } = useTranslation();
  const { scans, addScan, clearScans } = useRecentScans();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tipIndex, setTipIndex] = useState(
    () => Math.floor(Math.random() * PRIVACY_TIP_KEYS.length),
  );
  const [mode, setMode] = useState<AnalysisMode>("scan");

  // Keep latest function refs for hashchange listener (avoids stale closures)
  const analyzeRef = useRef(analyze);
  const checkDestinationRef = useRef(checkDestination);
  const resetRef = useRef(reset);
  useEffect(() => {
    analyzeRef.current = analyze;
    checkDestinationRef.current = checkDestination;
    resetRef.current = reset;
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
    if (phase === "complete" && preSendResult && mode === "check") {
      document.title = `${preSendResult.riskLevel} ${t("page.title_risk", { defaultValue: "Risk" })} - am-i.exposed`;
    } else if (phase === "complete" && result) {
      document.title = `${result.grade} (${result.score}/100) - am-i.exposed`;
    } else if (phase === "fetching" || phase === "analyzing") {
      document.title = `${mode === "check" ? t("page.title_checking", { defaultValue: "Checking" }) : t("page.title_scanning", { defaultValue: "Scanning" })}... - am-i.exposed`;
    } else {
      document.title = `am-i.exposed - ${t("page.title_default", { defaultValue: "Bitcoin Privacy Scanner" })}`;
    }
  }, [phase, result, preSendResult, mode, t]);

  // Save completed scan to recent history
  useEffect(() => {
    if (phase === "complete" && query && inputType && result) {
      addScan({
        input: query,
        type: inputType === "txid" ? "txid" : "address",
        grade: result.grade,
        score: result.score,
      });
    }
  }, [phase, query, inputType, result, addScan]);

  // Auto-analyze from URL hash on mount and on hash change (back button)
  // Uses refs to always access latest function references after network changes
  useEffect(() => {
    function handleHash() {
      const hash = window.location.hash.slice(1);
      if (!hash) {
        resetRef.current();
        return;
      }

      const params = new URLSearchParams(hash);
      const txid = params.get("tx");
      const addr = params.get("addr");
      const check = params.get("check");

      if (check) {
        setMode("check");
        checkDestinationRef.current(check);
      } else {
        const input = txid ?? addr;
        if (input) {
          setMode("scan");
          analyzeRef.current(input);
        }
      }
    }

    // Run on mount
    handleHash();

    // Listen for back/forward navigation
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

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

  const handleSubmit = (input: string) => {
    if (mode === "check") {
      window.location.hash = `check=${input}`;
      checkDestination(input);
    } else {
      const prefix = input.length === 64 ? "tx" : "addr";
      window.location.hash = `${prefix}=${input}`;
      analyze(input);
    }
  };

  const handleBack = () => {
    window.location.hash = "";
    reset();
  };

  // Aria-live announcements for screen readers during phase transitions
  const ariaStatus =
    phase === "fetching" || phase === "analyzing"
      ? t("page.aria_scanning", { defaultValue: `${mode === "check" ? "Checking destination" : "Scanning"}. Please wait.` })
      : phase === "complete" && result && mode === "scan"
        ? t("page.aria_complete", { grade: result.grade, score: result.score, defaultValue: `Scan complete. Grade ${result.grade}, score ${result.score} out of 100.` })
        : phase === "complete" && preSendResult && mode === "check"
          ? t("page.aria_check_complete", { riskLevel: preSendResult.riskLevel, defaultValue: `Check complete. Risk level: ${preSendResult.riskLevel}.` })
          : phase === "error"
            ? t("page.aria_error", { error: error ?? "", defaultValue: `Analysis failed. ${error ?? ""}` })
            : "";

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-6">
      <div className="sr-only" role="status" aria-live="polite">{ariaStatus}</div>
      <AnimatePresence mode="wait">
        {phase === "idle" && (
          <motion.div
            key="hero"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col items-center gap-8 text-center w-full"
          >
            <div className="space-y-3">
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-tight">
                <span className="text-foreground">{t("page.hero_prefix", { defaultValue: "Am I " })}</span>
                <span className="text-danger">{t("page.hero_suffix", { defaultValue: "exposed?" })}</span>
              </h1>
              <p className="text-muted text-lg sm:text-xl max-w-xl mx-auto">
                {t("page.tagline", { defaultValue: "The Bitcoin privacy scanner you were afraid to run." })}
              </p>
            </div>

            <AddressInput
              onSubmit={handleSubmit}
              isLoading={false}
              inputRef={inputRef}
              mode={mode}
              onModeChange={setMode}
            />

            <RecentScans scans={scans} onSelect={handleSubmit} onClear={clearScans} />

            {scans.length === 0 && (
              <div className="w-full max-w-3xl">
                <div className="flex items-center gap-1.5 text-base text-muted mb-2 px-1">
                  <span>{t("page.try_example", { defaultValue: "Try an example" })}</span>
                </div>
                <div className="flex flex-wrap gap-2 justify-center">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.input}
                      onClick={() => handleSubmit(ex.input)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-elevated/50
                        border border-card-border hover:border-bitcoin/40 hover:bg-surface-elevated
                        transition-all text-sm cursor-pointer group"
                    >
                      <span className="text-muted group-hover:text-foreground transition-colors">
                        {t(ex.labelKey, { defaultValue: ex.labelDefault })}
                      </span>
                      <span className={`text-xs font-bold ${
                        ex.hint === "A+" ? "text-severity-good" :
                        ex.hint === "F" ? "text-severity-critical" :
                        "text-severity-medium"
                      }`}>
                        {ex.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-muted text-sm sm:text-base max-w-xl mx-auto">
              {t("page.description", { defaultValue: "Find out what the blockchain knows about you. Paste a Bitcoin address or transaction ID to get a privacy score with actionable findings." })}
            </p>

            <h2 className="sr-only">{t("page.featuresHeading", { defaultValue: "Features" })}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-3xl">
              {[
                { icon: Scan, label: t("page.feat_heuristics", { defaultValue: "16 heuristics" }), desc: t("page.feat_heuristics_desc", { defaultValue: "Score 0-100" }) },
                { icon: Fingerprint, label: t("page.feat_wallet", { defaultValue: "Wallet ID" }), desc: t("page.feat_wallet_desc", { defaultValue: "Fingerprinting" }) },
                { icon: Shield, label: "CoinJoin", desc: t("page.feat_coinjoin_desc", { defaultValue: "Whirlpool & Wasabi" }) },
                { icon: Eye, label: t("page.feat_dust", { defaultValue: "Dust attacks" }), desc: t("page.feat_dust_desc", { defaultValue: "Don't spend it" }) },
              ].map((feat) => (
                <div
                  key={feat.label}
                  className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-surface-elevated/30 border border-card-border"
                >
                  <feat.icon size={20} className="text-bitcoin/50" />
                  <span className="text-sm font-medium text-foreground">{feat.label}</span>
                  <span className="text-sm text-muted">{feat.desc}</span>
                </div>
              ))}
            </div>

            <h2 className="sr-only">{t("page.tipsHeading", { defaultValue: "Privacy Tips" })}</h2>
            <button
              onClick={() => setTipIndex((i) => (i + 1) % PRIVACY_TIP_KEYS.length)}
              className="w-full max-w-lg mx-auto text-center cursor-pointer group"
            >
              <p className="text-sm text-muted mb-1">{t("page.privacy_tip", { defaultValue: "Privacy tip" })}</p>
              <p suppressHydrationWarning className="text-sm text-muted leading-relaxed group-hover:text-muted transition-colors">
                {t(PRIVACY_TIP_KEYS[tipIndex], { defaultValue: PRIVACY_TIPS_EN[tipIndex] })}
              </p>
            </button>

            <div className="flex flex-wrap items-center justify-center gap-4 text-base text-muted">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={16} className="text-success/50" />
                {t("page.trust_client", { defaultValue: "100% client-side" })}
              </span>
              <span>{t("page.trust_tracking", { defaultValue: "No tracking" })}</span>
              <a href="https://github.com/Copexit/am-i-exposed" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">{t("page.trust_opensource", { defaultValue: "Open source" })}</a>
            </div>

          </motion.div>
        )}

        {(phase === "fetching" || phase === "analyzing") && (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col items-center gap-6 w-full max-w-3xl"
          >
            <div className="w-full bg-card-bg border border-card-border rounded-xl p-8 space-y-6">
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted uppercase tracking-wider">
                  {mode === "check" ? t("page.label_presend", { defaultValue: "Pre-send destination check" }) : inputType === "txid" ? t("page.label_transaction", { defaultValue: "Transaction" }) : t("page.label_address", { defaultValue: "Address" })}
                </span>
                <p className="font-mono text-sm text-foreground/90 break-all leading-relaxed">
                  {query}
                </p>
              </div>
              <div className="border-t border-card-border pt-6">
                <DiagnosticLoader steps={steps} phase={phase} />
              </div>
            </div>
          </motion.div>
        )}

        {phase === "complete" && query && inputType && result && mode === "scan" && (
          <ResultsPanel
            key="results"
            query={query}
            inputType={inputType}
            result={result}
            txData={txData}
            addressData={addressData}
            addressTxs={addressTxs}
            txBreakdown={txBreakdown}
            onBack={handleBack}
            onScan={handleSubmit}
            durationMs={durationMs}
          />
        )}

        {phase === "complete" && query && preSendResult && mode === "check" && (
          <PreSendResultPanel
            key="presend"
            query={query}
            preSendResult={preSendResult}
            addressData={addressData}
            onBack={handleBack}
            durationMs={durationMs}
          />
        )}

        {phase === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col items-center gap-6 w-full max-w-xl mt-8 sm:mt-0"
          >
            <div className="bg-card-bg border border-severity-critical/30 rounded-xl p-8 w-full space-y-4 text-center">
              <AlertCircle size={32} className="text-severity-critical mx-auto" />
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-foreground">
                  {t("page.error_title", { defaultValue: "Analysis failed" })}
                </h2>
                {query && (
                  <p className="font-mono text-sm text-muted break-all">
                    {query}
                  </p>
                )}
                <p className="text-sm text-muted leading-relaxed">
                  {error}
                </p>
              </div>
              <div className="flex items-center justify-center gap-4">
                {query && error && !error.includes("Not found") && !error.includes("Invalid") && !error.includes("only works with") && (
                  <button
                    onClick={() => analyze(query)}
                    className="px-4 py-1.5 bg-bitcoin text-black font-semibold text-sm rounded-lg
                      hover:bg-bitcoin-hover transition-all duration-150 cursor-pointer"
                  >
                    {t("page.retry", { defaultValue: "Retry" })}
                  </button>
                )}
                <button
                  onClick={handleBack}
                  className="text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  {t("page.new_scan", { defaultValue: "New scan" })}
                </button>
              </div>
            </div>
            <div className="text-xs text-muted hidden sm:block">
              {t("page.kbd_back", { defaultValue: "Press" })} <kbd className="px-1.5 py-0.5 rounded bg-surface-elevated border border-card-border text-muted font-mono">Esc</kbd> {t("page.kbd_back_suffix", { defaultValue: "to go back" })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <InstallPrompt />
      {phase === "complete" && <TipToast />}
    </div>
  );
}
