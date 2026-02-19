"use client";

import { useEffect, useRef, useState } from "react";
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

const PRIVACY_TIPS = [
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
    label: "Whirlpool CoinJoin",
    hint: "A+",
    input: "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2",
  },
  {
    label: "WabiSabi CoinJoin",
    hint: "A+",
    input: "fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e",
  },
  {
    label: "Satoshi's address",
    hint: "F",
    input: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  },
  {
    label: "OP_RETURN data",
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

  const { scans, addScan, clearScans } = useRecentScans();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tipIndex, setTipIndex] = useState(
    () => Math.floor(Math.random() * PRIVACY_TIPS.length),
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
      document.title = `${preSendResult.riskLevel} Risk - am-i.exposed`;
    } else if (phase === "complete" && result) {
      document.title = `${result.grade} (${result.score}/100) - am-i.exposed`;
    } else if (phase === "fetching" || phase === "analyzing") {
      document.title = `${mode === "check" ? "Checking" : "Scanning"}... - am-i.exposed`;
    } else {
      document.title = "am-i.exposed - Bitcoin Privacy Scanner";
    }
  }, [phase, result, preSendResult, mode]);

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
      ? `${mode === "check" ? "Checking destination" : "Scanning"}. Please wait.`
      : phase === "complete" && result && mode === "scan"
        ? `Scan complete. Grade ${result.grade}, score ${result.score} out of 100.`
        : phase === "complete" && preSendResult && mode === "check"
          ? `Check complete. Risk level: ${preSendResult.riskLevel}.`
          : phase === "error"
            ? `Analysis failed. ${error ?? ""}`
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
                <span className="text-foreground">Am I </span>
                <span className="text-danger">exposed?</span>
              </h1>
              <p className="text-muted text-lg sm:text-xl max-w-xl mx-auto">
                The Bitcoin privacy scanner you were afraid to run.
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
                <div className="flex items-center gap-1.5 text-sm text-muted/80 mb-2 px-1">
                  <span>Try an example</span>
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
                      <span className="text-muted group-hover:text-foreground/70 transition-colors">
                        {ex.label}
                      </span>
                      <span className={`text-xs font-bold ${
                        ex.hint === "A+" ? "text-severity-good/60" :
                        ex.hint === "F" ? "text-severity-critical/60" :
                        "text-severity-medium/60"
                      }`}>
                        {ex.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-muted/80 text-sm sm:text-base max-w-xl mx-auto">
              Find out what the blockchain knows about you. Paste a Bitcoin address
              or transaction ID to get a privacy score with actionable findings.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-3xl">
              {[
                { icon: Scan, label: "16 heuristics", desc: "Deep analysis" },
                { icon: Fingerprint, label: "Wallet ID", desc: "Fingerprinting" },
                { icon: Shield, label: "CoinJoin", desc: "Detection" },
                { icon: Eye, label: "Dust attacks", desc: "Flagged" },
              ].map((feat) => (
                <div
                  key={feat.label}
                  className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-surface-elevated/30 border border-card-border/30"
                >
                  <feat.icon size={20} className="text-bitcoin/50" />
                  <span className="text-sm font-medium text-foreground/70">{feat.label}</span>
                  <span className="text-xs text-muted/70">{feat.desc}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setTipIndex((i) => (i + 1) % PRIVACY_TIPS.length)}
              className="w-full max-w-lg mx-auto text-center cursor-pointer group"
            >
              <p className="text-xs text-muted/70 mb-1">Privacy tip</p>
              <p suppressHydrationWarning className="text-sm text-muted/80 leading-relaxed group-hover:text-muted/80 transition-colors">
                {PRIVACY_TIPS[tipIndex]}
              </p>
            </button>

            <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-muted/70">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={16} className="text-success/50" />
                100% client-side
              </span>
              <span>No tracking</span>
              <span>Open source</span>
            </div>

            <div className="text-xs text-muted/80 hidden sm:block">
              Press <kbd className="px-1.5 py-0.5 rounded bg-surface-elevated border border-card-border text-muted/70 font-mono">/</kbd> to focus search
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
                  {mode === "check" ? "Pre-send destination check" : inputType === "txid" ? "Transaction" : "Address"}
                </span>
                <p className="font-mono text-sm text-foreground/80 break-all leading-relaxed">
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
                  Analysis failed
                </h2>
                {query && (
                  <p className="font-mono text-xs text-muted/70 break-all">
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
                    Retry
                  </button>
                )}
                <button
                  onClick={handleBack}
                  className="text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  New scan
                </button>
              </div>
            </div>
            <div className="text-xs text-muted/70 hidden sm:block">
              Press <kbd className="px-1.5 py-0.5 rounded bg-surface-elevated border border-card-border text-muted/70 font-mono">Esc</kbd> to go back
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <InstallPrompt />
      {phase === "complete" && <TipToast />}
    </div>
  );
}
