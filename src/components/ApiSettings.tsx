"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Settings, Check, X, Loader2, RotateCcw, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { diagnoseUrl } from "@/lib/api/url-diagnostics";
import { type BitcoinNetwork } from "@/lib/bitcoin/networks";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/config";

type HealthStatus = "idle" | "checking" | "ok" | "error";

const NETWORKS: { value: BitcoinNetwork; label: string; dot: string }[] = [
  { value: "mainnet", label: "Mainnet", dot: "bg-bitcoin" },
  { value: "testnet4", label: "Testnet4", dot: "bg-success" },
  { value: "signet", label: "Signet", dot: "bg-info" },
];

export function ApiSettings() {
  const { t, i18n } = useTranslation();
  const { network, setNetwork, customApiUrl, setCustomApiUrl } = useNetwork();
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(customApiUrl ?? "");
  const [health, setHealth] = useState<HealthStatus>("idle");
  const [errorHint, setErrorHint] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
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

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
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
          signal: AbortSignal.timeout(10000),
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
            "Blocked: your browser prevents HTTP requests from this HTTPS page. " +
            "Use SSH port forwarding to localhost, or set up HTTPS on your node."
          );
        } else if (err instanceof TypeError && err.message.includes("fetch")) {
          setErrorHint(
            "Connection failed. Your node likely needs CORS headers. " +
            "See the setup guide below."
          );
        } else if (err instanceof DOMException && err.name === "AbortError") {
          setErrorHint("Timeout (10s)");
        } else {
          setErrorHint("Connection failed");
        }
      }
    },
    [setCustomApiUrl],
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
    <div ref={panelRef} className="relative">
      <button
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

      {open && (
        <>
        {/* Mobile backdrop */}
        <div
          className="fixed inset-0 bg-black/40 z-40 sm:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
        <div role="dialog" aria-modal="true" aria-label={t("settings.ariaLabel", { defaultValue: "Settings" })} className="fixed inset-x-0 top-[60px] mx-3 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mx-0 sm:mt-2 sm:w-96 bg-surface-elevated border border-card-border rounded-xl shadow-xl z-50 p-4 space-y-4 max-h-[80vh] overflow-y-auto">

          {/* Network & Language row */}
          <div className="flex items-center gap-3">
            {/* Network selector */}
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

          {/* Advanced toggle */}
          <div className="border-t border-card-border pt-1">
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
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
                <span>{errorHint || "Connection failed"}</span>
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
        </div>
        </>
      )}
    </div>
  );
}
