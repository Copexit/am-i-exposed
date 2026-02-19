"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Settings, Check, X, Loader2, RotateCcw, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { useNetwork } from "@/context/NetworkContext";
import { diagnoseUrl } from "@/lib/api/url-diagnostics";

type HealthStatus = "idle" | "checking" | "ok" | "error";

export function ApiSettings() {
  const { customApiUrl, setCustomApiUrl } = useNetwork();
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(customApiUrl ?? "");
  const [health, setHealth] = useState<HealthStatus>("idle");
  const [errorHint, setErrorHint] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
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
        'button, input, a, [tabindex]:not([tabindex="-1"])'
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
        className="relative text-muted hover:text-foreground transition-colors cursor-pointer p-2 rounded-lg border border-card-border bg-surface-elevated hover:bg-surface-inset"
        aria-label="API settings"
        title="API endpoint settings"
      >
        <Settings size={18} />
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
        <div className="fixed inset-x-0 top-[60px] mx-3 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mx-0 sm:mt-2 sm:w-96 bg-surface-elevated border border-card-border rounded-xl shadow-xl z-50 p-4 space-y-3 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground/80 uppercase tracking-wider">
              Mempool API
            </span>
            {customApiUrl && (
              <button
                onClick={handleReset}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
              >
                <RotateCcw size={12} />
                Reset to default
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
              className="flex-1 bg-surface-inset border border-card-border rounded-lg px-3 py-1.5 text-sm text-foreground font-mono placeholder:text-muted/50 focus-visible:border-bitcoin/50"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || health === "checking"}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-bitcoin/10 text-bitcoin hover:bg-bitcoin/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {health === "checking" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                "Apply"
              )}
            </button>
          </form>

          {/* Pre-flight diagnostic warning */}
          {diagnostic?.hint && health === "idle" && (
            <div className="flex items-start gap-2 text-xs text-warning bg-warning/10 rounded-lg p-2.5">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span className="whitespace-pre-line">{diagnostic.hint}</span>
            </div>
          )}

          {/* Status indicator */}
          {health === "ok" && (
            <div className="flex items-center gap-1.5 text-xs text-severity-good">
              <Check size={14} />
              Connected. Using custom endpoint.
            </div>
          )}
          {health === "error" && (
            <div className="flex items-start gap-1.5 text-xs text-severity-high">
              <X size={14} className="shrink-0 mt-0.5" />
              <span>{errorHint || "Connection failed"}</span>
            </div>
          )}
          {customApiUrl && health !== "checking" && (
            <p className="text-xs text-muted/90">
              Active: <span className="font-mono">{customApiUrl}</span>
            </p>
          )}
          {!customApiUrl && health === "idle" && !diagnostic?.hint && (
            <p className="text-xs text-muted/90">
              Point to your own mempool.space instance for maximum privacy.
            </p>
          )}

          {/* Collapsible help section */}
          <div className="border-t border-card-border pt-2">
            <button
              onClick={() => setHelpOpen(!helpOpen)}
              className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer w-full"
            >
              {helpOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              How to connect your node
            </button>
            {helpOpen && (
              <div className="mt-2 space-y-3 text-xs text-muted/90">
                <p>
                  Self-hosted mempool instances need <strong className="text-foreground/80">CORS headers</strong> to
                  accept requests from this site. Add this to your mempool nginx config:
                </p>
                <pre className="bg-surface-inset rounded-lg p-2 text-[11px] font-mono overflow-x-auto whitespace-pre">{`location /api/ {
  add_header 'Access-Control-Allow-Origin' '*' always;
  add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
  if ($request_method = 'OPTIONS') {
    return 204;
  }
}`}</pre>

                <div className="space-y-2">
                  <p className="font-medium text-foreground/80">Option A: SSH tunnel (recommended)</p>
                  <p>
                    Forward your node to localhost to avoid mixed-content blocking:
                  </p>
                  <pre className="bg-surface-inset rounded-lg p-2 text-[11px] font-mono overflow-x-auto">
                    ssh -L 3006:localhost:3006 umbrel@umbrel.local
                  </pre>
                  <p>
                    Then enter <code className="text-bitcoin">http://localhost:3006/api</code> above.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="font-medium text-foreground/80">Option B: HTTPS reverse proxy</p>
                  <p>
                    Set up HTTPS on your node with Caddy or nginx + Let&apos;s Encrypt,
                    add CORS headers, then use your HTTPS URL.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="font-medium text-foreground/80">Option C: Tor Browser + .onion</p>
                  <p>
                    If this site has a .onion mirror, use Tor Browser to visit it and
                    enter your mempool&apos;s .onion address. Both are HTTP, so no
                    mixed-content blocking.
                  </p>
                </div>

                <p className="text-muted/90">
                  <a
                    href="https://github.com/Copexit/am-i-exposed/blob/main/onion.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground/80 transition-colors"
                  >
                    Full setup guide
                  </a>
                </p>
              </div>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
