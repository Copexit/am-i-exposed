"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Settings, Check, X, Loader2, RotateCcw, ChevronDown, ChevronUp, AlertTriangle, Sliders, Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { useAnalysisSettings } from "@/hooks/useAnalysisSettings";
import { diagnoseUrl } from "@/lib/api/url-diagnostics";
import { abortSignalTimeout } from "@/lib/abort-signal";
import { type BitcoinNetwork } from "@/lib/bitcoin/networks";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/config";
import {
  getFilterStatus,
  getFullFilterStatus,
  isFullFilterLoaded,
  getFilter,
  loadEntityFilter,
  loadFullEntityFilter,
} from "@/lib/analysis/entity-filter";

type HealthStatus = "idle" | "checking" | "ok" | "error";

const NETWORKS: { value: BitcoinNetwork; label: string; dot: string }[] = [
  { value: "mainnet", label: "Mainnet", dot: "bg-bitcoin" },
  { value: "testnet4", label: "Testnet4", dot: "bg-success" },
  { value: "signet", label: "Signet", dot: "bg-info" },
];

export function ApiSettings() {
  const { t, i18n } = useTranslation();
  const { network, setNetwork, customApiUrl, setCustomApiUrl, isUmbrel } = useNetwork();
  const { settings: analysisSettings, update: updateAnalysis, reset: resetAnalysis, DEFAULTS: ANALYSIS_DEFAULTS } = useAnalysisSettings();
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(customApiUrl ?? "");
  const [health, setHealth] = useState<HealthStatus>("idle");
  const [errorHint, setErrorHint] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentNetwork = NETWORKS.find((n) => n.value === network) ?? NETWORKS[0];

  // Pre-flight diagnostics on the current input URL
  const diagnostic = useMemo(() => {
    const trimmed = inputValue.trim().replace(/\/+$/, "");
    if (!trimmed) return null;
    try {
      new URL(trimmed);
    } catch {
      return null;
    }
    return diagnoseUrl(trimmed);
  }, [inputValue]);

  // Close on click outside (check both panel and button since portal moves panel out of DOM tree)
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(target) &&
        buttonRef.current && !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // Focus input and sync value when opened
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Focus trap when panel is open
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const savedFocus = document.activeElement as HTMLElement | null;
    function handleTrap(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, input, select, a, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleTrap);
    return () => {
      document.removeEventListener("keydown", handleTrap);
      savedFocus?.focus();
    };
  }, [open]);

  const checkHealth = useCallback(
    async (url: string) => {
      const trimmed = url.trim().replace(/\/+$/, "");
      if (!trimmed) return;

      setHealth("checking");
      setErrorHint("");

      try {
        const res = await fetch(`${trimmed}/blocks/tip/height`, {
          signal: abortSignalTimeout(10000),
        });
        if (res.ok) {
          setHealth("ok");
          setCustomApiUrl(trimmed);
        } else {
          setHealth("error");
          setErrorHint(`HTTP ${res.status}`);
        }
      } catch (err) {
        setHealth("error");
        // Use pre-flight diagnostic to give a more specific error
        const diag = diagnoseUrl(trimmed);
        if (diag.isMixedContent) {
          setErrorHint(
            t("settings.mixedContent", {
              defaultValue: "Blocked: your browser prevents HTTP requests from this HTTPS page. Use SSH port forwarding to localhost, or set up HTTPS on your node.",
            })
          );
        } else if (err instanceof TypeError && err.message.includes("fetch")) {
          setErrorHint(
            t("settings.corsError", {
              defaultValue: "Connection failed. Your node likely needs CORS headers. See the setup guide below.",
            })
          );
        } else if (err instanceof DOMException && err.name === "AbortError") {
          setErrorHint(t("settings.timeout", { defaultValue: "Timeout (10s)" }));
        } else {
          setErrorHint(t("settings.connectionFailed", { defaultValue: "Connection failed" }));
        }
      }
    },
    [setCustomApiUrl, t],
  );

  const handleReset = useCallback(() => {
    setCustomApiUrl(null);
    setInputValue("");
    setHealth("idle");
    setErrorHint("");
  }, [setCustomApiUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    checkHealth(inputValue);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => {
          if (!open) {
            setInputValue(customApiUrl ?? "");
            // If a custom URL is already active, show it as connected
            setHealth(customApiUrl ? "ok" : "idle");
            setErrorHint("");
          }
          setOpen(!open);
        }}
        className="relative inline-flex items-center gap-1.5 text-muted hover:text-foreground transition-colors cursor-pointer p-2 rounded-lg border border-card-border bg-surface-elevated hover:bg-surface-inset"
        aria-label={t("settings.ariaLabel", { defaultValue: "Settings" })}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t("settings.title", { defaultValue: "Settings" })}
      >
        <Settings size={18} />
        {/* Network indicator dot */}
        <span className={`w-2 h-2 rounded-full ${currentNetwork.dot}`} />
        {customApiUrl && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-bitcoin rounded-full" />
        )}
      </button>

      {open && createPortal(
        <>
        {/* Mobile backdrop */}
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] sm:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label={t("settings.ariaLabel", { defaultValue: "Settings" })} className="fixed inset-x-0 bottom-0 sm:bottom-auto sm:top-[72px] rounded-t-2xl sm:rounded-xl mx-0 sm:inset-x-auto sm:right-4 sm:mx-0 sm:mt-2 sm:w-96 z-[60] p-4 space-y-4 max-h-[70dvh] sm:max-h-[80vh] overflow-y-auto border border-glass-border" style={{ background: "var(--card-bg)", boxShadow: "var(--glass-shadow)" }}>

          {/* Mobile drag handle */}
          <div className="flex justify-center sm:hidden pb-2">
            <div className="w-10 h-1 rounded-full bg-muted/30" />
          </div>

          {/* Settings heading (mobile only) */}
          <h2 className="text-sm font-semibold text-foreground">{t("settings.title", { defaultValue: "Settings" })}</h2>

          {/* Network & Language row */}
          <div className="flex items-center gap-3">
            {/* Network selector - hidden on Umbrel (network is preconfigured) */}
            {!isUmbrel && (
            <div className="flex-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-1.5">
                {t("settings.network", { defaultValue: "Network" })}
              </label>
              <div className="relative">
                <select
                  value={network}
                  onChange={(e) => setNetwork(e.target.value as BitcoinNetwork)}
                  className="appearance-none w-full bg-surface-inset border border-card-border rounded-lg px-3 py-2 text-sm text-foreground cursor-pointer hover:border-muted transition-colors pl-7 pr-8 focus-visible:border-bitcoin"
                  aria-label={t("common.selectNetwork", { defaultValue: "Select Bitcoin network" })}
                >
                  {NETWORKS.map((n) => (
                    <option key={n.value} value={n.value}>
                      {n.label}
                    </option>
                  ))}
                </select>
                <span
                  className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${currentNetwork.dot} pointer-events-none`}
                />
                <ChevronDown
                  size={14}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                />
              </div>
            </div>
            )}

            {/* Language selector */}
            <div className="flex-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-1.5">
                {t("settings.language", { defaultValue: "Language" })}
              </label>
              <div className="relative">
                <select
                  value={i18n.language?.split("-")[0] ?? "en"}
                  onChange={(e) => i18n.changeLanguage(e.target.value)}
                  className="appearance-none w-full bg-surface-inset border border-card-border rounded-lg px-3 py-2 text-sm text-foreground cursor-pointer hover:border-muted transition-colors pr-8 focus-visible:border-bitcoin"
                  aria-label={t("settings.selectLanguage", { defaultValue: "Select language" })}
                >
                  {LANGUAGE_OPTIONS.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.flag} {lang.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                />
              </div>
            </div>
          </div>

          {/* Advanced toggle - hidden on Umbrel (API is preconfigured) */}
          {!isUmbrel && (
          <>
          <div className="border-t border-card-border pt-1">
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              aria-expanded={advancedOpen}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors cursor-pointer w-full py-1"
            >
              {advancedOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {t("settings.advanced", { defaultValue: "Advanced" })}
              {customApiUrl && (
                <span className="ml-auto text-xs text-bitcoin">
                  {t("settings.customActive", { defaultValue: "Custom API active" })}
                </span>
              )}
            </button>
          </div>

          {advancedOpen && (
          <>
          {/* API endpoint section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground uppercase tracking-wider">
                {t("settings.mempoolApi", { defaultValue: "Mempool API" })}
              </span>
              {customApiUrl && (
                <button
                  onClick={handleReset}
                  className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <RotateCcw size={12} />
                  {t("settings.resetToDefault", { defaultValue: "Reset to default" })}
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => {
                  const val = e.target.value;
                  setInputValue(val);
                  // Keep "ok" if the input still matches the active custom URL
                  const normalized = val.trim().replace(/\/+$/, "");
                  if (customApiUrl && normalized === customApiUrl) {
                    setHealth("ok");
                  } else {
                    setHealth("idle");
                  }
                  setErrorHint("");
                }}
                placeholder="https://mempool.space/api"
                aria-label={t("settings.apiInputLabel", { defaultValue: "Custom mempool API URL" })}
                className="flex-1 bg-surface-inset border border-card-border rounded-lg px-3 py-2.5 text-sm text-foreground font-mono placeholder:text-muted/70 focus-visible:border-bitcoin/50"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || health === "checking"}
                className="px-3 py-2.5 text-sm font-medium rounded-lg bg-bitcoin/10 text-bitcoin hover:bg-bitcoin/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {health === "checking" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  t("settings.apply", { defaultValue: "Apply" })
                )}
              </button>
            </form>

            {/* Pre-flight diagnostic warning */}
            {diagnostic?.hint && health === "idle" && (
              <div className="flex items-start gap-2 text-xs text-warning bg-warning/10 rounded-lg p-2.5">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5">
                  <span className="whitespace-pre-line">{diagnostic.hint}</span>
                  {diagnostic.isMissingApiSuffix && (
                    <button
                      onClick={() => {
                        const fixed = inputValue.trim().replace(/\/+$/, "") + "/api";
                        setInputValue(fixed);
                        setHealth("idle");
                      }}
                      className="block text-bitcoin underline text-xs cursor-pointer hover:text-bitcoin/80 transition-colors"
                    >
                      {t("settings.addApiSuffix", { defaultValue: "Add /api to URL" })}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Status indicator */}
            {health === "ok" && (
              <div className="flex items-center gap-1.5 text-xs text-severity-good">
                <Check size={14} />
                {t("settings.connected", { defaultValue: "Connected. Using custom endpoint." })}
              </div>
            )}
            {health === "error" && (
              <div className="flex items-start gap-1.5 text-xs text-severity-high">
                <X size={14} className="shrink-0 mt-0.5" />
                <span>{errorHint || t("settings.connectionFailed", { defaultValue: "Connection failed" })}</span>
              </div>
            )}
            {customApiUrl && health !== "checking" && (
              <p className="text-xs text-muted">
                {t("settings.active", { defaultValue: "Active:" })} <span className="font-mono">{customApiUrl}</span>
              </p>
            )}
            {!customApiUrl && health === "idle" && !diagnostic?.hint && (
              <p className="text-xs text-muted">
                {t("settings.selfHostHint", { defaultValue: "Point to your own mempool.space instance for maximum privacy." })}
              </p>
            )}
          </div>

          {/* Collapsible help section */}
          <div className="border-t border-card-border pt-2">
            <button
              onClick={() => setHelpOpen(!helpOpen)}
              aria-expanded={helpOpen}
              className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer w-full"
            >
              {helpOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {t("settings.howToConnect", { defaultValue: "How to connect your node" })}
            </button>
            {helpOpen && (
              <div className="mt-2 space-y-3 text-xs text-muted">
                <p>
                  {t("settings.corsExplanation", { defaultValue: "Self-hosted mempool instances need" })} <strong className="text-foreground">{t("settings.corsHeaders", { defaultValue: "CORS headers" })}</strong> {t("settings.corsExplanation2", { defaultValue: "to accept requests from this site. Add this to your mempool nginx config:" })}
                </p>
                <pre className="bg-surface-inset rounded-lg p-2 text-xs font-mono overflow-x-auto whitespace-pre">{`location /api/ {
  add_header 'Access-Control-Allow-Origin' '*' always;
  add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
  if ($request_method = 'OPTIONS') {
    return 204;
  }
}`}</pre>

                <div className="space-y-2">
                  <p className="font-medium text-foreground">{t("settings.optionA", { defaultValue: "Option A: SSH tunnel (recommended)" })}</p>
                  <p>
                    {t("settings.optionADesc", { defaultValue: "Forward your node to localhost to avoid mixed-content blocking:" })}
                  </p>
                  <pre className="bg-surface-inset rounded-lg p-2 text-xs font-mono overflow-x-auto">
                    ssh -L 3006:localhost:3006 umbrel@umbrel.local
                  </pre>
                  <p>
                    {t("settings.optionAEnter", { defaultValue: "Then enter" })} <code className="text-bitcoin">http://localhost:3006/api</code> {t("settings.optionAAbove", { defaultValue: "above." })}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="font-medium text-foreground">{t("settings.optionB", { defaultValue: "Option B: HTTPS reverse proxy" })}</p>
                  <p>
                    {t("settings.optionBDesc", { defaultValue: "Set up HTTPS on your node with Caddy or nginx + Let's Encrypt, add CORS headers, then use your HTTPS URL." })}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="font-medium text-foreground">{t("settings.optionC", { defaultValue: "Option C: Tor Browser + .onion" })}</p>
                  <p>
                    {t("settings.optionCDesc", { defaultValue: "Visit this site via its .onion mirror in Tor Browser, then enter your mempool's .onion address. Both are HTTP, so no mixed-content blocking." })}
                  </p>
                  <a
                    href="http://exposed6vdtfoeeolm4d36gj6rqpjhrfri36idyevsw7yl2sda2mw6id.onion"
                    className="inline-block font-mono text-bitcoin/70 hover:text-bitcoin transition-colors break-all"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    exposed6vdtfo...w6id.onion
                  </a>
                </div>

                <p className="text-muted">
                  <Link
                    href="/setup-guide"
                    className="underline hover:text-foreground transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    {t("settings.fullSetupGuide", { defaultValue: "Full setup guide" })}
                  </Link>
                </p>
              </div>
            )}
          </div>
          </>
          )}
          </>
          )}

          {/* Analysis settings toggle */}
          <div className="border-t border-card-border pt-1">
            <button
              onClick={() => setAnalysisOpen(!analysisOpen)}
              aria-expanded={analysisOpen}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors cursor-pointer w-full py-1"
            >
              <Sliders size={12} />
              {analysisOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              {t("settings.analysis", { defaultValue: "Analysis" })}
              {(analysisSettings.maxDepth !== ANALYSIS_DEFAULTS.maxDepth ||
                analysisSettings.minSats !== ANALYSIS_DEFAULTS.minSats ||
                analysisSettings.skipLargeClusters !== ANALYSIS_DEFAULTS.skipLargeClusters ||
                analysisSettings.skipCoinJoins !== ANALYSIS_DEFAULTS.skipCoinJoins) && (
                <span className="ml-auto text-xs text-bitcoin">
                  {t("settings.customized", { defaultValue: "Customized" })}
                </span>
              )}
            </button>
          </div>

          {analysisOpen && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground uppercase tracking-wider">
                  {t("settings.analysisSettings", { defaultValue: "Analysis Settings" })}
                </span>
                <button
                  onClick={resetAnalysis}
                  className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <RotateCcw size={12} />
                  {t("settings.resetDefaults", { defaultValue: "Reset" })}
                </button>
              </div>

              {/* Max depth slider */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="analysis-depth" className="text-xs text-muted">
                    {t("settings.maxDepth", { defaultValue: "Chain depth (hops)" })}
                  </label>
                  <span className="text-xs font-mono text-foreground tabular-nums">{analysisSettings.maxDepth}</span>
                </div>
                <input
                  id="analysis-depth"
                  type="range"
                  min={1}
                  max={50}
                  step={1}
                  value={analysisSettings.maxDepth}
                  onChange={(e) => updateAnalysis({ maxDepth: Number(e.target.value) })}
                  className="w-full h-1.5 bg-surface-inset rounded-full appearance-none cursor-pointer accent-bitcoin"
                />
                <div className="flex justify-between text-[10px] text-muted/60 mt-0.5">
                  <span>1</span>
                  <span>25</span>
                  <span>50</span>
                </div>
              </div>

              {/* Min sats threshold */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="analysis-minsats" className="text-xs text-muted">
                    {t("settings.minSats", { defaultValue: "Min sats to trace" })}
                  </label>
                  <span className="text-xs font-mono text-foreground tabular-nums">{analysisSettings.minSats.toLocaleString()}</span>
                </div>
                <input
                  id="analysis-minsats"
                  type="range"
                  min={100}
                  max={100000}
                  step={100}
                  value={analysisSettings.minSats}
                  onChange={(e) => updateAnalysis({ minSats: Number(e.target.value) })}
                  className="w-full h-1.5 bg-surface-inset rounded-full appearance-none cursor-pointer accent-bitcoin"
                />
                <div className="flex justify-between text-[10px] text-muted/60 mt-0.5">
                  <span>100</span>
                  <span>1,000</span>
                  <span>100,000</span>
                </div>
              </div>

              {/* Toggle: Skip large clusters */}
              <label className="flex items-center justify-between gap-2 cursor-pointer group">
                <span className="text-xs text-muted group-hover:text-foreground transition-colors">
                  {t("settings.skipLargeClusters", { defaultValue: "Skip large clusters" })}
                </span>
                <button
                  role="switch"
                  aria-checked={analysisSettings.skipLargeClusters}
                  onClick={() => updateAnalysis({ skipLargeClusters: !analysisSettings.skipLargeClusters })}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    analysisSettings.skipLargeClusters ? "bg-bitcoin" : "bg-surface-inset"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      analysisSettings.skipLargeClusters ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>

              {/* Toggle: Skip CoinJoins/batching */}
              <label className="flex items-center justify-between gap-2 cursor-pointer group">
                <span className="text-xs text-muted group-hover:text-foreground transition-colors">
                  {t("settings.skipCoinJoins", { defaultValue: "Skip CoinJoins in chain tracing" })}
                </span>
                <button
                  role="switch"
                  aria-checked={analysisSettings.skipCoinJoins}
                  onClick={() => updateAnalysis({ skipCoinJoins: !analysisSettings.skipCoinJoins })}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    analysisSettings.skipCoinJoins ? "bg-bitcoin" : "bg-surface-inset"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      analysisSettings.skipCoinJoins ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>

              <p className="text-[10px] text-muted/60">
                {t("settings.analysisNote", { defaultValue: "Settings apply to the next analysis. Changes are saved automatically." })}
              </p>
            </div>
          )}

          {/* Entity filter status */}
          <EntityFilterStatus t={t} />

          {/* Version */}
          <div className="border-t border-card-border pt-2 text-center">
            <span className="text-[10px] text-muted/70 font-mono tabular-nums select-all">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </span>
          </div>
        </div>
        </>,
        document.body,
      )}
    </div>
  );
}

/** Entity filter status and loader UI. */
function EntityFilterStatus({ t }: { t: (key: string, opts?: Record<string, unknown>) => string }) {
  const [, forceUpdate] = useState(0);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);

  // Auto-load core entity filter when settings panel renders
  useEffect(() => { loadEntityFilter().then(() => forceUpdate((n) => n + 1)); }, []);

  const coreStatus = getFilterStatus();
  const fullStatus = getFullFilterStatus();
  const fullLoaded = isFullFilterLoaded();
  const filter = getFilter();
  const addressCount = filter?.meta.addressCount ?? 0;
  const buildDate = filter?.meta.buildDate ?? "";

  const handleLoadFull = useCallback(async () => {
    setLoading(true);
    setProgress({ loaded: 0, total: 0 });
    try {
      await loadFullEntityFilter((loaded, total) => {
        setProgress({ loaded, total });
      });
    } catch {
      // silently fail - filter is optional
    }
    setLoading(false);
    setProgress(null);
    forceUpdate((n) => n + 1);
  }, []);

  // Don't show if no core filter available
  if (coreStatus === "unavailable" || coreStatus === "error") return null;

  const statusColor =
    coreStatus === "ready" ? "text-success" : coreStatus === "loading" ? "text-bitcoin" : "text-muted";

  const isDownloading = loading || fullStatus === "loading";
  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : null;
  const loadedMB = progress ? (progress.loaded / 1_048_576).toFixed(1) : null;
  const totalMB = progress && progress.total > 0 ? (progress.total / 1_048_576).toFixed(0) : null;

  return (
    <div className="border-t border-card-border pt-2 space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Database size={12} />
        <span>{t("settings.entityFilter", { defaultValue: "Entity Database" })}</span>
        <span className={`ml-auto text-[10px] ${statusColor}`}>
          {coreStatus === "ready"
            ? fullLoaded
              ? t("settings.entityFull", { defaultValue: "Full" })
              : t("settings.entityCore", { defaultValue: "Core" })
            : coreStatus === "loading"
              ? t("settings.entityLoading", { defaultValue: "Loading..." })
              : t("settings.entityIdle", { defaultValue: "Idle" })}
        </span>
      </div>

      {coreStatus === "ready" && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted/60">
            {addressCount.toLocaleString()} {t("settings.entityAddresses", { defaultValue: "addresses" })}
            {buildDate ? ` - ${buildDate.slice(0, 10)}` : ""}
          </p>

          <p className="text-[10px] text-muted/50 leading-relaxed">
            {t("settings.entityExplainer", {
              defaultValue: "Every address in your transactions is cross-referenced locally against a database of known exchanges, services, and sanctioned entities. Nothing leaves your browser.",
            })}
          </p>

          {!fullLoaded && fullStatus !== "unavailable" && !isDownloading && (
            <button
              onClick={handleLoadFull}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium rounded-lg bg-bitcoin/10 text-bitcoin border border-bitcoin/20 hover:bg-bitcoin/20 hover:border-bitcoin/40 transition-all cursor-pointer"
            >
              <Database size={14} />
              {t("settings.entityLoadFull", { defaultValue: "Load full database (30M+ addresses)" })}
            </button>
          )}

          {isDownloading && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-bitcoin flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin" />
                  {t("settings.entityDownloading", { defaultValue: "Downloading..." })}
                </span>
                <span className="text-muted tabular-nums">
                  {pct !== null
                    ? `${loadedMB} / ${totalMB} MB (${pct}%)`
                    : loadedMB
                      ? `${loadedMB} MB`
                      : ""}
                </span>
              </div>
              <div className="w-full h-1.5 bg-surface-inset rounded-full overflow-hidden">
                <div
                  className="h-full bg-bitcoin rounded-full transition-all duration-300 ease-out"
                  style={{ width: pct !== null ? `${pct}%` : "30%", animation: pct === null ? "pulse 2s ease-in-out infinite" : undefined }}
                />
              </div>
            </div>
          )}

          {fullLoaded && (
            <div className="flex items-center gap-1.5 text-[10px] text-success/80">
              <Check size={12} />
              {t("settings.entityFullLoaded", { defaultValue: "Full entity database loaded" })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
