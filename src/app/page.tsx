"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck, ShieldX, AlertCircle, ArrowLeft, EyeOff, Github } from "lucide-react";
import { AddressInput } from "@/components/AddressInput";
import { DiagnosticLoader } from "@/components/DiagnosticLoader";
import { ResultsPanel } from "@/components/ResultsPanel";
import { ScanHistory } from "@/components/ScanHistory";
import { InstallPrompt } from "@/components/InstallPrompt";
import { GlowCard } from "@/components/ui/GlowCard";
import { useAnalysis } from "@/hooks/useAnalysis";
import { useNetwork } from "@/context/NetworkContext";
import { useRecentScans } from "@/hooks/useRecentScans";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { TipToast } from "@/components/TipToast";
import { FindingCard } from "@/components/FindingCard";
import type { PreSendResult } from "@/lib/analysis/orchestrator";

const DESTINATION_ONLY_CONFIG = {
  LOW: {
    icon: ShieldCheck,
    color: "text-severity-good",
    bg: "bg-severity-good/10 border-severity-good/30",
    labelKey: "presend.riskLow",
    labelDefault: "Low Risk",
  },
  MEDIUM: {
    icon: ShieldCheck,
    color: "text-severity-medium",
    bg: "bg-severity-medium/10 border-severity-medium/30",
    labelKey: "presend.riskMedium",
    labelDefault: "Medium Risk",
  },
  HIGH: {
    icon: ShieldX,
    color: "text-severity-high",
    bg: "bg-severity-high/10 border-severity-high/30",
    labelKey: "presend.riskHigh",
    labelDefault: "High Risk",
  },
  CRITICAL: {
    icon: ShieldX,
    color: "text-severity-critical",
    bg: "bg-severity-critical/10 border-severity-critical/30",
    labelKey: "presend.riskCritical",
    labelDefault: "Critical Risk",
  },
} as const;

function DestinationOnlyResult({ query, preSendResult, onBack, durationMs }: {
  query: string;
  preSendResult: PreSendResult;
  onBack: () => void;
  durationMs?: number | null;
}) {
  const { t } = useTranslation();
  const risk = DESTINATION_ONLY_CONFIG[preSendResult.riskLevel];
  const RiskIcon = risk.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col items-center gap-8 w-full max-w-3xl"
    >
      <div className="w-full flex items-center">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer px-3 py-2 min-h-[44px] rounded-lg border border-card-border hover:border-muted/50 bg-surface-elevated/50"
        >
          <ArrowLeft size={16} />
          {t("results.newScan", { defaultValue: "New scan" })}
        </button>
      </div>

      <GlowCard className="w-full p-7 space-y-6">
        <div className="space-y-1">
          <span className="text-sm font-medium text-muted uppercase tracking-wider">
            {t("results.address", { defaultValue: "Address" })}
          </span>
          <p className="font-mono text-sm text-foreground/90 break-all leading-relaxed">{query}</p>
        </div>
        <div className={`rounded-xl border p-6 ${risk.bg} flex flex-col items-center gap-3`}>
          <RiskIcon size={40} className={risk.color} />
          <span className={`text-2xl font-bold ${risk.color}`}>
            {t(risk.labelKey, { defaultValue: risk.labelDefault })}
          </span>
          <p className="text-sm text-center text-foreground max-w-md">
            {t(preSendResult.summaryKey, {
              reuseCount: preSendResult.timesReceived,
              txCount: preSendResult.txCount,
              defaultValue: preSendResult.summary,
            })}
          </p>
        </div>
      </GlowCard>

      {preSendResult.findings.length > 0 && (
        <div className="w-full space-y-3">
          <h2 className="text-base font-medium text-muted uppercase tracking-wider px-1">
            {t("results.findingsHeading", { count: preSendResult.findings.length, defaultValue: "Findings ({{count}})" })}
          </h2>
          <div className="space-y-2">
            {preSendResult.findings.map((finding, i) => (
              <FindingCard key={finding.id} finding={finding} index={i} />
            ))}
          </div>
        </div>
      )}

      <div className="w-full bg-surface-inset rounded-lg px-4 py-3 text-sm text-muted leading-relaxed">
        {t("presend.disclaimerCompleted", { defaultValue: "Pre-send check completed" })}{durationMs ? t("presend.disclaimerDuration", { duration: (durationMs / 1000).toFixed(1), defaultValue: " in {{duration}}s" }) : ""}.
        {" "}{t("presend.disclaimerBrowser", { defaultValue: "Analysis ran entirely in your browser. This is a heuristic-based assessment - always verify independently." })}
      </div>
    </motion.div>
  );
}

