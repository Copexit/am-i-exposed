"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { Check, X, Loader2, RotateCcw, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { diagnoseUrl } from "@/lib/api/url-diagnostics";
import { abortSignalTimeout } from "@/lib/abort-signal";

type HealthStatus = "idle" | "checking" | "ok" | "error";

interface NetworkSettingsProps {
  onClosePanel: () => void;
}

export function NetworkSettings({ onClosePanel }: NetworkSettingsProps) {
  const { t } = useTranslation();
  const { customApiUrl, setCustomApiUrl } = useNetwork();
  const [inputValue, setInputValue] = useState(customApiUrl ?? "");
  const [health, setHealth] = useState<HealthStatus>(customApiUrl ? "ok" : "idle");
  const [errorHint, setErrorHint] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    <>
      {/* Advanced toggle */}
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
                onClick={() => onClosePanel()}
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
  );
}