const EXAMPLES = [
  {
    labelKey: "page.example_whirlpool",
    labelDefault: "Whirlpool CoinJoin",
    hint: "A+",
    hintColor: "text-severity-good",
    input: "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2",
  },
  {
    labelKey: "page.example_wabisabi",
    labelDefault: "WabiSabi CoinJoin",
    hint: "A+",
    hintColor: "text-severity-good",
    input: "fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e",
  },
  {
    labelKey: "page.example_satoshi",
    labelDefault: "Satoshi's address",
    hint: "F",
    hintColor: "text-severity-critical",
    input: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  },
  {
    labelKey: "page.example_opreturn",
    labelDefault: "OP_RETURN data",
    hint: "D",
    hintColor: "text-severity-high",
    input: "8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684",
  },
  {
    labelKey: "page.presend_sanctioned",
    labelDefault: "OFAC sanctioned",
    hint: "Critical",
    hintColor: "text-severity-critical",
    input: "12QtD5BFwRsdNsAZY76UVE1xyCGNTojH9h",
  },
  {
    labelKey: "page.presend_fresh",
    labelDefault: "Fresh address",
    hint: "A",
    hintColor: "text-severity-good",
    input: "bc1pes5mfje89xdr6uh4qu6p4m0r8d6nz3tvgagtwgv99yalqwzyhdzqrl3mnu",
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
    addressUtxos,
    preSendResult,
    error,
    errorCode,
    durationMs,
    analyze,
    reset,
  } = useAnalysis();

  const { t } = useTranslation();
  const { scans, addScan, clearScans } = useRecentScans();
  const { bookmarks, removeBookmark, clearBookmarks } = useBookmarks();
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep latest function refs for hashchange listener (avoids stale closures)
  const analyzeRef = useRef(analyze);
  const resetRef = useRef(reset);
  useEffect(() => {
    analyzeRef.current = analyze;
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
        type: inputType === "txid" ? "txid" : "address",
        grade: result.grade,
        score: result.score,
      });
    }
  }, [phase, query, inputType, result, addScan]);

  // Wait for API status to settle before processing initial hash URL.
  // This prevents firing requests to mempool.space on Umbrel where the
  // local API probe hasn't resolved yet.
  const { localApiStatus } = useNetwork();
  const initialHashProcessed = useRef(false);

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

      // #check=X is treated as #addr=X (unified flow)
      const input = txid ?? addr ?? check;
      if (input) {
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

  const handleSubmit = (input: string) => {
    const prefix = input.length === 64 ? "tx" : "addr";
    window.location.hash = `${prefix}=${encodeURIComponent(input)}`;
    analyze(input);
  };

  const handleBack = () => {
    window.location.hash = "";
    reset();
  };

  // Aria-live announcements for screen readers during phase transitions
  const ariaStatus =
    phase === "fetching" || phase === "analyzing"
      ? t("page.aria_scanning", { defaultValue: "Scanning. Please wait." })
      : phase === "complete" && result
        ? t("page.aria_complete", { grade: result.grade, score: result.score, defaultValue: `Scan complete. Grade ${result.grade}, score ${result.score} out of 100.` })
        : phase === "error"
          ? t("page.aria_error", { error: error ?? "", defaultValue: `Analysis failed. ${error ?? ""}` })
          : "";

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-3 sm:px-4 py-4 sm:py-6">
      <div className="sr-only" role="status" aria-live="polite">{ariaStatus}</div>
      <AnimatePresence mode="wait">
        {phase === "idle" && (
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
              onSelect={handleSubmit}
              onClearScans={clearScans}
              onRemoveBookmark={removeBookmark}
              onClearBookmarks={clearBookmarks}
            />

            {scans.length === 0 && bookmarks.length === 0 && (
              <div className="w-full max-w-3xl">
                <div className="flex items-center gap-1.5 text-base text-muted mb-2 px-1">
                  <span>
                    {t("page.try_example", { defaultValue: "Try an example" })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 justify-center">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.input}
                      onClick={() => handleSubmit(ex.input)}
                      className="inline-flex items-center gap-2 px-4 py-3 sm:py-2 rounded-lg bg-surface-elevated/50
                        border border-card-border hover:border-bitcoin/40 hover:bg-surface-elevated
                        transition-all text-sm cursor-pointer group"
                    >
                      <span className="text-muted group-hover:text-foreground transition-colors">
                        {t(ex.labelKey, { defaultValue: ex.labelDefault })}
                      </span>
                      <span className={`text-xs font-bold ${ex.hintColor}`}>
                        {ex.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
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
                <DiagnosticLoader steps={steps} phase={phase} />
              </div>
            </GlowCard>
          </motion.div>
        )}

        {phase === "complete" && query && inputType && result && (
          <ResultsPanel
            key="results"
            query={query}
            inputType={inputType}
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
          />
        )}

        {phase === "complete" && query && preSendResult && !result && (
          <DestinationOnlyResult
            query={query}
            preSendResult={preSendResult}
            onBack={handleBack}
            durationMs={durationMs}
          />
        )}

        {phase === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 10, filter: "blur(4px)" }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col items-center gap-6 w-full max-w-xl mt-8 sm:mt-0"
          >
            <div data-testid="error-message" className="glass border-severity-critical/30 rounded-xl p-8 w-full space-y-4 text-center">
              <AlertCircle size={32} className="text-severity-critical mx-auto" />
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-foreground">
                  {t("page.error_title", { defaultValue: "Analysis failed" })}
                </h2>
                {query && (
                  <p className="font-mono text-sm text-muted break-all text-left mx-auto max-w-sm">
                    {query}
                  </p>
                )}
                <p className="text-sm text-muted leading-relaxed">
                  {error}
                </p>
              </div>
              <div className="flex items-center justify-center gap-4">
                {query && error && errorCode !== "not-retryable" && (
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
